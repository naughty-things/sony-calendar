import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath } from '../src/lib/auth/redirect.ts';
import { authorizePollRequest } from '../src/lib/security/pollAuth.ts';
import { consumeRateLimit } from '../src/lib/security/rateLimit.ts';
import { isTrustedEnvelopeSender } from '../src/lib/inbound/senderPolicy.ts';
import { validateDraftRequest } from '../src/lib/ai/draftRequest.ts';
import { routeEmailPost } from '../src/lib/inbound/routing.ts';

test('safeReturnPath preserves local paths and rejects script or external URLs', () => {
  assert.equal(safeReturnPath('/calendar?month=2026-07#day-1'), '/calendar?month=2026-07#day-1');
  for (const value of [
    'javascript:alert(1)',
    'https://evil.example/path',
    '//evil.example/path',
    '/\\evil.example/path',
    '/%5c%5cevil.example/path',
    '%2f%2fevil.example/path'
  ]) {
    assert.equal(safeReturnPath(value), '/', value);
  }
});

test('poll authorization fails closed and never accepts query-string secrets', () => {
  const request = (url: string, headers: HeadersInit = {}) => new Request(url, { headers });
  assert.deepEqual(
    authorizePollRequest(request('https://calendar.example/api/cron/poll'), { NODE_ENV: 'production', POLL_SECRET: undefined }),
    { ok: false, status: 503, error: 'poll endpoint is not configured' }
  );
  assert.equal(
    authorizePollRequest(request('https://calendar.example/api/cron/poll?secret=correct'), { NODE_ENV: 'production', POLL_SECRET: 'correct' }).ok,
    false
  );
  assert.equal(
    authorizePollRequest(request('https://calendar.example/api/cron/poll', { authorization: 'Bearer correct' }), { NODE_ENV: 'production', POLL_SECRET: 'correct' }).ok,
    true
  );
  assert.equal(
    authorizePollRequest(request('http://localhost:3001/api/inbound/poll'), { NODE_ENV: 'development', POLL_SECRET: undefined }).ok,
    true
  );
});

test('rate limit rejects requests after the fixed-window allowance', () => {
  const key = `test-${Date.now()}`;
  assert.equal(consumeRateLimit(key, 2, 60_000, 1_000).allowed, true);
  assert.equal(consumeRateLimit(key, 2, 60_000, 1_001).allowed, true);
  assert.equal(consumeRateLimit(key, 2, 60_000, 1_002).allowed, false);
  assert.equal(consumeRateLimit(key, 2, 60_000, 61_001).allowed, true);
});

test('inbound sender policy accepts the internal forwarding domain only', () => {
  assert.equal(isTrustedEnvelopeSender('Sam <sam@naughtythings.com.hk>'), true);
  assert.equal(isTrustedEnvelopeSender('Sam <sam@sub.naughtythings.com.hk>'), true);
  assert.equal(isTrustedEnvelopeSender('attacker@example.com'), false);
});

test('draft request validation enforces field types and bounds', () => {
  assert.deepEqual(
    validateDraftRequest({ title: ' Launch ', platform: ['IG'], notes: 'copy' }),
    { title: 'Launch', platform: ['IG'], notes: 'copy' }
  );
  assert.equal(validateDraftRequest({ title: '', platform: ['IG'] }), null);
  assert.equal(validateDraftRequest({ title: 'x', platform: ['IG'], notes: 'n'.repeat(5_001) }), null);
});

test('email posts with concrete launch dates go to the calendar', () => {
  assert.deepEqual(
    routeEmailPost({
      title: 'Launch post',
      target_launch_date: '2026-08-12',
      confidence: 0.95,
      parse_warnings: []
    }),
    {
      publishDate: '2026-08-12',
      status: 'client_review',
      reason: 'clear launch date and complete high-confidence brief'
    }
  );
  assert.equal(
    routeEmailPost({
      title: 'Needs a date check',
      publish_date: '2026-08-13',
      confidence: 0.6,
      parse_warnings: ['Please verify the date']
    }).status,
    'in_progress'
  );
  assert.equal(
    routeEmailPost({ title: 'Undated task', publish_date: null, target_launch_date: null }).status,
    'staging'
  );
});
