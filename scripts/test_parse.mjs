#!/usr/bin/env node
// Test the parseEmail prompt on real fixtures. Uses tsx-style runtime via
// Next.js's compiled API by calling the /api/ai/draft endpoint? No — that
// needs a session. Instead, we call the Anthropic SDK directly with the
// same system prompt as parseEmail.
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/naughty/.openclaw/workspace/sony-calendar/.env', quiet: true });
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

const apiKey = process.env.MINIMAX_API_KEY;
const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';

// Inline a copy of the SYSTEM prompt + detectTable from parseEmail.ts.
// (Kept in sync by the test runner — both files reference the same source.)
// We import them via dynamic eval to avoid duplication.
const parseEmailSource = readFileSync(
  '/Users/naughty/.openclaw/workspace/sony-calendar/src/lib/ai/parseEmail.ts',
  'utf8'
);
const systemMatch = parseEmailSource.match(/const SYSTEM = `([\s\S]*?)`;/);
const SYSTEM = systemMatch ? systemMatch[1] : '';

const client = new Anthropic({ apiKey, baseURL: 'https://api.minimax.io/anthropic' });

async function runTest(name, fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  console.log(`\n=== ${name} ===`);
  console.log('From:', fixture.from);
  console.log('Subject:', fixture.subject);
  console.log('Body chars:', fixture.body.length);

  // Replicate detectTable
  const lines = fixture.body.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const tableLike = lines.filter(line => {
    const tokens = line.split(/\s+/);
    return tokens.length >= 4 && tokens.length <= 12 && line.length < 300;
  });
  let tableDetected = false;
  for (let i = 0; i + 2 < tableLike.length; i++) {
    let runLen = 1;
    for (let j = i + 1; j < tableLike.length; j++) {
      const a = tableLike[j - 1].split(/\s+/).length;
      const b = tableLike[j].split(/\s+/).length;
      if (Math.abs(a - b) > 2) break;
      runLen++;
    }
    if (runLen >= 3) { tableDetected = true; break; }
  }
  console.log('Table detected:', tableDetected);

  const t0 = Date.now();
  const msg = await client.messages.create({
    model,
    max_tokens: 6144,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `From: ${fixture.from}\nSubject: ${fixture.subject}\n\n${fixture.body.slice(0, 14000)}`
    }]
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const text = msg.content.map(b => b.type === 'text' ? b.text : '').join('').trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) {
    console.log('JSON PARSE FAILED:', e.message);
    console.log('Raw text:', text.slice(0, 500));
    return;
  }
  console.log(`API elapsed: ${elapsed}s, input tokens: ${msg.usage?.input_tokens}, output: ${msg.usage?.output_tokens}`);
  console.log('Posts parsed:', parsed.posts.length);
  console.log('Email summary:', parsed.email_summary);
  for (let i = 0; i < parsed.posts.length; i++) {
    const p = parsed.posts[i];
    console.log(`  [${i}] ${p.publish_date || '(no date)'}  conf=${p.confidence}  ${(p.title||'').slice(0,60)}`);
    if (p.target_launch_date) console.log(`      target_launch_date: ${p.target_launch_date}`);
    if (p.request_date) console.log(`      request_date: ${p.request_date}`);
    if (p.parse_warnings && p.parse_warnings.length) {
      console.log(`      warnings: ${p.parse_warnings.join(' | ')}`);
    }
  }
}

await runTest('MSS Workshop (SA01 Jun/Jul bug case)', '/tmp/mss_fixture.json');
await runTest('CPRO (wrong-date duplicate case)', '/tmp/cpro_fixture.json');