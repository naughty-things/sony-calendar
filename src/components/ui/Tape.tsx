'use client';

import { PostStatus, STATUS_LABEL, STATUS_COLOR } from '@/lib/types';

/* Monday-style rounded status pill. Adapts to dark via the .pill-* classes in globals.css. */
export function Tape({
  status, size = 'sm', withDot = true
}: {
  status: PostStatus;
  size?: 'xs' | 'sm' | 'md';
  withDot?: boolean;
}) {
  const sz = size === 'xs' ? 'pill-xs'
            : size === 'md' ? 'pill-md'
            :                  'pill-sm';
  // STATUS_COLOR already returns "pill pill-staging" etc. so we just add the size modifier.
  const base = STATUS_COLOR[status]; // "pill pill-staging"
  const cls = base.replace('pill ', `pill ${sz} `);
  return (
    <span className={cls}>
      {withDot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {STATUS_LABEL[status]}
    </span>
  );
}