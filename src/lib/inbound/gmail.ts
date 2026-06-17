// Gmail API poller — uses a service account with domain-wide delegation
// to read agent@naughtythings.com.hk's inbox every minute.
//
// We never store messages. The mailbox is the source of truth.
// We track a "last seen" historyId in app_state; Gmail's historyId is
// monotonically increasing per mailbox, so re-polling is safe and we
// never miss or double-ingest a message.

import { google, gmail_v1 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { createAdminClient } from '@/lib/supabase/server';
import { parseEmail } from '@/lib/ai/parseEmail';

const APP_STATE_KEY = 'gmail_…_history_id';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export type PollResult = {
  scanned: number;
  ingested: number;
  rejected: number;
  errors: number;
  skipped: number;
};

/**
 * Process-level mutex: only one pollGmail() runs at a time across the whole
 * Node process. On Railway, multiple Next.js server workers / hot-reload
 * edge cases have been seen to fire pollGmail() 5–10 times in 250 ms. Without
 * this, the dedupe-by-gmail_id check below still saves us (we won't double-
 * insert), but we'd waste 5–10× the API quota and AI calls per minute. With
 * this, concurrent invocations return immediately with a "skipped" result.
 *
 * Stored on globalThis so it survives Next.js module re-evaluation.
 */
declare global {
  // eslint-disable-next-line no-var
  var __sonyPollInFlight: Promise<PollResult> | null | undefined;
}

function getAuth(): JWT {
  const email = process.env.GMAIL_SA_EMAIL;
  const key = (process.env.GMAIL_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const subject = process.env.GMAIL_USER;
  if (!email || !key || !subject) {
    throw new Error(
      'GMAIL_SA_EMAIL, GMAIL_SA_PRIVATE_KEY, and GMAIL_USER must all be set'
    );
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: SCOPES,
    subject // impersonate this mailbox
  });
}

async function getHistoryId(admin: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const { data } = await admin
    .from('app_state')
    .select('value')
    .eq('key', APP_STATE_KEY)
    .single();
  return data?.value || null;
}

async function setHistoryId(admin: ReturnType<typeof createAdminClient>, id: string) {
  await admin
    .from('app_state')
    .upsert({ key: APP_STATE_KEY, value: id, updated_at: new Date().toISOString() });
}

async function fetchNewMessageIds(
  gmail: gmail_v1.Gmail,
  startHistoryId: string | null
): Promise<{ ids: string[]; latestHistoryId: string | null }> {
  // First run (no historyId) → just grab the most recent 20 messages
  if (!startHistoryId) {
    const res = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 20,
      labelIds: ['INBOX']
    });
    return {
      ids: (res.data.messages || []).map(m => m.id!).filter(Boolean),
      latestHistoryId: null
    };
  }

  // Subsequent runs → use history API for incremental changes
  const res = await gmail.users.history.list({
    userId: 'me',
    startHistoryId,
    historyTypes: ['messageAdded'],
    labelId: 'INBOX'
  });
  const ids = new Set<string>();
  let latest: string | null = startHistoryId;
  for (const h of res.data.history || []) {
    for (const m of h.messagesAdded || []) {
      if (m.message?.id) ids.add(m.message.id);
    }
    if (h.id) latest = h.id;
  }
  return { ids: Array.from(ids), latestHistoryId: latest };
}

async function getMessage(gmail: gmail_v1.Gmail, id: string) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'full'
  });
  return res.data;
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return (headers || []).find(h => (h.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

function bodyFromPayload(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';
  // Prefer text/plain
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  // Recurse into parts
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8');
    }
  }
  // Fallback: text/html
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8');
    }
  }
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  return '';
}

export async function pollGmail(): Promise<PollResult> {
  // Concurrency guard: if another poll is in flight, skip this one. This
  // protects against self-pinger / cron / route handler all firing at once.
  if (globalThis.__sonyPollInFlight) {
    return { scanned: 0, ingested: 0, rejected: 0, errors: 0, skipped: 1 };
  }

  const run = (async () => {
    const result: PollResult = { scanned: 0, ingested: 0, rejected: 0, errors: 0, skipped: 0 };

    const auth = getAuth();
    const gmail = google.gmail({ version: 'v1', auth });
    const admin = createAdminClient();

    const startHistoryId = await getHistoryId(admin);
    let newestHistoryId: string | null = startHistoryId;
    let profileHistoryId: string | null = null;

    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      profileHistoryId = profile.data.historyId || null;
    } catch (e: any) {
      // If we can't even get the profile, surface the error
      throw new Error(`getProfile failed: ${e.message}`);
    }

    const { ids, latestHistoryId } = await fetchNewMessageIds(gmail, startHistoryId);
    if (latestHistoryId) newestHistoryId = latestHistoryId;

    for (const id of ids) {
      result.scanned++;
      try {
        // Dedup: skip if we've already logged this Gmail message id.
        // The DB also has a unique constraint (see migration) but checking
        // here first saves the AI parse call entirely.
        const { data: existing } = await admin
          .from('email_ingests')
          .select('id')
          .eq('raw_payload->>gmail_id', id)
          .limit(1)
          .maybeSingle();
        if (existing) {
          result.skipped++;
          continue;
        }

        const msg = await getMessage(gmail, id);
        const from = header(msg.payload?.headers, 'From');
        const subject = header(msg.payload?.headers, 'Subject');
        const body = bodyFromPayload(msg.payload);

        // 1. log raw
        const { data: ingest, error: logErr } = await admin
        .from('email_ingests')
        .insert({
          from_email: from,
          subject,
          raw_payload: {
            gmail_id: id,
            threadId: msg.threadId,
            historyId: msg.historyId,
            internalDate: msg.internalDate
          },
          status: 'pending'
        })
        .select()
        .single();
      if (logErr) {
        result.errors++;
        continue;
      }

      // 2. parse with AI
      try {
        const ai = await parseEmail({ from, subject, body });

        // 3. resolve client (v1: only SONY)
        const { data: clientRow } = await admin
          .from('clients')
          .select('id')
          .eq('slug', 'sony')
          .single();
        if (!clientRow) {
          await admin
            .from('email_ingests')
            .update({ status: 'error', error: 'SONY client not found' })
            .eq('id', ingest.id);
          result.errors++;
          continue;
        }

        // 4. One email can describe multiple posts (planning table with
        //    one row per post, numbered briefs, etc.). The AI returns an
        //    array — we create one staging/calendar post per item. Empty
        //    array = irrelevant email (out-of-office, calendar invite).
        if (ai.posts.length === 0) {
          await admin
            .from('email_ingests')
            .update({
              status: 'irrelevant',
              parsed: ai,
              matched_client_id: clientRow.id,
              error: null
            })
            .eq('id', ingest.id);
          result.rejected++;
          continue;
        }

        const createdPostIds: string[] = [];
        let lastError: string | null = null;
        let allHaveDateAndTitle = true;
        let primaryPostId: string | null = null;

        for (let i = 0; i < ai.posts.length; i++) {
          const item = ai.posts[i];
          const hasDate = !!item.publish_date;
          const hasTitle = !!item.title;
          if (!(hasDate && hasTitle)) allHaveDateAndTitle = false;

          // Defensive: if a row has NO date AND the title matches the email
          // subject (after stripping common reply/forward prefixes), this
          // is almost certainly a parser regression (the model returned a
          // single fake post with the subject as the title, instead of an
          // array of real posts from a planning table). Skip it rather
          // than creating a confusing staging post that looks like a real
          // brief but isn't. The real posts from this email — if any —
          // will have proper titles and dates. This is the safety net
          // for the 2026-06-16 incident where one Jul 2026 planning email
          // produced 5 real posts + 1 orphan staging post titled
          // "Sony PE Social Post Planning Jul 2026".
          const stripPrefix = (s: string) => s.replace(/^\s*(re|fwd|fw)\s*:\s*/i, '').trim();
          const titleIsSubject =
            !!item.title && !!subject &&
            stripPrefix(item.title).toLowerCase() === stripPrefix(subject).toLowerCase();
          if (!hasDate && titleIsSubject) {
            console.warn(
              `[inbound] skipping suspicious row: title matches email subject ` +
              `and date is null (gmail_id=${id}, row=${i}, total=${ai.posts.length}, ` +
              `subject=${JSON.stringify(subject)})`
            );
            continue;
          }

          //    - full brief (date + title) → calendar chip with status=needs_review
          //    - partial brief            → staging zone (publish_date=NULL, status=staging)
          //      so a human can fill in the gaps and promote to the calendar
          /* Status on insert (post 2026-06-17 enum tightening):
               - full brief (date + title)  -> client_review (was 'needs_review')
               - partial brief              -> in_progress (was 'staging', which no longer exists)
            */
          const { data: post, error: postErr } = await admin
            .from('posts')
            .insert({
              client_id: clientRow.id,
              title: item.title || subject || '(untitled)',
              platform: item.platform || null,
              category: Array.isArray(item.category) && item.category.length > 0
                ? item.category
                : null,
              publish_date: item.publish_date || null,
              status: hasDate && hasTitle ? 'client_review' : 'in_progress',
              designer: item.designer || null,
              copy_writer: item.copy_writer || null,
              internal_pic: item.internal_pic || null,
              client_pic: item.client_pic || null,
              notes: item.notes,
              source: 'email',
              source_meta: {
                ingest_id: ingest.id,
                from,
                subject,
                gmail_id: id,
                row_index: i,
                total_rows: ai.posts.length,
                mentioned_internal: item.mentioned_internal,
                mentioned_client: item.mentioned_client,
                confidence: item.confidence,
                missing: !hasDate && !hasTitle
                  ? 'date and title'
                  : !hasDate
                  ? 'publish date'
                  : 'title'
              }
            })
            .select()
            .single();

          if (postErr) {
            lastError = postErr.message;
            // Keep going — one bad row shouldn't kill the rest of the email
            continue;
          }
          createdPostIds.push(post.id);
          if (!primaryPostId) primaryPostId = post.id;
        }

        // Tag the ingest
        // - all rows had full data         → 'created'  (auto-placed on calendar)
        // - some rows missing date/title   → 'rejected' (mixed; humans need to review)
        // - no rows inserted at all        → 'error'    (parse succeeded, insert failed)
        const status = createdPostIds.length === 0
          ? 'error'
          : (allHaveDateAndTitle ? 'created' : 'rejected');
        const errMsg = createdPostIds.length === 0
          ? (lastError || `Parsed ${ai.posts.length} post(s) but none inserted`)
          : (!allHaveDateAndTitle
              ? `Parsed ${ai.posts.length} post(s); some missing date/title (in staging)`
              : null);

        await admin
          .from('email_ingests')
          .update({
            status,
            parsed: ai,
            matched_client_id: clientRow.id,
            created_post_id: primaryPostId,
            error: errMsg
          })
          .eq('id', ingest.id);

        // Count: each created post counts as ingested (auto-placed) or
        // rejected (in staging, awaiting human).
        const goodCount = allHaveDateAndTitle ? createdPostIds.length : 0;
        const badCount = createdPostIds.length - goodCount;
        result.ingested += goodCount;
        result.rejected += badCount;
      } catch (e: any) {
        await admin
          .from('email_ingests')
          .update({ status: 'error', error: e.message })
          .eq('id', ingest.id);
        result.errors++;
      }
    } catch (e: any) {
      result.errors++;
    }
  }

  // Always advance the history pointer to the latest we've seen, even if
  // some messages errored — otherwise we'd retry them forever.
  const final = newestHistoryId || profileHistoryId;
  if (final) await setHistoryId(admin, final);

  return result;
  })();

  globalThis.__sonyPollInFlight = run;
  try {
    return await run;
  } finally {
    if (globalThis.__sonyPollInFlight === run) {
      globalThis.__sonyPollInFlight = null;
    }
  }
}
