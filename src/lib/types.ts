export type PostStatus =
  | 'in_progress'
  | 'client_review'
  | 'approved'
  | 'posted';

/* Restricted to the 4 stages Sam wants — every other stage was a synonym
   or a leftover from the old pipeline. See migration 2026-06-17. */
export const STATUS_ORDER: PostStatus[] = [
  'in_progress',
  'client_review',
  'approved',
  'posted'
];

export const STATUS_LABEL: Record<PostStatus, string> = {
  in_progress:   'In progress',
  client_review: 'Client review',
  approved:      'Approved',
  posted:        'Posted'
};

/* Tape palette — like colored paper tape on a production board.
   Strong, saturated colors, no pastels. */
export const STATUS_COLOR: Record<PostStatus, string> = {
  in_progress:   'bg-[#D5E3F0] text-[#1E3A5F]',     // steel blue
  client_review: 'bg-[#F0D2DC] text-[#7A1A37]',     // dusty pink
  approved:      'bg-[#FFD66B] text-[#5A3A00]',     // SONY orange (matches accent palette)
  posted:        'bg-[#A8D5B5] text-[#15331F]'      // forest
};

/* SONY product line categories. Codes map to full names for display.
   PA  = Personal Audio      (was "Professional Audio" — Sam corrected)
   HE  = Headphones
   MO  = Mobile (Xperia)
   DI  = Digital Imaging (cameras + lenses)
   EC  = E-Commerce          (was just "EC" — Sam corrected)
   INZONE = INZONE gaming line
   OTHER = catch-all */
export const CATEGORIES = ['PA', 'HE', 'MO', 'DI', 'EC', 'INZONE', 'OTHER'] as const;
export type Category = typeof CATEGORIES[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  PA:     'Personal Audio',
  HE:     'Headphones',
  MO:     'Mobile',
  DI:     'Digital Imaging',
  EC:     'E-Commerce',
  INZONE: 'INZONE',
  OTHER:  'Other'
};
export const CATEGORY_GLYPH: Record<Category, string> = {
  PA:     'PA',
  HE:     'HE',
  MO:     'MO',
  DI:     'DI',
  EC:     'EC',
  INZONE: 'IZ',
  OTHER:  '··'
};

export const STATUS_DOT: Record<PostStatus, string> = {
  in_progress:   'bg-steel',
  client_review: 'bg-magenta',
  approved:      'bg-accent',
  posted:        'bg-forest'
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
  platform?: string[] | null;
  category?: string[] | null;  /* multi-value: ['HE','MO'] etc. */
  publish_date: string | null; // YYYY-MM-DD or null when in staging
  status: PostStatus;
  /* Free-text names (replaces FKs to people).
     The system remembers every name ever typed in each field
     and offers it back as autocomplete for future posts. */
  designer?: string | null;
  copy_writer?: string | null;
  internal_pic?: string | null;
  client_pic?: string | null;
  notes?: string | null;
  copy_draft?: string | null;
  source: 'manual' | 'email' | 'ai_draft';
  source_meta?: any;
  created_at: string;
  updated_at: string;
};

export type PostWithPeople = Post; // legacy alias — fields are now inline strings

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
  Other: '…'
};
export const PLATFORMS = ['IG', 'FB', 'Other'] as const;
export type Platform = typeof PLATFORMS[number];

/* Helpers for category arrays — used by the multi-select UI and filter. */
export function postCategories(post: Pick<Post, 'category'>): string[] {
  if (!post.category) return [];
  if (Array.isArray(post.category)) return post.category.filter(Boolean);
  // Legacy scalar fallback (DB migration in progress / row not yet migrated)
  return [post.category].filter(Boolean);
}