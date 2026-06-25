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
import { htmlTablesToMarkdown } from './htmlTable';

const PostSchema = z.object({
  publish_date: z.string().nullable(),          // YYYY-MM-DD
  // The "Target Launch Date" column from the planning table, if present.
  // This is the column Jennifer / Sony fills in when she knows when the
  // post goes live. May be null when the column is empty for that row.
  target_launch_date: z.string().nullable(),
  // The "Request Date" / "Copy Delivery Deadline" column from the planning
  // table, if present. This is when the client needs the creative copy
  // delivered (NOT when the post goes live). May be null when not
  // applicable. The human reviewer should ensure publish_date falls on
  // or before this date (or as close to it as the workshop timing
  // allows). Sam sometimes wants both surfaced in the calendar UI.
  request_date: z.string().nullable(),
  platform: z.array(z.string()).nullable(),     // IG, FB, Other
  category: z.array(z.string()).nullable(),      // PA / HE / MO / DI / EC / INZONE / OTHER (multi-value; a post can be e.g. ['HE','INZONE'])
  title: z.string().nullable(),
  notes: z.string().nullable(),
  designer: z.string().nullable(),
  copy_writer: z.string().nullable(),
  internal_pic: z.string().nullable(),
  client_pic: z.string().nullable(),
  mentioned_internal: z.array(z.string()).default([]),
  mentioned_client: z.array(z.string()).default([]),
  // Per-post confidence in the AI's own extraction. Drives routing:
  //   >= 0.8 -> client_review (auto-place on calendar)
  //   <  0.8 -> in_progress (staging, needs human review)
  // The poller also demotes any post that has parse_warnings.
  confidence: z.number().min(0).max(1),
  // Free-text human-readable warnings about THIS post specifically.
  // Examples: "Date is ambiguous; email has '16 Jun' next to 'Jul' workshop dates —
  // interpreted as 16 Jun but human should confirm";
  // "Target Launch Date missing; using first available date as fallback".
  parse_warnings: z.array(z.string()).default([])
});
export type ParsedPost = z.infer<typeof PostSchema>;

