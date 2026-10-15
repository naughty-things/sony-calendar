import { z } from 'zod';

export const PostSchema = z.object({
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
  category: z.array(z.string()).nullable(),      // PA / TV / MO / DI / EC / INZONE / OTHER (multi-value; a post can be e.g. ['PA','INZONE'])
  title: z.string().nullable(),
  notes: z.string().nullable(),
  // Unassigned people may be omitted by the model; treat them as unassigned.
  designer: z.string().nullable().default(null),
  copy_writer: z.string().nullable().default(null),
  internal_pic: z.string().nullable().default(null),
  client_pic: z.string().nullable().default(null),
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

export const ParseResultSchema = z.object({
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

