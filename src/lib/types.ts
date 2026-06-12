export type PostStatus =
  | 'draft'
  | 'in_progress'
  | 'needs_review'
  | 'client_review'
  | 'approved'
  | 'scheduled'
  | 'posted'
  | 'blocked'
  | 'archived';

export const STATUS_ORDER: PostStatus[] = [
  'draft',
  'in_progress',
  'needs_review',
  'client_review',
  'approved',
  'scheduled',
  'posted',
  'blocked',
  'archived'
];

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  needs_review: 'Needs review',
  client_review: 'Client review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  posted: 'Posted',
  blocked: 'Blocked',
  archived: 'Archived'
};

/* Tape palette — like colored paper tape on a production board.
   Strong, saturated colors, no pastels. */
export const STATUS_COLOR: Record<PostStatus, string> = {
  draft:        'bg-[#E5E1D5] text-ink',
  in_progress:  'bg-[#D5E3F0] text-[#1E3A5F]',     // steel blue
  needs_review: 'bg-[#FFE6A8] text-[#6E4A00]',     // warm amber (tape)
  client_review:'bg-[#F0D2DC] text-[#7A1A37]',     // dusty pink
  approved:     'bg-[#CDE9D0] text-[#1F4429]',     // soft forest
  scheduled:    'bg-[#D4DAE4] text-[#2A3142]',     // cool slate
  posted:       'bg-[#A8D5B5] text-[#15331F]',     // forest
  blocked:      'bg-[#E8C4B8] text-[#7A2B16]',     // rust
  archived:     'bg-[#D6D2C4] text-ink-faint'
};

export const STATUS_DOT: Record<PostStatus, string> = {
  draft:        'bg-ink-faint',
  in_progress:  'bg-steel',
  needs_review: 'bg-accent',
  client_review:'bg-magenta',
  approved:     'bg-emerald-700',
  scheduled:    'bg-slate-500',
  posted:       'bg-forest',
  blocked:      'bg-rust',
  archived:     'bg-ink-faint'
};

export type Person = {
  id: string;
  name: string;
  email?: string | null;
  side: 'internal' | 'client';
  role?: string | null;
};

export type Post = {
  id: string;
  client_id: string;
  title: string;
  platform?: string | null;
  publish_date: string; // YYYY-MM-DD
  status: PostStatus;
  internal_assignee_id?: string | null;
  internal_pic_id?: string | null;
  client_pic_id?: string | null;
  notes?: string | null;
  copy_draft?: string | null;
  source: 'manual' | 'email' | 'ai_draft';
  source_meta?: any;
  created_at: string;
  updated_at: string;
};

export type PostWithPeople = Post & {
  internal_assignee?: Person | null;
  internal_pic?: Person | null;
  client_pic?: Person | null;
};

/* Small helper to get initials for avatar fallback */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
}

/* Platform → small icon + label tweaks */
export const PLATFORM_GLYPH: Record<string, string> = {
  IG: 'IG',
  FB: 'FB',
  X: 'X',
  LinkedIn: 'in',
  TikTok: 'TT',
  YouTube: 'YT',
  Blog: 'BL',
  Email: 'EM',
  Other: '…'
};
