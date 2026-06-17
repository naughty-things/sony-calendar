import { z } from 'zod';

const PostSchema = z.object({
  publish_date: z.string().nullable(),
  platform: z.array(z.string()).nullable(),
  category: z.string().nullable(),
  title: z.string().nullable(),
  notes: z.string().nullable(),
  designer: z.string().nullable(),
  copy_writer: z.string().nullable(),
  internal_pic: z.string().nullable(),
  client_pic: z.string().nullable(),
  mentioned_internal: z.array(z.string()).default([]),
  mentioned_client: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1)
});
const ParseResultSchema = z.object({
  posts: z.array(PostSchema),
  email_summary: z.string().nullable()
});

const multi = { posts: [{
  publish_date: '2026-07-01', platform: null, category: null, title: 'A',
  notes: null, designer: null, copy_writer: null, internal_pic: null, client_pic: null,
  mentioned_internal: [], mentioned_client: [], confidence: 0.9
}], email_summary: null };

const legacy = { title: 'X', publish_date: null, notes: 'foo', confidence: 0.72 };

const empty = { posts: [], email_summary: 'oof' };

// New explicit guard (mimics the code we just added)
function newGuard(obj: any) {
  if (!Array.isArray(obj?.posts)) {
    throw new Error('parseEmail: model returned legacy single-post shape (no "posts" array). ' +
      `Top-level keys: ${Object.keys(obj || {}).join(', ')}.`);
  }
  return ParseResultSchema.parse(obj);
}

for (const [name, input, shouldThrow] of [
  ['legacy', legacy, true],
  ['multi', multi, false],
  ['empty', empty, false]
] as const) {
  let err: any = null;
  try { newGuard(input); } catch (e: any) { err = e.message.slice(0, 100); }
  const threw = !!err;
  console.log(`${threw === shouldThrow ? '✅' : '❌'} ${name}: threw=${threw} expected=${shouldThrow} ${err ? '— ' + err : ''}`);
}
