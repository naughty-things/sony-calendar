'use client';

import { PostStatus, STATUS_LABEL, STATUS_COLOR, STATUS_DOT } from '@/lib/types';
import { PostModal } from '../PostModal';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

/* A "paper tape" status chip — distinctive, tactile-feeling.
   Variant 'solid' for headers, 'dot' for inline use. */
export function Tape({
  status, size = 'sm', withDot = true
}: {
  status: PostStatus;
  size?: 'xs' | 'sm' | 'md';
  withDot?: boolean;
}) {
  const sz = size === 'xs' ? 'text-[9px] px-1.5 py-[1px]'
            : size === 'md' ? 'text-[11px] px-2.5 py-1'
            :                  'text-[10px] px-2 py-[2px]';
  return (
    <span className={`tape ${STATUS_COLOR[status]} ${sz} font-semibold tracking-wide`}>
      {withDot && <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />}
      {STATUS_LABEL[status]}
    </span>
  );
}
