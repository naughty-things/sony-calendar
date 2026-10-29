import test from 'node:test';
import assert from 'node:assert/strict';
import { PostSchema } from '../src/lib/ai/parseEmailSchema.ts';
import { buildThreadUpdate, matchThreadPost, normalizeThreadSubject } from '../src/lib/inbound/reconcile.ts';

const original = {
  id: '0f85f9f4-889a-4634-a5ac-b6cb2cba16e1',
  title: 'LinkBuds Clip trade-in offer', publish_date: '2026-11-01',
  status: 'approved', notes: 'Human-edited brief', updated_at: '2026-10-29T02:00:00Z',
  source_meta: { gmail_id: 'original', ingest_id: 'first', custom: 'preserve' },
  copy_draft: 'Human copy', designer: 'Jessica', quota_month: '2026-10-01'
};
const ear = { ...original, id: '78357113-2ed9-4b51-9af4-6a1751257c52', title: 'WH-1000XM6 ear pad announcement and launch', publish_date: '2026-11-09' };
const parsed = (overrides: Record<string, unknown> = {}) => PostSchema.parse({
  title: original.title, publish_date: '2026-11-01', target_launch_date: '2026-11-01',
  request_date: null, notes: null, platform: null, category: ['EC', 'PA'], confidence: .9, ...overrides
});

test('Cheri reply with quoted original rows resolves to existing posts without inserting or rewriting', () => {
  for (const existing of [original, ear]) {
    const item = parsed({ title: existing.title });
    assert.equal(matchThreadPost(item, [original, ear])?.id, existing.id);
    assert.equal(buildThreadUpdate(existing, item, 'cheri-reply', 'Re: [Sony] PE EC post for Nov'), null);
  }
});

test('Barnard reply updates the ear-pad date despite a revised title, adds layout notes, and creates only the new warranty post', () => {
  const items = [
    parsed({ title: 'WH-1000XM6 ear pad launch', existing_post_id: ear.id, publish_date: '2026-11-25', target_launch_date: '2026-11-25', notes: 'SRP $349', changed_fields: ['publish_date', 'target_launch_date', 'notes'] }),
    parsed({ existing_post_id: original.id, notes: 'Use a new layout', changed_fields: ['notes'] }),
    parsed({ title: 'PE warranty registration extension post', is_new_post: true, publish_date: null, target_launch_date: null })
  ];
  const matches = items.map(item => matchThreadPost(item, [original, ear]));
  assert.equal(matches.filter(match => !match).length, 1);
  const datePatch = buildThreadUpdate(ear, items[0], 'barnard-reply', 'RE: brief')!;
  assert.equal(datePatch.publish_date, '2026-11-25');
  assert.equal(datePatch.target_launch_date, '2026-11-25');
  assert.match(datePatch.notes, /SRP \$349/);
  const layoutPatch = buildThreadUpdate(original, items[1], 'barnard-reply', 'RE: brief')!;
  assert.match(layoutPatch.notes, /^Human-edited brief/);
  assert.match(layoutPatch.notes, /new layout/);
  for (const field of ['title', 'status', 'copy_draft', 'designer', 'quota_month', 'publish_date']) assert.equal(field in layoutPatch, false);
  assert.equal(layoutPatch.source_meta.custom, 'preserve');
});

test('unknown IDs, uncertain identity and ambiguous pre-existing duplicates cannot create posts', () => {
  assert.throws(() => matchThreadPost(parsed({ existing_post_id: '56675541-0d03-4b15-a4c9-52f3f2187e53' }), [original]), /outside/);
  assert.throws(() => matchThreadPost(parsed({ title: 'Renamed unclear post' }), [original]), /Uncertain/);
  assert.throws(() => matchThreadPost(parsed(), [original, { ...original, id: ear.id }]), /duplicate/);
});

test('reply updates are idempotent and do not reopen closed or merged posts', () => {
  const item = parsed({ changed_fields: ['notes'], notes: 'Layout update' });
  const patch = buildThreadUpdate(original, item, 'reply', 'Re: brief')!;
  assert.equal(buildThreadUpdate({ ...original, ...patch }, item, 'reply', 'Re: brief'), null);
  for (const meta of [{ staging_closed_at: 'yesterday' }, { duplicate_of: ear.id }]) {
    assert.equal(buildThreadUpdate({ ...original, source_meta: meta }, item, 'reply', 'Re: brief'), null);
  }
});

test('only an explicit concrete date update moves an undated staging item onto the calendar', () => {
  const staging = { ...original, status: 'staging', publish_date: null };
  const patch = buildThreadUpdate(staging, parsed({ changed_fields: ['publish_date'] }), 'reply', 'Re: brief')!;
  assert.equal(patch.status, 'in_progress');
  assert.equal(patch.publish_date, '2026-11-01');
  const vague = buildThreadUpdate(staging, parsed({ publish_date: null, changed_fields: ['publish_date'] }), 'reply', 'Re: brief');
  assert.equal(vague, null);
});

test('re-forwarded subjects normalize without merging unrelated campaign subjects', () => {
  assert.equal(normalizeThreadSubject('  RE: Fwd: FW: [Sony] PE EC post for Nov '), '[sony] pe ec post for nov');
  assert.notEqual(normalizeThreadSubject('[Sony] PE EC post for Dec'), normalizeThreadSubject('[Sony] PE EC post for Nov'));
});
