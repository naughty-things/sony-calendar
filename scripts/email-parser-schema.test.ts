import test from 'node:test';
import assert from 'node:assert/strict';
import { ParseResultSchema } from '../src/lib/ai/parseEmailSchema.ts';

const post = {
  publish_date: '2026-10-23',
  target_launch_date: '2026-10-23',
  request_date: '2026-10-14',
  platform: ['IG', 'FB'],
  category: ['DI'],
  title: 'My Sony Studio Workshop',
  notes: null,
  confidence: 0.9
};
const assignments = ['designer', 'copy_writer', 'internal_pic', 'client_pic'] as const;

test('accepts all four workshop posts when the model omits assignments', () => {
  const parsed = ParseResultSchema.parse({ posts: Array.from({ length: 4 }, () => ({ ...post })), email_summary: null });
  assert.equal(parsed.posts.length, 4);
  for (const item of parsed.posts) {
    for (const field of assignments) assert.equal(item[field], null);
    assert.equal(item.publish_date, post.publish_date);
  }
});

test('preserves explicit assignments and nulls', () => {
  const people = { designer: 'Jessica', copy_writer: null, internal_pic: 'Sam Lee', client_pic: null };
  const parsed = ParseResultSchema.parse({ posts: [{ ...post, ...people }], email_summary: null });
  for (const field of assignments) assert.equal(parsed.posts[0][field], people[field]);
});

test('still rejects invalid assignment types and malformed post results', () => {
  for (const field of assignments) {
    assert.equal(ParseResultSchema.safeParse({ posts: [{ ...post, [field]: 123 }], email_summary: null }).success, false);
  }
  assert.equal(ParseResultSchema.safeParse({ ...post, email_summary: null }).success, false);
  assert.equal(ParseResultSchema.safeParse({ posts: [{ ...post, confidence: 2 }], email_summary: null }).success, false);
});
