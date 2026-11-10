import test from 'node:test';
import assert from 'node:assert/strict';
import { postQuotaMonth, normalizeQuotaCount } from '../src/lib/types.ts';

test('publish month wins over an old email quota month, including posted records', () => {
  for (const status of ['in_progress', 'posted']) {
    const post = { publish_date: '2026-11-25', quota_month: '2026-10-01', quota_enabled: true, status };
    const before = { ...post };
    assert.equal(postQuotaMonth(post), '2026-11');
    assert.deepEqual(post, before);
    assert.equal(postQuotaMonth({ ...post, publish_date: '2026-10-31' }), '2026-10');
    assert.equal(postQuotaMonth({ ...post, publish_date: '2027-01-01' }), '2027-01');
  }
});

test('undated and quota-excluded posts do not count even with an old quota month', () => {
  const post = { publish_date: null, quota_month: '2026-10-01', quota_enabled: true };
  assert.equal(postQuotaMonth(post), '');
  assert.equal(postQuotaMonth({ ...post, publish_date: '2026-11-25', quota_enabled: false }), '');
});

test('month totals retain quota weights and follow rescheduling', () => {
  const posts = [
    { publish_date: '2026-10-31', quota_count: 2, quota_enabled: true },
    { publish_date: '2026-11-25', quota_count: 3, quota_enabled: true },
    { publish_date: '2026-11-26', quota_count: 5, quota_enabled: false },
    { publish_date: null, quota_count: 4, quota_enabled: true }
  ];
  const total = (month: string) => posts.filter(p => postQuotaMonth(p) === month)
    .reduce((sum, p) => sum + normalizeQuotaCount(p.quota_count), 0);
  assert.equal(total('2026-10'), 2);
  assert.equal(total('2026-11'), 3);
  posts[0].publish_date = '2026-11-01';
  assert.equal(total('2026-10'), 0);
  assert.equal(total('2026-11'), 5);
});