const ParseResultSchema = z.object({
  // Array of posts extracted from the email. Empty array is valid
  // (e.g. the email is irrelevant — a calendar invite, a thank-you note).
  posts: z.array(PostSchema),
  // Top-level notes about the email as a whole (e.g. "the SONY PE team
  // sent a June planning grid with 8 rows; Charis is on leave 24 Jun–7 Jul").
  // Not attached to any single post.
  email_summary: z.string().nullable(),
  // Did the AI detect a planning table in the email? If true, the poller
  // uses a stricter confidence threshold (>= 0.85) for client_review
  // routing because table-based emails are easier to get right but also
  // easier to confuse columns in.
  detected_table: z.boolean().default(false)
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
- category: ARRAY of strings (a post can span multiple SONY product lines,
  e.g. an INZONE headphone launch would be ["HE","INZONE"]). Codes: PA
  (personal audio), HE (headphones), MO (mobile / Xperia), DI (digital
  imaging — cameras, lenses), EC (e-commerce), INZONE (gaming line),
  OTHER. Always return [] if nothing matches.
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
- confidence 0-1 for this specific post (your own honest assessment of
  how confident you are in this extraction). Use < 0.7 when the email is
  ambiguous or missing info.
- parse_warnings: array of human-readable strings flagging anything the
  human reviewer should double-check. Always include one for each
  issue, e.g.:
  - "Date is ambiguous; the row contains both '16 Jun' and 'Jul' (the
    workshop dates). Interpreted as '16 Jun' because that matches the
    'Target Launch Date' column header, but please verify."
  - "Target Launch Date column is empty; using '17 Jul' from the
    workshop Date field as a best guess."
  - "Title appears truncated ('Sony A7C II fr…'); may need expansion."

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

CRITICAL — DATE EXTRACTION (this has bitten us before):
1. The publish_date of a post is the social-post go-live date, NOT the
   workshop/event date. In a planning table, look for a column literally
   titled "Target Launch Date" or "Post Date" or "Launch Date". The
   "Date" column by itself is usually the workshop date.
1a. Planning tables OFTEN have BOTH a "Request Date" / "Copy Delivery"
    column AND a "Target Launch Date" column. Extract BOTH separately:
    - target_launch_date = the "Target Launch Date" column value
      (the actual post go-live date — used for publish_date when set)
    - request_date       = the "Request Date" / "Copy Delivery" column
      value (when the client needs the creative copy delivered)
    If only "Target Launch Date" is filled in, request_date can be null.
    If only "Request Date" is filled in, request_date is set and
    target_launch_date is null (and publish_date should also be null
    because the launch date is genuinely unknown).
1b. The body you receive will have its tables converted to markdown
    with rowspan/colspan properly expanded (Request Date cells that
    span N rows will appear N times in the rendered table). Trust the
    rendered column alignment — if Request Date shows the same value
    for multiple rows, that's correct, not a parsing bug.
2. When a row contains MULTIPLE dates in close proximity (e.g. "16 Jun
   … Jul 8,13,15,22"), do NOT just grab the first date. Identify which
   date sits in the "Target Launch Date" column and use that. The other
   dates are likely workshop dates, request dates, or notes.
3. If "Target Launch Date" is empty for a row but the row has another
   date (e.g. a workshop date, an event date), DO NOT silently use that
   date. Set publish_date=null and add a parse_warning explaining.
   A null publish_date is fine — the human reviewer can fill it in.
4. If the email uses non-English date formats (e.g. 6月26日, 6月26日(星期五)),
   convert them to YYYY-MM-DD using today's year unless an explicit year
   is given. Day-of-week conflicts (the email says "Friday" but 6/26 is a
   Friday in 2026 — confirm) are a useful sanity check.

CRITICAL — DUPLICATE-FORWARDER AWARENESS:
Team members sometimes forward the same email multiple times. If you see
the email is a duplicate of one you've seen before (e.g. same sender,
same subject line, similar body), still extract the posts as if it's
the first time. The poller will dedupe by gmail_id (each forward gets a
new gmail_id), so we treat each email as fresh. The human reviewer will
catch true duplicates in the UI.

Also extract:
- email_summary: a 1-2 sentence summary of the email as a whole (who sent
  it, what it is, anything relevant to all posts like "Charis on leave
  24 Jun – 7 Jul"). null if there's nothing useful to say.
- detected_table: true if the email contains a planning table (rows of
  fields), false otherwise.

Return ONLY a JSON object matching this exact shape. No prose, no markdown
fences:
{
  "posts": [ { "publish_date": "YYYY-MM-DD"|null, "target_launch_date": "YYYY-MM-DD"|null, "request_date": "YYYY-MM-DD"|null, "platform": ["IG"]|null, "category": ["HE","INZONE"]|null, "title": "...", "notes": "...", "designer": null, "copy_writer": null, "internal_pic": null, "client_pic": null, "mentioned_internal": [], "mentioned_client": [], "confidence": 0.0-1.0, "parse_warnings": ["..."] } ],
  "email_summary": "..."|null,
  "detected_table": true|false
}

Examples:

1) Single-post email:
  Subject: "Sony WH-1000XM6 launch — 18 Jun, IG"
  Body: brief paragraph, no table
  → { "posts": [ { "publish_date": "2026-06-18", "platform": ["IG"], "category": ["HE"], "title": "WH-1000XM6 launch post", "notes": null, ..., "confidence": 0.95, "parse_warnings": [] } ], "email_summary": null, "detected_table": false }

2) Table-style email with 3 rows (column "Target Launch Date" present):
  Body:
    Target Launch Date | Content | URL | Status
    1 Jul              | XP Noise cancelling post | bit.ly/4xg7mU1 | Approved, plz schedule
    8 Jul              | XP Design - tech video | bit.ly/49U7Bdo | Approved, plz schedule
    15 Jul             | 1000X Series Usage scenario Differentiation à WFM6 | TBS | Plz help prepare
  → { "posts": [ { "publish_date": "2026-07-01", "target_launch_date": "2026-07-01", "request_date": null, "category": ["MO"], ..., "confidence": 0.95, "parse_warnings": [] }, { "publish_date": "2026-07-08", "target_launch_date": "2026-07-08", "request_date": null, "category": ["MO"], ..., "confidence": 0.95, "parse_warnings": [] }, { "publish_date": "2026-07-15", "target_launch_date": "2026-07-15", "request_date": null, "category": ["HE","MO"], ..., "confidence": 0.90, "parse_warnings": [] } ], "email_summary": "Sony PE team sent the July 2026 social planning grid; 3 posts scheduled/planned.", "detected_table": true }

