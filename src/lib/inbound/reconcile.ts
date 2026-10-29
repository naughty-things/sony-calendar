import type { ParsedPost } from '../ai/parseEmailSchema.ts';

export type ThreadPost = {
  id: string;
  title: string;
  publish_date: string | null;
  notes?: string | null;
  status: string;
  updated_at: string;
  source_meta?: Record<string, any> | null;
};

export function normalizeThreadSubject(subject: string): string {
  return subject.trim().replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '').trim().toLowerCase();
}

const titleKey = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Dates are not identity: a reply may reschedule the same deliverable.
// Unknown or ambiguous matches fail closed rather than becoming duplicates.
export function matchThreadPost(item: ParsedPost, posts: ThreadPost[]): ThreadPost | null {
  if (item.existing_post_id) {
    const match = posts.find(p => p.id === item.existing_post_id);
    if (!match) throw new Error('Email references a post outside its thread');
    return match;
  }
  const matches = item.title ? posts.filter(p => titleKey(p.title) === titleKey(item.title!)) : [];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error('Thread contains duplicate post identities; review required');
  if (posts.length && !item.is_new_post) throw new Error('Uncertain reply-to-post match; review required');
  return null;
}

export function buildThreadUpdate(existing: ThreadPost, item: ParsedPost, gmailId: string, subject: string) {
  const meta = existing.source_meta || {};
  const applied: string[] = Array.isArray(meta.applied_email_ids) ? meta.applied_email_ids : [];
  if (applied.includes(gmailId) || meta.gmail_id === gmailId || meta.duplicate_of || meta.staging_closed_at) return null;
  const patch: Record<string, any> = {};
  for (const field of item.changed_fields) {
    const value = item[field];
    if (value == null || value === '') continue;
    if (field === 'notes') {
      patch.notes = [existing.notes, `[Email update: ${subject}]\n${value}`].filter(Boolean).join('\n\n');
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid reply date');
      patch[field] = value;
    }
  }
  if (!Object.keys(patch).length) return null;
  if (existing.status === 'staging' && patch.publish_date) patch.status = 'in_progress';
  patch.source_meta = { ...meta, latest_gmail_id: gmailId, applied_email_ids: [...applied, gmailId] };
  return patch;
}
