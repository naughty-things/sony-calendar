// AI email parser for forwarded emails into the SONY calendar.
// Uses MiniMax (MiniMax-M3) via the Anthropic-compatible API.
// Goal: never auto-publish. Always produce a structured draft that a human
// confirms in the UI before it becomes a real task.

import { z } from 'zod';
import { getMinimax, MINIMAX_CHAT_MODEL } from './client';

const ParsedEmailSchema = z.object({
  publish_date: z.string().nullable(),          // YYYY-MM-DD
  platform: z.string().nullable(),               // IG, FB, YouTube, Email, Other
  title: z.string().nullable(),
  notes: z.string().nullable(),
  mentioned_internal: z.array(z.string()).default([]),
  mentioned_client: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1)
});
export type ParsedEmail = z.infer<typeof ParsedEmailSchema>;

const SYSTEM = `You are an intake assistant for a content calendar.
A team member has forwarded an email to you. Extract:
- the proposed publish date (today is ${new Date().toISOString().slice(0, 10)}; interpret "next Friday" etc. relative to today)
- the platform (IG, FB, YouTube, Email, Other)
- a short title for the post
- relevant notes (campaign name, product, copy direction)
- names of any internal team members mentioned
- names of any client-side people mentioned
- a confidence score 0-1

If a field is unknown, return null. Do not invent dates. Return ONLY a JSON object matching this exact shape — no prose, no markdown fences:
{"publish_date": string|null, "platform": string|null, "title": string|null, "notes": string|null, "mentioned_internal": string[], "mentioned_client": string[], "confidence": number}`;

export async function parseEmail(input: {
  from: string;
  subject: string;
  body: string;
}): Promise<ParsedEmail> {
  const minimax = getMinimax();
  const msg = await minimax.messages.create({
    model: MINIMAX_CHAT_MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `From: ${input.from}\nSubject: ${input.subject}\n\n${input.body.slice(0, 6000)}`
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
  return ParsedEmailSchema.parse(obj);
}
