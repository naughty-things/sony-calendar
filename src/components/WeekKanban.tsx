'use client';

import { useState } from 'react';
import { isSameDay, format, isToday } from 'date-fns';
import { PostWithPeople, STATUS_COLOR, normalizePlatforms } from '@/lib/types';
import { Holiday } from '@/lib/holidays';
import { PlatformChip } from './ui/PlatformChip';
import { useIsMobile } from '@/lib/useIsMobile';

export function WeekKanban({
  days, posts, onOpenPost, onMovePost, arrivedIds, holidays = {}
}: {
  days: Date[];
  posts: PostWithPeople[];
  onOpenPost: (p: PostWithPeople) => void;
  onMovePost?: (postId: string, newDate: string) => Promise<void> | void;
  arrivedIds?: Set<string>;
  holidays?: Record<string, Holiday>;
}) {
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? 'space-y-2' : 'grid grid-cols-7 gap-2'}>
      {days.map(d => (
        <WeekColumn
          key={d.toISOString()}
          d={d}
          posts={posts}
          onOpenPost={onOpenPost}
          onMovePost={onMovePost}
          arrivedIds={arrivedIds}
          holiday={holidays[format(d, 'yyyy-MM-dd')] ?? null}
          isMobile={isMobile}
        />
      ))}
    </div>
  );
}

function WeekColumn({
  d, posts, onOpenPost, onMovePost, arrivedIds, holiday, isMobile
}: {
  d: Date;
  posts: PostWithPeople[];
  onOpenPost: (p: PostWithPeople) => void;
  onMovePost?: (postId: string, newDate: string) => Promise<void> | void;
  arrivedIds?: Set<string>;
  holiday: Holiday | null;
  isMobile?: boolean;
}) {
  const items = posts.filter(p => p.publish_date && isSameDay(new Date(p.publish_date), d));
  const isCurrent = isToday(d);
  const isSunday = d.getDay() === 0;
  const dayClassRed = holiday || isSunday;
  const [dragOver, setDragOver] = useState(false);
  const dropDate = format(d, 'yyyy-MM-dd');
  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-post-id') && onMovePost) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const postId = e.dataTransfer.getData('application/x-post-id');
        if (postId && onMovePost) onMovePost(postId, dropDate);
      }}
      className={`${isMobile ? 'rounded-lg border bg-surface border-edge' : 'flex flex-col min-h-[520px] rounded-lg border border-edge bg-surface'} ${dragOver ? 'ring-2 ring-accent bg-accent/10' : ''} ${
        isCurrent && isMobile ? 'border-accent border-2 -m-px' : ''
      } ${!isMobile && holiday ? 'bg-holiday-tint/40' : ''}`}>
      {/* Day header */}
      <div className={`${isMobile ? 'px-3 py-2.5' : 'px-3 pt-3 pb-2.5 border-b border-edge'} ${
        isCurrent && !isMobile ? 'bg-surface-muted' : ''
      } ${isMobile ? 'border-b border-edge' : ''}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-[10px] uppercase tracking-[0.18em] font-mono font-semibold ${isCurrent ? 'text-accent-deep' : dayClassRed ? 'text-holiday' : 'text-text-faint'}`}>
            {format(d, 'EEE')}
            {isCurrent && <span className="ml-1.5 text-accent-deep">· today</span>}
          </span>
          {items.length > 0 && (
            <span className="text-[10px] font-mono text-text-mute px-1.5 py-0.5 bg-surface-muted rounded">{items.length}</span>
          )}
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className={`numeral ${isMobile ? 'text-[30px]' : 'text-[40px]'} leading-[0.9] ${dayClassRed ? 'text-holiday' : ''}`}>
            {format(d, 'd')}
          </span>
          <span className="text-[10px] font-mono text-text-faint uppercase tracking-wide">
            {format(d, 'MMM')}
          </span>
        </div>
        {holiday && (
          <div className="text-[10px] font-mono text-holiday font-semibold mt-1 truncate" title={holiday.name}>
            {holiday.name}
          </div>
        )}
      </div>

      {/* Cards */}
      <div className={`${isMobile ? 'px-2.5 py-2' : 'flex-1 px-2 py-2'} space-y-2`}>
        {items.length === 0 && (
          <button
            onClick={() => onOpenPost({ publish_date: format(d, 'yyyy-MM-dd') } as any)}
            className="w-full h-14 sm:h-20 border border-dashed border-edge rounded-md text-[10px] uppercase tracking-[0.14em] text-text-faint font-mono hover:border-edge-strong hover:text-text-mute hover:bg-surface-muted transition flex items-center justify-center">
            + tap to add
          </button>
        )}
        {items.map(p => (
          <Card key={p.id} p={p} onClick={() => onOpenPost(p)} highlight={arrivedIds?.has(p.id)} />
        ))}
      </div>
    </div>
  );
}

function Card({ p, onClick, highlight }: { p: PostWithPeople; onClick: () => void; highlight?: boolean }) {
  // Status-tinted background so a glance at the week reveals what's where.
  const statusBg: Record<string, string> = {
    staging:       'bg-[#F6EFF8] dark:bg-[#2A1E32]',
    in_progress:   'bg-[#ECF2FB] dark:bg-[#1B2638]',
    client_review: 'bg-[#FBEDF1] dark:bg-[#321E26]',
    approved:      'bg-accent-soft dark:bg-[#2E2510]',
    posted:        'bg-[#ECF6EF] dark:bg-[#1B2A20]'
  };
  const statusBar: Record<string, string> = {
    staging:       'before:bg-plum',
    in_progress:   'before:bg-steel',
    client_review: 'before:bg-magenta',
    approved:      'before:bg-accent',
    posted:        'before:bg-forest'
  };
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-post-id', p.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onClick}
      className={`group/card relative w-full text-left ${statusBg[p.status]} border border-edge/60 rounded-md pl-3 pr-2.5 py-2.5 hover:shadow-card transition cursor-grab active:cursor-grabbing before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full ${statusBar[p.status]} ${highlight ? 'just-arrived' : ''}`}>
      <div className="flex items-center justify-between mb-1.5 gap-1">
        <span className="flex items-center gap-0.5 flex-wrap">
          {(() => {
            const arr = normalizePlatforms(p.platform, p.source === 'email' ? ['IG'] : ['Other']);
            return arr.map(pl => (
              <PlatformChip key={pl} platform={pl} size={18} />
            ));
          })()}
        </span>
        <span className={STATUS_COLOR[p.status]}>
          {p.status.replace('_', ' ')}
        </span>
      </div>
      <div className="text-[13px] font-medium leading-[1.3] line-clamp-3 text-ink">
        {p.title}
      </div>
      {([p.designer, p.copy_writer, p.internal_pic, p.client_pic].filter(Boolean).length > 0) && (
        <div className="mt-2 pt-2 border-t border-edge/40 text-[10px] text-text-mute font-mono leading-tight">
          {[p.designer, p.copy_writer, p.internal_pic, p.client_pic].filter(Boolean).join(' · ')}
        </div>
      )}
    </button>
  );
}
