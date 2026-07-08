export type PostStatus =
  | 'staging'
  | 'in_progress'
  | 'client_review'
  | 'approved'
  | 'posted';

/* 'staging' is the pre-in_progress state added 2026-06-25. A post lands
   in staging when the email parser couldn't pin down a publish_date
   (e.g. the email said "Target Launch Date: Within this week" instead
   of an exact date). PIC then opens the modal, fills in the date, and
   the status auto-transitions to in_progress. See migration
   2026-06-25-staging-status.sql for the matching DB change. */
export const STATUS_ORDER: PostStatus[] = [
  'staging',
  'in_progress',
  'client_review',
  'approved',
  'posted'
];

export const STATUS_LABEL: Record<PostStatus, string> = {
  staging:       'Staging',
  in_progress:   'In progress',
  client_review: 'Client review',
  approved:      'Approved',
  posted:        'Posted'
};

/* Status palette — Monday.com friendly pastel pills.
   Use these with the .pill class for the new rounded-full pill style. */
export const STATUS_COLOR: Record<PostStatus, string> = {
  staging:       'pill pill-staging',
  in_progress:   'pill pill-in_progress',
  client_review: 'pill pill-client_review',
  approved:      'pill pill-approved',
  posted:        'pill pill-posted'
};

/* Compact dot color (for inline status indicators) */
export const STATUS_DOT_COLOR: Record<PostStatus, string> = {
  staging:       '#8B4FA8',
  in_progress:   '#4A6FA5',
  client_review: '#E5616B',
  approved:      '#FFB000',
  posted:        '#3E8E5A'
};

/* SONY product line categories. Codes map to full names for display.
   PA  = Personal Audio      (includes headphones)
   TV  = Television
   MO  = Mobile (Xperia)
   DI  = Digital Imaging (cameras + lenses)
   EC  = E-Commerce          (was just "EC" — Sam corrected)
   INZONE = INZONE gaming line
   OTHER = catch-all */
export const CATEGORIES = ['PA', 'TV', 'MO', 'DI', 'EC', 'INZONE', 'OTHER'] as const;
export type Category = typeof CATEGORIES[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  PA:     'Personal Audio',
  TV:     'Television',
  MO:     'Mobile',
  DI:     'Digital Imaging',
  EC:     'E-Commerce',
  INZONE: 'INZONE',
  OTHER:  'Other'
};
export const CATEGORY_GLYPH: Record<Category, string> = {
  PA:     'PA',
  TV:     'TV',
  MO:     'MO',
  DI:     'DI',
  EC:     'EC',
  INZONE: 'IZ',
  OTHER:  '··'
};

/* Tailwind class for the dot inside the pill — uses inline CSS var for dark mode. */
export const STATUS_DOT: Record<PostStatus, string> = {
  staging:       'bg-plum',
  in_progress:   'bg-steel',
  client_review: 'bg-magenta',
  approved:      'bg-accent',
  posted:        'bg-forest'
};

/* Background-only pill classes (for chips that should be filled but
   not show the dot or heavy weight). e.g. status badges on cards. */
export const STATUS_BG: Record<PostStatus, string> = {
  staging:       'bg-[#EEE4F1] text-[#6B2D85] dark:bg-[#3A2A45] dark:text-[#D9B8E8]',
  in_progress:   'bg-[#DEE9F7] text-[#1F4A85] dark:bg-[#1E2E45] dark:text-[#A8C5EA]',
  client_review: 'bg-[#FCE0EA] text-[#8E1F4A] dark:bg-[#3D212E] dark:text-[#F0B5C9]',
  approved:      'bg-accent-soft text-accent-ink dark:bg-[#3A2F18] dark:text-[#FFD980]',
  posted:        'bg-[#D9F0E0] text-[#1F5C36] dark:bg-[#1F3A28] dark:text-[#A6D9B6]'
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
  category?: string[] | null;  /* multi-value: ['PA','TV'] etc. */
  publish_date: string | null; // YYYY-MM-DD or null when in staging
  // Optional manual month override for quota / month-summary counting.
  // Stored as the first day of the chosen month (YYYY-MM-01).
  quota_month?: string | null;
  // The "Target Launch Date" column from the email's planning table, if any.
  // Mirrors publish_date but keeps the original column value separate for audit.
  // When the planning table has BOTH Target Launch Date AND Request Date
  // (Jennifer Chan's MSS Workshop pattern), we store both so the human
  // reviewer can see the copy-delivery deadline vs the post go-live date.
  target_launch_date?: string | null;
  // The "Request Date" / "Copy Delivery Deadline" column, if any.
  request_date?: string | null;
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

export function normalizePlatforms(
  value: unknown,
  fallback: Platform[] = []
): Platform[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
    ? [value]
    : [];

  const out = new Set<Platform>();

  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const text = entry.trim();
    if (!text) continue;
    const lower = text.toLowerCase();

    if (
      lower === 'ig' ||
      lower === 'instagram' ||
      lower === 'insta'
    ) {
      out.add('IG');
      continue;
    }

    if (
      lower === 'fb' ||
      lower === 'facebook'
    ) {
      out.add('FB');
      continue;
    }

    const hasIg = /\big\b|instagram|insta/.test(lower);
    const hasFb = /\bfb\b|facebook/.test(lower);
    if (hasIg) out.add('IG');
    if (hasFb) out.add('FB');
    if (hasIg || hasFb) continue;

    out.add('Other');
  }

  return out.size > 0 ? Array.from(out) : [...fallback];
}

/* Helpers for category arrays — used by the multi-select UI and filter. */
export function postCategories(post: Pick<Post, 'category'>): string[] {
  if (!post.category) return [];
  const raw = Array.isArray(post.category) ? post.category.filter(Boolean) : [post.category].filter(Boolean);
  // Legacy HE rows were historically used for headphones. Headphones now
  // belong under PA, while TV is a brand-new category code.
  return raw.map(value => value === 'HE' ? 'PA' : value);
}