3) Table-style email where Request Date AND Target Launch Date BOTH exist
   for every post (this is the SA01 bug case after we fixed the rowspan
   alignment). The body table is laid out with a single "Request Date"
   cell that spans all 5 rows (rowspan="5") and a "Target Launch Date"
   column with one date per row:
  Body:
    Post | Request Date | Target Launch Date | Cate. | Format | Content Focus | Promotion/Message
    1    | 10 Jun       | 16 Jun             | My Sony Studio | FBIG Wall Post | SA01     | Classroom Jul 8,13,15,22 ...
    2    | 10 Jun       | 19 Jun             | My Sony Studio | FBIG Wall Post | SA02A    | Jul 9,21 19:00-20:30
    3    | 10 Jun       | 23 Jun             | My Sony Studio | FBIG Wall Post | Teens    | Option 1: 17 Jul ...
    4    | 10 Jun       | 29 Jun             | My Sony Studio | FBIG Wall Post | Idol     | 18 Sat (TBC) ...
    5    | 10 Jun       | 6 Jul              | My Sony Studio | FBIG Wall Post | Portrait | 26 Jul (Sun) ...
  → { "posts": [
      { "publish_date": "2026-06-16", "target_launch_date": "2026-06-16", "request_date": "2026-06-10", "platform": ["IG","FB"], "category": ["DI"], "title": "My Sony Studio SA01 Workshop (Classroom + Outdoor)", "notes": "Request Date: 10 Jun (single cell spanning all 5 rows). Target Launch Date: 16 Jun. Classroom Jul 8,13,15,22 19:00-20:45 @ Sony Store TST; Outdoor Jul 25 14:00-16:00 @ Hong Kong Park. Cost $1,280.", "confidence": 0.95, "parse_warnings": ["Row contains both '16 Jun' (Target Launch Date) and 'Jul 8,13,15,22' (workshop dates); used '16 Jun' from the Target Launch Date column."] },
      { "publish_date": "2026-06-19", "target_launch_date": "2026-06-19", "request_date": "2026-06-10", "title": "My Sony Studio SA02A Workshop", "notes": "Request Date: 10 Jun (inherited from rowspan=5 cell). Target Launch Date: 19 Jun. Workshop Jul 9,21 19:00-20:30.", "confidence": 0.95, "parse_warnings": [] },
      { "publish_date": "2026-06-23", "target_launch_date": "2026-06-23", "request_date": "2026-06-10", "title": "My Sony Studio Teens Workshop", "notes": "Request Date: 10 Jun. Target Launch Date: 23 Jun. Workshop options: 17 Jul or 24 Jul.", "confidence": 0.9, "parse_warnings": [] },
      { "publish_date": "2026-06-29", "target_launch_date": "2026-06-29", "request_date": "2026-06-10", "title": "My Sony Studio Idol Chasing Workshop feat. 陳柏宇", "notes": "Request Date: 10 Jun. Target Launch Date: 29 Jun. Hard deadline 'share the post content by 16 Jun' for Sony Music review (earlier than launch). Workshop: 18 Sat (TBC).", "confidence": 0.9, "parse_warnings": ["Hard deadline 'share the post content by 16 Jun' for Sony Music review is earlier than Target Launch Date (29 Jun) — note for scheduling."] },
      { "publish_date": "2026-07-06", "target_launch_date": "2026-07-06", "request_date": "2026-06-10", "title": "My Sony Studio Portrait Workshop feat. a7rm6", "notes": "Request Date: 10 Jun. Target Launch Date: 6 Jul. Workshop: 26 Jul (Sun).", "confidence": 0.9, "parse_warnings": [] }
    ], "email_summary": "Jennifer Chan (Sony) shared July My Sony Studio workshop social posts; 5 posts total. Request Date / Target Launch Date columns visible (Request Date spans all 5 rows via HTML rowspan).", "detected_table": true }

  KEY POINTS (after the rowspan fix):
  - The "Request Date" cell uses rowspan="5" — ONE cell applies to all
    5 posts. Every row should have the SAME request_date (10 Jun here).
  - The "Target Launch Date" column has ONE cell per row with the
    actual per-post launch date. Use this for publish_date.
  - When the rendered table (in the body you'll receive) shows the
    Request Date column populated for every row, that's the system
    having correctly expanded the rowspan. Trust it.
  - If you ever see a table where the Request Date is the same value
    across multiple rows but Target Launch Date varies per row, that's
    the rowspan pattern. The same Request Date applies to all rows.

  WHY 2026-06-16 NOT 2026-07-16: The "Target Launch Date" column header
  explicitly labels the second date as the post launch date. The "Jul"
  dates in the Promotion column are the workshop dates themselves, not
  the post launch date. Setting publish_date to 2026-07-16 because "Jul"
  appears nearby is a CONFIRMED BUG.

4) Irrelevant email (out-of-office reply, calendar invite, thank-you note):
  → { "posts": [], "email_summary": "Out-of-office auto-reply from Charis (on leave 24 Jun – 7 Jul).", "detected_table": false }

