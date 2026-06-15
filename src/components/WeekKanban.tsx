'use client';

import { isSameDay, format, isToday } from 'date-fns';
import { PostWithPeople, STATUS_COLOR, PLATFORM_GLYPH } from '@/lib/types';
import { Holiday } from '@/lib/holidays';
import { Avatar } from './ui/Avatar';

export function WeekKanban({
  days, posts, onOpenPost, arrivedIds, holidays = {}
}: {
  days: Date[];
  posts: PostWithPeople[];
  onOpenPost: (p: PostWithPeople) => void;
  arrivedIds?: Set<string>;
  holidays?: Record<string, Holiday>;
}) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map(d => {
        const items = posts.filter(p => p.publish_date && isSameDay(new Date(p.publish_date), d));
        const isCurrent = isToday(d);
        const isSunday = d.getDay() === 0;
        const holiday = holidays[format(d, 'yyyy-MM-dd')] ?? null;
        const dayClassRed = holiday || isSunday;
        return (
          <div key={d.toISOString()} className="flex flex-col min-h-[520px]">
            {/* Day header — editorial */}
            <div className={`px-3 pt-3 pb-2 rule-b border-rule-soft ${isCurrent ? 'bg-paper-warm' : ''} ${holiday ? 'bg-holiday-tint' : isSunday ? 'bg-holiday-tint/40' : ''}`}>
              <div className="flex items-baseline justify-between">
                <span className={`text-[10px] uppercase tracking-[0.18em] font-mono ${isCurrent ? 'text-accent-deep font-semibold' : dayClassRed ? 'text-holiday font-semibold' : 'text-ink-faint'}`}>
                  {format(d, 'EEE')}
                </span>
                {items.length > 0 && (
                  <span className="text-[10px] font-mono text-ink-mute">{items.length}</span>
                )}
              </div>
              <div className={`numeral text-[48px] leading-[0.85] mt-1.5 ${dayClassRed ? 'text-holiday' : ''}`}>
                {format(d, 'd')}
              </div>
              <div className="text-[10px] font-mono text-ink-faint uppercase tracking-wide mt-0.5">
                {format(d, 'MMM')}
              </div>
              {holiday && (
                <div className="text-[10px] font-mono text-holiday font-semibold mt-1 truncate" title={holiday.name}>
                  {holiday.name}
                </div>
              )}
            </div>

            {/* Cards */}
            <div className="flex-1 px-2 py-2 space-y-2">
              {items.length === 0 && (
                <button
                  onClick={() => onOpenPost({ publish_date: format(d, 'yyyy-MM-dd') } as any)}
                  className="w-full h-16 border border-dashed border-rule-soft rounded-sm text-[10px] uppercase tracking-[0.14em] text-ink-faint font-mono hover:border-ink-mute hover:text-ink-mute transition flex items-center justify-center">
                  + drop
                </button>
              )}
              {items.map(p => (
                <Card key={p.id} p={p} onClick={() => onOpenPost(p)} highlight={arrivedIds?.has(p.id)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Card({ p, onClick, highlight }: { p: PostWithPeople; onClick: () => void; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`group/card w-full text-left bg-paper-warm border border-rule-soft rounded-sm p-2.5 hover:border-ink hover:shadow-sm transition ${highlight ? 'just-arrived' : ''}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[9px] font-bold bg-ink text-paper px-1.5 py-0.5 rounded-sm tracking-wide">
          {(() => {
            const arr = Array.isArray(p.platform) ? p.platform : p.platform ? [p.platform] : ['Other'];
            return arr.map(pl => (
              <span key={pl} className="font-mono text-[8px] font-bold leading-tight bg-ink/85 text-paper px-1 py-0.5 rounded-sm shrink-0">
                {PLATFORM_GLYPH[pl] || pl}
              </span>
            ));
          })()}
        </span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-semibold ${STATUS_COLOR[p.status]}`}>
          {p.status.replace('_', ' ')}
        </span>
      </div>
      <div className="text-[13px] font-medium leading-[1.3] line-clamp-3 text-ink">
        {p.title}
      </div>
      {(p.internal_pic || p.client_pic) && (
        <div className="mt-2 pt-2 border-t border-rule-soft flex items-center gap-1.5">
          {p.internal_pic && <Avatar person={p.internal_pic} size={20} title="Internal PIC" />}
          {p.client_pic && <Avatar person={p.client_pic} size={20} title="Client PIC" />}
        </div>
      )}
    </button>
  );
}
