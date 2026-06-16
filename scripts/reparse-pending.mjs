// One-shot: re-parse any email_ingests that are status='rejected' or
// 'irrelevant' or 'error' or 'pending' using the new multi-post parser.
// Wipes any existing posts for that gmail_id and creates the new ones.
//
// Run once after deploying the new parser to backfill the rows the old
// single-post parser missed. Idempotent.

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { config } from 'dotenv';
config({ path: './.env' });
import { parseEmail } from '../src/lib/ai/parseEmail.ts';
import { getMinimax } from '../src/lib/ai/client.ts';

getMinimax();

function decode(d) { return Buffer.from((d||'').replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf-8'); }
function headerVal(headers, name) {
  return (headers || []).find(h => (h.name||'').toLowerCase() === name.toLowerCase())?.value || '';
}
function bodyFromPayload(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decode(payload.body.data);
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
    if (part.mimeType === 'multipart/alternative') {
      for (const sub of part.parts || []) {
        if (sub.mimeType === 'text/plain' && sub.body?.data) return decode(sub.body.data);
      }
    }
  }
  return '';
}

const env = process.env;
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const auth = new google.auth.JWT({
  email: env.GMAIL_SA_EMAIL,
  key: (env.GMAIL_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  subject: env.GMAIL_USER
});
const gmail = google.gmail({ version: 'v1', auth });

const { data: ings } = await sb.from('email_ingests')
  .select('id, from_email, subject, gmail_id, status, parsed')
  .in('status', ['rejected', 'pending', 'irrelevant', 'error'])
  .order('received_at', { ascending: true });

console.log('Found', ings?.length, 'ingests to re-parse');

const { data: clientRow } = await sb.from('clients').select('id').eq('slug', 'sony').single();
if (!clientRow) { console.error('SONY client not found'); process.exit(1); }

for (const ing of ings ?? []) {
  if (!ing.gmail_id) { console.log('skip', ing.id, '— no gmail_id'); continue; }
  console.log(`\n=== ${ing.id} — ${ing.subject} ===`);

  const { data: existingPosts } = await sb.from('posts')
    .select('id, title, publish_date')
    .eq('source', 'email')
    .eq('source_meta->>gmail_id', ing.gmail_id);
  console.log('Existing posts:', existingPosts?.length || 0);

  const msg = await gmail.users.messages.get({ userId: 'me', id: ing.gmail_id, format: 'full' });
  const subject = headerVal(msg.data.payload?.headers, 'Subject') || ing.subject;
  const from = headerVal(msg.data.payload?.headers, 'From') || ing.from_email;
  const body = bodyFromPayload(msg.data.payload);

  console.log('Re-parsing...');
  const ai = await parseEmail({ from, subject, body });
  console.log('AI returned', ai.posts.length, 'posts');

  if (ai.posts.length === 0) {
    console.log('No posts in this email; marking irrelevant');
    if (existingPosts && existingPosts.length > 0) {
      for (const p of existingPosts) await sb.from('email_ingests').update({ created_post_id: null }).eq('created_post_id', p.id);
      await sb.from('posts').delete().in('id', existingPosts.map(p => p.id));
      console.log('  wiped', existingPosts.length, 'old posts');
    }
    await sb.from('email_ingests').update({ status: 'irrelevant', parsed: ai, error: null }).eq('id', ing.id);
    continue;
  }

  if (existingPosts && existingPosts.length > 0) {
    console.log('Wiping', existingPosts.length, 'old posts first');
    for (const p of existingPosts) await sb.from('email_ingests').update({ created_post_id: null }).eq('created_post_id', p.id);
    await sb.from('posts').delete().in('id', existingPosts.map(p => p.id));
  }

  const createdIds = [];
  let allHaveDateAndTitle = true;
  let primaryId = null;
  for (let i = 0; i < ai.posts.length; i++) {
    const item = ai.posts[i];
    const hasDate = !!item.publish_date;
    const hasTitle = !!item.title;
    if (!(hasDate && hasTitle)) allHaveDateAndTitle = false;

    const { data: post, error: postErr } = await sb.from('posts').insert({
      client_id: clientRow.id,
      title: item.title || subject || '(untitled)',
      platform: item.platform || null,
      category: item.category || null,
      publish_date: item.publish_date || null,
      status: hasDate && hasTitle ? 'needs_review' : 'staging',
      designer: item.designer || null,
      copy_writer: item.copy_writer || null,
      internal_pic: item.internal_pic || null,
      client_pic: item.client_pic || null,
      notes: item.notes,
      source: 'email',
      source_meta: {
        ingest_id: ing.id,
        from,
        subject,
        gmail_id: ing.gmail_id,
        row_index: i,
        total_rows: ai.posts.length,
        mentioned_internal: item.mentioned_internal,
        mentioned_client: item.mentioned_client,
        confidence: item.confidence,
        missing: !hasDate && !hasTitle ? 'date and title' : !hasDate ? 'publish date' : 'title',
        reparsed: true
      }
    }).select().single();
    if (postErr) { console.error('  insert error:', postErr.message); continue; }
    createdIds.push(post.id);
    if (!primaryId) primaryId = post.id;
    console.log('  +', post.publish_date, '|', post.title?.slice(0,60), '→', '[' + post.status + ']');
  }

  const status = createdIds.length === 0 ? 'error' : (allHaveDateAndTitle ? 'created' : 'rejected');
  const errMsg = createdIds.length === 0 ? 'no posts inserted' : (!allHaveDateAndTitle ? `Parsed ${ai.posts.length} post(s); some missing date/title` : null);
  await sb.from('email_ingests').update({
    status,
    parsed: ai,
    matched_client_id: clientRow.id,
    created_post_id: primaryId,
    error: errMsg
  }).eq('id', ing.id);
  console.log('ingest →', status, '(', createdIds.length, 'posts)');
}
console.log('\nDone.');