Tokens: keep titles short, notes ≤ 200 chars. Do not include URLs in the
output (we have them in the raw email if needed).`;

// ---------------------------------------------------------------------------
// Pre-processing: detect table structure before sending to the model.
// ---------------------------------------------------------------------------

type ParsedTable = {
  /** Lines that look like header columns, in order. e.g. ["Post","Request Date","Target Launch Date","Cate.","Format","Content Focus","Promotion/Message"] */
  headers: string[];
  /** Body lines that look like table rows (one per post). */
  rows: string[];
};

/**
 * Heuristic table detector. Looks for sequences of lines in the body that
 * all look like column-list rows (multiple short tokens separated by
 * whitespace and/or pipes). If we find N+1 such lines where the first is
 * clearly a header row (column-name-ish words) and the rest look like
 * data rows, we treat it as a table.
 *
 * This is intentionally simple — we just want to flag table-shaped
 * emails so the AI prompt can lean harder on "use the Target Launch
 * Date column". The real parsing is still done by the model.
 */
function detectTable(body: string): ParsedTable | null {
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  // Look for runs of 3+ lines that look "table-like": each line has 4+
  // whitespace-separated tokens, AND at least 3 consecutive lines are
  // similar in token count.
  const tableLike = lines.filter(line => {
    const tokens = line.split(/\s+/);
    return tokens.length >= 4 && tokens.length <= 12 && line.length < 300;
  });

  // Find the first run of >= 3 consecutive table-like lines.
  for (let i = 0; i + 2 < tableLike.length; i++) {
    const run: string[] = [];
    for (let j = i; j < tableLike.length; j++) {
      const prev = tableLike[j - 1];
      const curr = tableLike[j];
      if (!prev || !curr) break;
      // Count tokens in prev and curr; allow +/- 1 difference for header
      // rows that have slightly more tokens (column names).
      const prevTokens = prev.split(/\s+/).length;
      const currTokens = curr.split(/\s+/).length;
      if (Math.abs(prevTokens - currTokens) > 2) break;
      run.push(tableLike[j]);
    }
    if (run.length >= 3) {
      return { headers: run[0].split(/\s+/), rows: run.slice(1) };
    }
  }
  return null;
}

/**
 * Post-parse sanity check: if a row's parsed publish_date differs from
 * another date that's also in the same row's text, demote confidence and
 * add a parse_warning. Specifically, the SA01 bug ("16 Jun" vs "Jul
 * workshop dates") had the model reading 16 Jul instead of 16 Jun.
 *
 * Strategy: find all date-like tokens in the row text. If more than one
 * candidate date is present and the parsed date matches the LESS-LIKELY
 * one (i.e. one whose month is the same as a nearby "Jul" / month-name
 * token but the column header says "Target Launch Date"), flag it.
 *
 * This is a coarse heuristic — the AI prompt is the primary defense.
 */
function reviewDates(parsed: ParseResult, body: string): ParseResult {
  const rows = body.split(/\r?\n/).map(l => l.trim());
  // Find month-name tokens in the body (Jul, Jun, Aug, ...).
  const monthTokens = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthCounts: Record<string, number> = {};
  for (const r of rows) {
    for (const m of monthTokens) {
      const re = new RegExp(`\\b${m}\\b`, 'g');
      const matches = r.match(re);
      if (matches) monthCounts[m] = (monthCounts[m] || 0) + matches.length;
    }
  }

  return {
    ...parsed,
    posts: parsed.posts.map((p, idx) => {
      // Skip posts without a parsed date or without source line context
      if (!p.publish_date) return p;
      const warnings: string[] = [...(p.parse_warnings || [])];

      // Extract month from parsed date
      const parsedMonth = parseInt(p.publish_date.split('-')[1], 10);
      const parsedMonthName = monthTokens[parsedMonth - 1];

      // If the parsed month is the second-most-common month in the email,
      // and a different month is the most common, flag as a possible
      // month confusion.
      const sortedMonths = Object.entries(monthCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([m]) => m);
      if (sortedMonths.length >= 2) {
        const [mostCommon, secondMostCommon] = sortedMonths;
        if (
          mostCommon !== parsedMonthName &&
          secondMostCommon === parsedMonthName &&
          (monthCounts[mostCommon] || 0) >= 3 &&
          (monthCounts[secondMostCommon] || 0) >= 1
        ) {
          warnings.push(
            `Parsed month ${parsedMonthName} but the email mentions "${mostCommon}" ${monthCounts[mostCommon]}x — ` +
            `verify the launch date isn't actually a ${mostCommon} date.`
          );
          return { ...p, parse_warnings: warnings, confidence: Math.min(p.confidence, 0.6) };
        }
      }
      return p;
    })
  };
}

