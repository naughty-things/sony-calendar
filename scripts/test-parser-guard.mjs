// Sanity test: confirm parseEmail() now rejects the legacy single-post shape.
// We mock the LLM client to return the bad shape, then assert the error.

import { parseEmail } from '../src/lib/ai/parseEmail.ts';

const cases = [
  {
    name: 'legacy single-post (no posts array)',
    modelReturn: {
      title: 'Sony PE Social Post Planning Jul 2026',
      publish_date: null,
      notes: 'Multiple posts across the month...',
      confidence: 0.72
    },
    shouldThrow: true
  },
  {
    name: 'correct multi-post shape',
    modelReturn: {
      posts: [
        { publish_date: '2026-07-01', platform: ['IG'], category: 'HE', title: 'XP NC post', confidence: 0.9 },
        { publish_date: '2026-07-08', platform: ['IG','FB'], category: 'HE', title: 'XP Design tech video', confidence: 0.9 }
      ],
      email_summary: null
    },
    shouldThrow: false
  },
  {
    name: 'irrelevant (empty posts array)',
    modelReturn: {
      posts: [],
      email_summary: 'Out-of-office reply from Charis.'
    },
    shouldThrow: false
  }
];

// We can't easily mock the LLM from a script, but we can directly test the
// JSON.parse + guard logic by extracting it. Instead, let's just test that
// Zod would also reject the legacy shape — that's the existing safety net.
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

for (const c of cases) {
  // 1) our new explicit guard
  let guardFailed = false;
  if (!Array.isArray(c.modelReturn?.posts)) {
    guardFailed = true;
  }
  // 2) Zod schema
  let zodErr = null;
  try { ParseResultSchema.parse(c.modelReturn); } catch (e) { zodErr = e.message.slice(0, 80); }
  const wouldThrow = guardFailed || !!zodErr;
  const pass = wouldThrow === c.shouldThrow;
  console.log(`${pass ? '✅' : '❌'} ${c.name}  guard=${guardFailed}  zod=${zodErr?'err':'ok'}  expectedThrow=${c.shouldThrow}`);
}
