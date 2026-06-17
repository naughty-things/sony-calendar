// AI email parser for forwarded emails into the SONY calendar.
// Uses MiniMax (MiniMax-M3) via the Anthropic-compatible API.
// Goal: never auto-publish. Always produce structured drafts that a human
// confirms in the UI before they become real tasks.
//
// One forwarded email can describe multiple posts (a planning table with
// one row per post, or a numbered list of briefs). The parser returns an
// ARRAY of posts so the ingest pipeline can create one staging post per
// row. The single-post case is just an array of length 1.

import { z } from 'zod';
import { getMinimax, MINIMAX_CHAT_MODEL } from './client';

const PostSchema = z.object({
  publish_date: z.string().nullable(),          // YYYY-MM-DD
  platform: z.array(z.string()).nullable(),     // IG, FB, Other
  category: z.string().nullable(),                // PA / HE / MO / DI / EC / INZONE / OTHER
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
export type ParsedPost = z.infer<typeof PostSchema>;

const ParseResultSchema = z.object({
  // Array of posts extracted from the email. Empty array is valid
  // (e.g. the email is irrelevant — a calendar invite, a thank-you note).
  posts: z.array(PostSchema),
  // Top-level notes about the email as a whole (e.g. "the SONY PE team
  // sent a June planning grid with 8 rows; Charis is on leave 24 Jun–7 Jul").
  // Not attached to any single post.
  email_summary: z.string().nullable()
});
export type ParseResult = z.infer<typeof ParseResultSchema>;

const SYSTEM = `You are an intake assistant for a SONY content calendar in Hong Kong.
A team member has forwarded an email to you. Your job is to extract every
post the email is describing. One email can describe one post or many posts
(common: a planning table with one row per post, or a numbered list of briefs).

For EACH post, extract:
- publish_date (YYYY-MM-DD). Today is ${new Date().toISOString().slice(0, 10)}.
  Interpret relative dates ("next Friday", "Thursday", "26 Jun") relative to
  today. If a post has no clear date, return null. Don't invent dates.
- platform: array of strings. Use codes: IG, FB, Other. A post can be
  cross-posted — e.g. "IG + FB" → ["IG","FB"]. If unknown, null.
- category: SONY product category if discernible. Codes: PA (pro audio),
  HE (headphones), MO (mobile / Xperia), DI (digital imaging — cameras,
  lenses), EC (consumer electronics), INZONE (gaming line), OTHER.
  If nothing matches, null.
- title: short, human-readable. e.g. "1000X Series (WF, WH – Pink & Sand
  stone, XP) Usage scenario Differentiation Social Post à WFM6". If the
  email is a table, the title usually lives in the "Content" column.
- notes: relevant context — campaign, product, copy direction, target
  audience, status from the table (e.g. "Launched", "NT revising",
  "Approved, plz schedule"). Keep it concise.
- designer (free-text name) if mentioned
- copy_writer (free-text name) if mentioned
- internal_pic (free-text name) — main internal contact
- client_pic (free-text name) — main client contact
- mentioned_internal, mentioned_client: arrays of names mentioned
- confidence 0-1 for this specific post

CRITICAL — TABLE HANDLING:
When the email contains a planning table (rows of: Date | Content | URL |
Status or similar), treat EACH ROW as a separate post. Do NOT collapse
multiple rows into a single post. Do NOT skip rows. Common mistakes to
avoid:
- Returning a single post with the email subject as title → WRONG. Each
  row is its own post.
- Skipping "Launched" rows → WRONG. Include them so we have a full record,
  even if they are already in the past.
- Skipping rows that are "NT revising" or "TBS" → WRONG. Include them; the
  human reviewer will decide whether to schedule them.
- Picking the first date in the email and using it for every post → WRONG.
  Each row has its own date.

Also extract:
- email_summary: a 1-2 sentence summary of the email as a whole (who sent
  it, what it is, anything relevant to all posts like "Charis on leave
  24 Jun – 7 Jul"). null if there's nothing useful to say.

Return ONLY a JSON object matching this exact shape. No prose, no markdown
fences:
{
  "posts": [ { "publish_date": "YYYY-MM-DD"|null, "platform": ["IG"]|null, "category": "HE"|null, "title": "...", "notes": "...", "designer": null, "copy_writer": null, "internal_pic": null, "client_pic": null, "mentioned_internal": [], "mentioned_client": [], "confidence": 0.0-1.0 } ],
  "email_summary": "..."|null
}

Examples:

1) Single-post email:
  Subject: "Sony WH-1000XM6 launch — 18 Jun, IG"
  Body: brief paragraph, no table
  → { "posts": [ { "publish_date": "2026-06-18", "platform": ["IG"], "category": "HE", "title": "WH-1000XM6 launch post", "notes": null, ..., "confidence": 0.95 } ], "email_summary": null }

2) Table-style email with 3 rows:
  Body:
    Target Launch Date | Content | URL | Status
    1 Jul              | XP Noise cancelling post | bit.ly/4xg7mU1 | Approved, plz schedule
    8 Jul              | XP Design - tech video | bit.ly/49U7Bdo | Approved, plz schedule
    15 Jul             | 1000X Series Usage scenario Differentiation à WFM6 | TBS | Plz help prepare
  → { "posts": [ { "publish_date": "2026-07-01", ... }, { "publish_date": "2026-07-08", ... }, { "publish_date": "2026-07-15", ... } ], "email_summary": "Sony PE team sent the July 2026 social planning grid; 3 posts scheduled/planned." }

3) Irrelevant email (out-of-office reply, calendar invite, thank-you note):
  → { "posts": [], "email_summary": "Out-of-office auto-reply from Charis (on leave 24 Jun – 7 Jul)." }

Tokens: keep titles short, notes ≤ 200 chars. Do not include URLs in the
output (we have them in the raw email if needed).`;

export async function parseEmail(input: {
  from: string;
  subject: string;
  body: string;
}): Promise<ParseResult> {
  const minimax = getMinimax();
  const msg = await minimax.messages.create({
    model: MINIMAX_CHAT_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `From: ${input.from}\nSubject: ${input.subject}\n\n${input.body.slice(0, 14000)}`
      }
    ]
  });
  // Anthropic-style response: content is an array of blocks
  const text = msg.content
    .map((b: any) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  // Strip accidental code fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const obj = JSON.parse(cleaned);

  // Guard against the LEGACY single-post shape (the parser used to expect
  // { title, publish_date, ... } at the top level). The new shape always
  // has a `posts` array. If a future model regression or a stale prompt
  // returns the legacy shape, we surface a loud, specific error instead
  // of silently creating a staging post with the email subject as the
  // title. This is a defensive check — ParseResultSchema.parse() would
  // also reject it, but with a generic ZodError that's harder to debug
  // in the email_ingests.error column.
  if (!Array.isArray((obj as any)?.posts)) {
    throw new Error(
      `parseEmail: model returned legacy single-post shape (no "posts" array). ` +
      `Top-level keys: ${Object.keys(obj || {}).join(', ')}. ` +
      `This usually means the system prompt was bypassed or the model regressed.`
    );
  }

  return ParseResultSchema.parse(obj);
}
