#!/usr/bin/env node
// Fetch Cheri's My Sony Studio email body as a JSON fixture for testing parseEmail
import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/naughty/.openclaw/workspace/sony-calendar/.env', quiet: true });

const GMAIL_ID = '19ef9484200eca8e';

const auth = new google.auth.JWT({
  email: process.env.GMAIL_SA_EMAIL,
  key: (process.env.GMAIL_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  subject: process.env.GMAIL_USER
});

const gmail = google.gmail({ version: 'v1', auth });

function header(headers, name) {
  return (headers || []).find(h => (h.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

function bodyFromPayload(payload) {
  if (!payload) return '';
  const candidates = [];
  const nonTextParts = [];
  function walk(p, depth) {
    if (!p) return;
    const mt = (p.mimeType || '').toLowerCase();
    if ((mt === 'text/plain' || mt === 'text/html') && p.body?.data) {
      candidates.push({ mime: mt, data: p.body.data, depth });
    } else if (p.filename && p.body?.attachmentId && !mt.startsWith('multipart/')) {
      nonTextParts.push(`${p.filename} (${mt || 'unknown'})`);
    }
    for (const child of p.parts || []) walk(child, depth + 1);
  }
  walk(payload, 0);
  const plain = candidates.filter(c => c.mime === 'text/plain');
  if (plain.length > 0) {
    plain.sort((a, b) => a.data.length - b.data.length);
    return Buffer.from(plain[0].data, 'base64').toString('utf8');
  }
  const html = candidates.filter(c => c.mime === 'text/html');
  if (html.length > 0) {
    html.sort((a, b) => a.data.length - b.data.length);
    return Buffer.from(html[0].data, 'base64').toString('utf8');
  }
  if (nonTextParts.length > 0) {
    return `[This email has no text body. The brief is in the following attachment(s): ${nonTextParts.join(', ')}. Please ask the human reviewer to open the attachment and fill in the post details manually.]`;
  }
  return '';
}

async function main() {
  const res = await gmail.users.messages.get({ userId: 'me', id: GMAIL_ID, format: 'full' });
  const msg = res.data;
  const from = header(msg.payload?.headers, 'From');
  const subject = header(msg.payload?.headers, 'Subject');
  const body = bodyFromPayload(msg.payload);
  process.stdout.write(JSON.stringify({ from, subject, body }, null, 2));
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });