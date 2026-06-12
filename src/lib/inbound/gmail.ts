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
};

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
  const result: PollResult = { scanned: 0, ingested: 0, rejected: 0, errors: 0 };

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

        if (!ai.publish_date || !ai.title) {
          await admin
            .from('email_ingests')
            .update({
              status: 'rejected',
              parsed: ai,
              matched_client_id: clientRow.id,
              error: 'Missing publish_date or title'
            })
            .eq('id', ingest.id);
          result.rejected++;
          continue;
        }

        // 4. create post
        const { data: post, error: postErr } = await admin
          .from('posts')
          .insert({
            client_id: clientRow.id,
            title: ai.title,
            platform: ai.platform,
            publish_date: ai.publish_date,
            status: 'needs_review',
            notes: ai.notes,
            source: 'email',
            source_meta: {
              ingest_id: ingest.id,
              from,
              subject,
              gmail_id: id,
              mentioned_internal: ai.mentioned_internal,
              mentioned_client: ai.mentioned_client,
              confidence: ai.confidence
            }
          })
          .select()
          .single();

        if (postErr) {
          await admin
            .from('email_ingests')
            .update({ status: 'error', error: postErr.message, parsed: ai })
            .eq('id', ingest.id);
          result.errors++;
          continue;
        }

        await admin
          .from('email_ingests')
          .update({
            status: 'created',
            parsed: ai,
            matched_client_id: clientRow.id,
            created_post_id: post.id
          })
          .eq('id', ingest.id);
        result.ingested++;
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
}
