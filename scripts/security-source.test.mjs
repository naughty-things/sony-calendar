import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('schema exposes redacted task progress for every status to anon', async () => {
  const schema = await read('supabase/schema.sql');
  const migration = await read('supabase/migrations/20260714081654_expose_all_task_statuses.sql');
  for (const sql of [schema, migration]) {
    assert.doesNotMatch(sql, /grant\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\s+all\s+tables[\s\S]*?to\s+anon/i);
    assert.match(sql, /grant\s+select\s+on\s+(?:public\.)?public_calendar_posts\s+to\s+anon/i);
    assert.doesNotMatch(sql, /where\s+status\s+in\s*\(/i);
    assert.match(sql, /security_invoker\s*=\s*true/i);
    assert.match(sql, /public task progress/i);
    assert.match(sql, /using\s*\(\s*true\s*\)/i);
  }
  assert.match(schema, /auth\.jwt\(\)\s*->>\s*'email'/i);

  const view = migration.match(/create or replace view public\.public_calendar_posts[\s\S]*?from public\.posts\s*;/i)?.[0] ?? '';
  assert.ok(view);
  for (const privateColumn of ['email', 'notes', 'copy_draft', 'source_meta', 'raw_payload', 'parsed']) {
    assert.doesNotMatch(view, new RegExp(`\\b${privateColumn}\\b`, 'i'));
  }
  assert.doesNotMatch(migration, /alter publication supabase_realtime add table public\.posts/i);
});

test('privileged routes require server authorization and no query-string secret', async () => {
  const cron = await read('src/app/api/cron/poll/route.ts');
  const inbound = await read('src/app/api/inbound/poll/route.ts');
  const draft = await read('src/app/api/ai/draft/route.ts');
  assert.match(cron, /authorizePollRequest/);
  assert.match(inbound, /authorizePollRequest/);
  assert.doesNotMatch(cron + inbound, /searchParams\.get\(['"]secret['"]\)/);
  assert.doesNotMatch(inbound, /export async function GET/);
  assert.match(draft, /auth\.getUser\(\)/);
  assert.match(draft, /consumeRateLimit/);
  assert.match(draft, /MAX_BODY_BYTES/);
});

test('email ingestion gates senders and uses bounded calendar routing', async () => {
  const gmail = await read('src/lib/inbound/gmail.ts');
  assert.match(gmail, /isTrustedEnvelopeSender\(from\)/);
  assert.match(gmail, /routeEmailPost\(item\)/);
  assert.match(gmail, /publish_date: route\.publishDate/);
});
