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
import { htmlTablesToMarkdown } from '@/lib/ai/htmlTable';

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

/**
 * Recursively extract the best text body from a Gmail message payload.
 *
 * Preference order:
 *  1. text/plain at any depth
 *  2. text/html at any depth (will be returned as-is, the AI tolerates HTML)
 *  3. If the only meaningful content is a non-text part (PDF, image, doc),
 *     return a synthetic placeholder so parseEmail doesn't get an empty
 *     body. The placeholder mentions the filename + mime type so the AI
 *     can create a post with notes='PDF brief: see email' and a human
 *     can pick it up from staging. This fixes the 2026-06-25 incident
 *     where Raymond Kwan's 'Sony DI CX64130' email had body=''
 *     (multipart/mixed with a PDF attachment and empty text parts), so
 *     parseEmail hung on an empty body and the row got stuck as
 *     'pending' forever.
 */
function bodyFromPayload(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Collect candidates by walking the part tree. We want the smallest
  // text part that has actual content (so a 5KB plain-text brief wins
  // over a 200KB HTML footer with the same content). Recurse into
  // multipart/* containers.
  type Candidate = { mime: string; data: string; depth: number };
  const candidates: Candidate[] = [];
  const nonTextParts: string[] = [];

  function walk(p: gmail_v1.Schema$MessagePart | undefined, depth: number) {
    if (!p) return;
    const mt = (p.mimeType || '').toLowerCase();
    if ((mt === 'text/plain' || mt === 'text/html') && p.body?.data) {
      candidates.push({ mime: mt, data: p.body.data, depth });
    } else if (
      p.filename &&
      p.body?.attachmentId &&
      !mt.startsWith('multipart/')
    ) {
      // Real attachment (has filename + attachmentId, not a multipart container)
      nonTextParts.push(`${p.filename} (${mt || 'unknown'})`);
    }
    for (const child of p.parts || []) walk(child, depth + 1);
  }
  walk(payload, 0);

  const plain = candidates.filter(c => c.mime === 'text/plain');
  const html = candidates.filter(c => c.mime === 'text/html');

  // Prefer text/plain over text/html; among ties, prefer the smallest
  // (usually the brief, not the full HTML with quotes/signatures).
  if (plain.length > 0) {
    plain.sort((a, b) => a.data.length - b.data.length);
    const plainText = Buffer.from(plain[0].data, 'base64').toString('utf8');

    // SONU's heuristic: if the plain-text body contains a table-like
    // structure (rows of column-data separated by blank lines, like
    // the MSS Workshop email forward) AND the email also has an HTML
    // part, PREFER the HTML-converted version. The plain-text Gmail
    // rendering strips <table>/<tr>/<td> and especially loses
    // rowspan information — when a cell uses rowspan="5" to label
    // multiple rows with the same value (e.g. "Request Date: 10 Jun"
    // applied to all 5 posts in Jennifer's MSS table), the AI then
    // misaligns column headers and reads the wrong date for each row.
    //
    // We detect a "table-like" plain-text body by looking for the
    // pattern of asterisk-wrapped headers followed by numbered rows
    // (*Post*, *Request Date*, *Target Launch Date*, ... then 1 / 10 Jun
    // / 16 Jun / ...).
    const looksLikeGmailTable = /\*(Post|Request Date|Target Launch|Cate)/i.test(plainText);
    if (looksLikeGmailTable && html.length > 0) {
      // Fall back to HTML + table conversion
      html.sort((a, b) => a.data.length - b.data.length);
      const htmlText = Buffer.from(html[0].data, 'base64').toString('utf8');
      const tables = htmlTablesToMarkdown(htmlText);
      if (tables.length > 0) {
        let next = htmlText;
        for (let i = tables.length - 1; i >= 0; i--) {
          const t = tables[i];
          next = next.slice(0, t.startIndex) + '\n' + t.md + '\n' + next.slice(t.endIndex);
        }
        // Strip remaining HTML for cleanliness
        return stripHtml(next).trim();
      }
    }

    return plainText;
  }
  if (html.length > 0) {
    html.sort((a, b) => a.data.length - b.data.length);
    return Buffer.from(html[0].data, 'base64').toString('utf8');
  }

  // No text body found. If there are attachments, return a placeholder
  // so parseEmail can at least create a post with a note about the
  // attachment. Otherwise return empty (parseEmail will mark it
  // 'irrelevant').
  if (nonTextParts.length > 0) {
    return (
      `[This email has no text body. The brief is in the following attachment(s): ` +
      nonTextParts.join(', ') +
      `. Please ask the human reviewer to open the attachment and fill in the post details manually.]`
    );
  }
  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

    // Orphan recovery: if the previous poll's process was killed between
    // inserting into email_ingests (status=pending) and the AI parse +
    // post insert, the row is left as 'pending' forever. The dedupe check
    // on gmail_id will then skip the same message on every subsequent
    // poll, so the post never gets created. This block finds any pending
    // row older than 5 minutes, deletes it (frees the gmail_id for
    // re-processing), and rewinds the history pointer to just before
    // the orphan's historyId so the next history.list call picks it
    // back up. After re-fetch, the message goes through the full
    // parse-and-insert path; if it fails again, the row gets a final
    // status of 'error' with the actual error message, so it's no
    // longer silent. Added 2026-06-25 after the 2026-06-24 02:50 UTC
    // Raymond Kwan "Sony DI CX64130" email got stuck in pending for
    // ~20 hours because the Railway worker restarted mid-parse.
    const STALE_PENDING_MS = 5 * 60 * 1000;
    const staleBefore = new Date(Date.now() - STALE_PENDING_MS).toISOString();
    const { data: staleRows } = await admin
      .from('email_ingests')
      .select('id, raw_payload')
      .eq('status', 'pending')
      .lt('received_at', staleBefore);
    if (staleRows && staleRows.length > 0) {
      let oldestHistoryId: string | null = null;
      const idsToDelete: string[] = [];
      for (const row of staleRows) {
        idsToDelete.push(row.id);
        const h = (row.raw_payload as any)?.historyId;
        if (h) {
          const asNum = Number(h);
          if (!Number.isNaN(asNum) && (oldestHistoryId === null || asNum < Number(oldestHistoryId))) {
            oldestHistoryId = String(asNum - 1); // rewind to just before
          }
        }
      }
      await admin
        .from('email_ingests')
        .delete()
        .in('id', idsToDelete);
      // eslint-disable-next-line no-console
      console.warn(
        `[inbound] orphan recovery: deleted ${idsToDelete.length} stale pending row(s)` +
        (oldestHistoryId ? `, rewinding historyId to ${oldestHistoryId}` : '')
      );
      if (oldestHistoryId) {
        await setHistoryId(admin, oldestHistoryId);
      }
    }

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
        let allRowsRoutedToReview = true; // optimistic: starts true, becomes false if any row is routed to in_progress or staging
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

          //    - full brief (date + title) → calendar chip with status=client_review
          //    - partial brief            → staging zone for PIC to assign the date
          /* Routing logic (2026-06-25 update with staging state):
               - missing publish_date (no Target Launch Date in email)
                 AND no usable target_launch_date either           → staging
                 (PIC needs to assign a launch date before the post
                  can go on the calendar grid)
               - otherwise: AI confidence < 0.7 OR parse_warnings   → in_progress
                 (human reviewer should double-check the parsed data)
               - otherwise: full brief (date + title), high conf    → client_review
             The SA01 Jun/Jul confusion bug taught us that even a "complete"
             row can be wrong, so we lean on the AI's own confidence + any
             warnings it surfaced.
            */
          const itemConfidence = typeof item.confidence === 'number' ? item.confidence : 0.5;
          const itemWarnings = Array.isArray(item.parse_warnings) ? item.parse_warnings : [];
          const highConfidence = itemConfidence >= 0.7 && itemWarnings.length === 0;
          const fullBrief = hasDate && hasTitle;
          // 'staging' is reserved for posts missing the publish date. We treat
          // publish_date as the canonical launch date; target_launch_date is
          // kept separately for audit but doesn't count for routing.
          const needsLaunchDate = !hasDate && !item.target_launch_date;
          let postStatus: 'staging' | 'in_progress' | 'client_review';
          let routedReason: string;
          if (needsLaunchDate) {
            postStatus = 'staging';
            routedReason = 'no publish_date in email (e.g. "Target Launch: Within this week"); routed to staging inbox for PIC to assign';
          } else if (highConfidence && fullBrief) {
            postStatus = 'client_review';
            routedReason = 'full brief, high confidence, no warnings';
          } else if (!fullBrief) {
            postStatus = 'in_progress';
            routedReason = 'incomplete brief (missing date or title)';
          } else {
            postStatus = 'in_progress';
            routedReason = itemWarnings.length > 0
              ? `low confidence (${itemConfidence}) or has ${itemWarnings.length} parse warning(s); routed to staging for human review`
              : `low confidence (${itemConfidence}); routed to staging`;
          }

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
              // The two date columns from the planning table (Request Date
              // = copy delivery deadline; Target Launch Date = column the
              // client wrote in). Useful even when publish_date is null
              // — gives the human reviewer the delivery deadline.
              target_launch_date: item.target_launch_date || null,
              request_date: item.request_date || null,
              status: postStatus,
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
                confidence: itemConfidence,
                parse_warnings: itemWarnings,
                target_launch_date: item.target_launch_date || null,
                request_date: item.request_date || null,
                missing: !hasDate && !hasTitle
                  ? 'date and title'
                  : !hasDate
                  ? 'publish date'
                  : 'title',
                routed_to: postStatus,
                routed_reason: routedReason
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
          // Track per-row status so we can summarize the ingest correctly
          // (a mix of client_review and in_progress rows is still 'rejected'
          // from the ingest's perspective, because humans need to look at
          // the in_progress ones).
          if (postStatus !== 'client_review') {
            // staging or in_progress rows need human eyes
            allRowsRoutedToReview = false;
          }
        }

        // Tag the ingest
        // - all rows full brief + high confidence        → 'created'  (auto-placed)
        // - some rows missing/low-confidence (in_progress) → 'rejected' (mixed; humans to review)
        // - no rows inserted at all                       → 'error'    (parse ok, insert failed)
        const status = createdPostIds.length === 0
          ? 'error'
          : (allHaveDateAndTitle && allRowsRoutedToReview ? 'created' : 'rejected');
        const errMsg = createdPostIds.length === 0
          ? (lastError || `Parsed ${ai.posts.length} post(s) but none inserted`)
          : (!allHaveDateAndTitle
              ? `Parsed ${ai.posts.length} post(s); some missing date/title (in staging)`
              : !allRowsRoutedToReview
              ? `Parsed ${ai.posts.length} post(s); some had low confidence or warnings (in staging for human review)`
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
