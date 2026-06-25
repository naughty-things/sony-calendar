#!/usr/bin/env node
// Backfill target_launch_date and request_date for the 5 in-progress
// MSS Workshop posts from Cheri's MSS email. Hard-coded since we know
// exactly which posts and which dates.
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/naughty/.openclaw/workspace/sony-calendar/.env', quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HDR = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };

// Post IDs from MSS ingest (from the diag_raymond.mjs output we ran earlier)
const MSS_INGEST_ID = '82fcfe03-ad83-428e-a3d2-68665799c062';

// Each post: title fragment -> { request_date, target_launch_date }
const updates = [
  { match: 'SA01 Workshop',                       request_date: '2026-06-10', target_launch_date: '2026-06-16' },
  { match: 'SA02A Workshop',                      request_date: '2026-06-19', target_launch_date: null },
  { match: 'Teens Workshop',                      request_date: '2026-06-23', target_launch_date: null },
  { match: 'Idol Chasing Workshop',               request_date: '2026-06-29', target_launch_date: null },
  { match: 'Portrait Workshop',                   request_date: '2026-07-06', target_launch_date: null }
];

async function main() {
  // Get all MSS posts
  const r = await fetch(`${url}/rest/v1/posts?select=id,title&source_meta->>ingest_id=eq.${MSS_INGEST_ID}`, { headers: HDR });
  const posts = await r.json();
  console.log(`found ${posts.length} MSS posts`);

  for (const p of posts) {
    const update = updates.find(u => p.title.includes(u.match));
    if (!update) {
      console.log(`  no match for "${p.title}", skipping`);
      continue;
    }
    const ru = await fetch(`${url}/rest/v1/posts?id=eq.${p.id}`, {
      method: 'PATCH',
      headers: HDR,
      body: JSON.stringify({
        target_launch_date: update.target_launch_date,
        request_date: update.request_date
      })
    });
    if (ru.ok) {
      const data = await ru.json();
      console.log(`  ✓ ${p.title}: request=${update.request_date}, target=${update.target_launch_date || '(null)'}`);
    } else {
      console.log(`  ✗ ${p.title}: ${ru.status} ${await ru.text()}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });