#!/usr/bin/env node
// Fetch Cheri's MSS email HTML, run the rowspan-aware table converter,
// then call parseEmail with that as the body. Should produce correct dates.
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/naughty/.openclaw/workspace/sony-calendar/.env', quiet: true });
import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

const auth = new google.auth.JWT({
  email: process.env.GMAIL_SA_EMAIL,
  key: (process.env.GMAIL_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  subject: process.env.GMAIL_USER
});
const gmail = google.gmail({ version: 'v1', auth });

const gmailId = process.argv[2] || '19ef9484200eca8e';
const msg = await gmail.users.messages.get({ userId: 'me', id: gmailId, format: 'full' });

function walk(parts, out = []) {
  if (!parts) return out;
  for (const p of parts) {
    if ((p.mimeType || '').toLowerCase() === 'text/html' && p.body?.data) {
      out.push(Buffer.from(p.body.data, 'base64').toString('utf8'));
    }
    if (p.parts) walk(p.parts, out);
  }
  return out;
}
const html = walk(msg.data.payload?.parts || [msg.data.payload])[0];

// Run the converter (inline since it's TS)
function tableToMarkdown(tableHtml) {
  tableHtml = tableHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  tableHtml = tableHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    const cells = [];
    const tdRe = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      const attrs = tdMatch[1];
      const colspan = parseInt((attrs.match(/colspan="(\d+)"/) || [])[1] || '1', 10);
      const rowspan = parseInt((attrs.match(/rowspan="(\d+)"/) || [])[1] || '1', 10);
      let text = tdMatch[2]
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<p[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ').trim();
      cells.push({ text, colspan, rowspan });
    }
    rows.push(cells);
  }
  if (rows.length === 0) return '';
  const numCols = Math.max(...rows.map(r => r.reduce((s, c) => s + c.colspan, 0)));
  const grid = [];
  for (let i = 0; i < rows.length; i++) grid[i] = new Array(numCols).fill('');
  const span = new Array(numCols).fill(null);
  for (let r = 0; r < rows.length; r++) {
    let col = 0, cellIdx = 0;
    while (col < numCols) {
      const active = span[col];
      if (active) {
        grid[r][col] = active.text;
        active.remaining--;
        if (active.remaining <= 0) span[col] = null;
        col++;
      } else if (cellIdx < rows[r].length) {
        const cell = rows[r][cellIdx];
        for (let k = 0; k < cell.colspan; k++) {
          grid[r][col + k] = cell.text;
          if (cell.rowspan > 1) span[col + k] = { remaining: cell.rowspan - 1, text: cell.text };
        }
        col += cell.colspan;
        cellIdx++;
      } else col++;
    }
  }
  const esc = (s) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const trunc = (s, n = 200) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const md = [];
  md.push('| ' + grid[0].map(esc).join(' | ') + ' |');
  md.push('| ' + grid[0].map(() => '---').join(' | ') + ' |');
  for (let r = 1; r < grid.length; r++) md.push('| ' + grid[r].map(c => trunc(esc(c))).join(' | ') + ' |');
  return md.join('\n');
}

const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
let m, tables = [];
while ((m = tableRe.exec(html)) !== null) tables.push(tableToMarkdown(m[0]));

console.log('=== Markdown tables extracted ===');
for (let i = 0; i < tables.length; i++) {
  console.log(`\n--- Table ${i + 1} ---`);
  console.log(tables[i]);
}

// Build body
let body = html;
for (let i = tables.length - 1; i >= 0; i--) {
  // crude replace
}
body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
           .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
           .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
           .replace(/<\/p>/gi, '\n\n').replace(/<p[^>]*>/gi, '')
           .replace(/<br\s*\/?>/gi, '\n')
           .replace(/<[^>]+>/g, '')
           .replace(/&nbsp;/g, ' ')
           .replace(/&amp;/g, '&')
           .replace(/\n{3,}/g, '\n\n').trim();
// Splice tables in
const firstHeaderMatch = body.indexOf('Dear Cheri');
if (firstHeaderMatch > 0) {
  // Replace the broken text/plain table section with our clean markdown tables
  const prose = body.slice(0, firstHeaderMatch);
  body = prose + '\n\n' + tables.join('\n\n') + '\n\n' + body.slice(firstHeaderMatch);
}

// Read SYSTEM from parseEmail.ts
const parseEmailSource = readFileSync('/Users/naughty/.openclaw/workspace/sony-calendar/src/lib/ai/parseEmail.ts', 'utf8');
const systemMatch = parseEmailSource.match(/const SYSTEM = `([\s\S]*?)`;/);
const SYSTEM = systemMatch ? systemMatch[1] : '';

const subject = msg.data.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || '';
const from = msg.data.payload?.headers?.find(h => h.name.toLowerCase() === 'from')?.value || '';

console.log('\n=== Calling AI ===');
const client = new Anthropic({ apiKey: process.env.MINIMAX_API_KEY, baseURL: 'https://api.minimax.io/anthropic' });
const t0 = Date.now();
const aiMsg = await client.messages.create({
  model: process.env.MINIMAX_MODEL || 'MiniMax-M3',
  max_tokens: 6144,
  system: SYSTEM,
  messages: [{ role: 'user', content: `From: ${from}\nSubject: ${subject}\n\n${body.slice(0, 14000)}` }]
});
console.log(`AI took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const text = aiMsg.content.map(b => b.type === 'text' ? b.text : '').join('').trim();
const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
const parsed = JSON.parse(cleaned);
console.log('=== Parsed posts ===');
for (let i = 0; i < parsed.posts.length; i++) {
  const p = parsed.posts[i];
  console.log(`[${i}] pub=${p.publish_date || '(null)'}  target=${p.target_launch_date || '(null)'}  req=${p.request_date || '(null)'}  conf=${p.confidence}`);
  console.log(`    ${p.title}`);
  if (p.parse_warnings?.length) console.log(`    warnings: ${p.parse_warnings.join(' | ')}`);
}