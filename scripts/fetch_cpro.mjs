import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/naughty/.openclaw/workspace/sony-calendar/.env', quiet: true });
const GMAIL_ID = '19ef949b2fa26398';
const auth = new google.auth.JWT({
  email: process.env.GMAIL_SA_EMAIL,
  key: (process.env.GMAIL_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  subject: process.env.GMAIL_USER
});
const gmail = google.gmail({ version: 'v1', auth });
function header(h, n) { return (h||[]).find(x => (x.name||'').toLowerCase()===n.toLowerCase())?.value || ''; }
function bodyFromPayload(payload) {
  if (!payload) return '';
  const cands = [];
  const walk = (p) => {
    if (!p) return;
    const mt = (p.mimeType || '').toLowerCase();
    if ((mt === 'text/plain' || mt === 'text/html') && p.body?.data) cands.push({ mime: mt, data: p.body.data, len: p.body.data.length });
    for (const ch of p.parts || []) walk(ch);
  };
  walk(payload);
  const plain = cands.filter(c => c.mime === 'text/plain').sort((a,b)=>a.len-b.len);
  if (plain.length) return Buffer.from(plain[0].data, 'base64').toString('utf8');
  const html = cands.filter(c => c.mime === 'text/html').sort((a,b)=>a.len-b.len);
  if (html.length) return Buffer.from(html[0].data, 'base64').toString('utf8');
  return '';
}
const res = await gmail.users.messages.get({ userId: 'me', id: GMAIL_ID, format: 'full' });
const msg = res.data;
process.stdout.write(JSON.stringify({
  from: header(msg.payload?.headers, 'From'),
  subject: header(msg.payload?.headers, 'Subject'),
  body: bodyFromPayload(msg.payload)
}, null, 2));
