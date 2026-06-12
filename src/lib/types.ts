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

export const STATUS_COLOR: Record<PostStatus, string> = {
  draft: 'bg-neutral-200 text-neutral-700',
  in_progress: 'bg-blue-100 text-blue-800',
  needs_review: 'bg-amber-100 text-amber-900',
  client_review: 'bg-purple-100 text-purple-800',
  approved: 'bg-emerald-100 text-emerald-800',
  scheduled: 'bg-sky-100 text-sky-800',
  posted: 'bg-green-200 text-green-900',
  blocked: 'bg-red-100 text-red-800',
  archived: 'bg-neutral-300 text-neutral-600'
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