export async function parseEmail(input: {
  from: string;
  subject: string;
  body: string;
}): Promise<ParseResult> {
  const minimax = getMinimax();

  // Pre-process: detect if the body has a planning table. We do this in
  // two layers:
  //
  // (a) If the body looks like raw HTML (Gmail sometimes falls back to
  //     the HTML part when text/plain is a tiny placeholder), run the
  //     rowspan/colspan-aware HTML→markdown converter on any <table>
  //     blocks. Plain-text Gmail rendering strips <table> structure
  //     and the AI loses column alignment — esp. when one cell uses
  //     rowspan="N" to label multiple rows with the same value (e.g.
  //     "Request Date: 10 Jun" applied to all 5 posts in Jennifer's
  //     MSS table).
  //
  // (b) Even after conversion, prepend a hint so the model knows to
  //     look at the "Target Launch Date" column for publish_date.
  let body = input.body;
  const isHtml = /<table[\s>]/i.test(body);
  if (isHtml) {
    const tables = htmlTablesToMarkdown(body);
    if (tables.length > 0) {
      // Replace each HTML <table>...</table> with the markdown table,
      // processed in reverse order so earlier indexes stay valid.
      let next = body;
      for (let i = tables.length - 1; i >= 0; i--) {
        const t = tables[i];
        next = next.slice(0, t.startIndex) + '\n' + t.md + '\n' + next.slice(t.endIndex);
      }
      body = next;
    }
  }
  const table = detectTable(body);
  if (table) {
    const headersHint = table.headers.join(' | ');
    body =
      `[TABLE DETECTED] The email body contains a planning-style table.\n` +
      `Column headers (in order): ${headersHint}\n` +
      `Pay special attention to the "Target Launch Date" column — that's ` +
      `the social-post go-live date. Other dates in the row (workshop ` +
      `dates, request dates) are NOT the launch date.\n\n` +
      `---\n\n` +
      body;
  }

  const msg = await minimax.messages.create({
    model: MINIMAX_CHAT_MODEL,
    max_tokens: 6144, // increased from 4096: parse_warnings can be verbose on table emails
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `From: ${input.from}\nSubject: ${input.subject}\n\n${body.slice(0, 14000)}`
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

  // Pre-populate parse_warnings if missing (older model responses may
  // omit the field). Also pre-populate target_launch_date / request_date
  // for backward compat with older prompts that didn't extract them.
  for (const post of (obj as any).posts) {
    if (!Array.isArray(post.parse_warnings)) post.parse_warnings = [];
    if (typeof post.target_launch_date === 'undefined') {
      // If the model didn't separate target_launch_date from publish_date,
      // backfill it from publish_date (the legacy assumption).
      post.target_launch_date = post.publish_date || null;
    }
    if (typeof post.request_date === 'undefined') {
      post.request_date = null;
    }
    // If publish_date is null but target_launch_date is set, default
    // publish_date to target_launch_date. The "Target Launch Date"
    // column IS the post launch date — if the AI captured it as
    // target_launch_date but somehow forgot to set publish_date, we
    // assume they're the same. (The poller's routing logic also falls
    // back to this when target_launch_date is set, but it's cleaner to
    // make publish_date the source of truth.)
    if (!post.publish_date && post.target_launch_date) {
      post.publish_date = post.target_launch_date;
    }
  }
  if (typeof (obj as any).detected_table !== 'boolean') {
    (obj as any).detected_table = !!table;
  }

  const parsed = ParseResultSchema.parse(obj);

  // Post-parse date sanity check (the SA01 Jun/Jul confusion guard).
  return reviewDates(parsed, input.body);
}