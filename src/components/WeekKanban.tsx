'use client';

import { isSameDay, format } from 'date-fns';
import { PostWithPeople, STATUS_COLOR, STATUS_LABEL } from '@/lib/types';

export function WeekKanban({
  days, posts, onOpenPost
}: {
  days: Date[];
  posts: PostWithPeople[];
  onOpenPost: (p: PostWithPeople) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-3">
      {days.map(d => {
        const items = posts.filter(p => isSameDay(new Date(p.publish_date), d));
        return (
          <div key={d.toISOString()} className="bg-white border border-neutral-200 rounded-lg flex flex-col min-h-[400px]">
            <div className="px-3 py-2 border-b border-neutral-200 sticky top-0 bg-white">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">{format(d, 'EEE')}</div>
              <div className="text-lg font-semibold">{format(d, 'd MMM')}</div>
              <div className="text-xs text-neutral-500 mt-0.5">{items.length} item{items.length === 1 ? '' : 's'}</div>
            </div>
            <div className="p-2 space-y-2 flex-1">
              {items.length === 0 && (
                <div className="text-xs text-neutral-400 italic px-1 py-3">Nothing scheduled</div>
              )}
              {items.map(p => (
                <button
                  key={p.id}
                  onClick={() => onOpenPost(p)}
                  className="w-full text-left rounded border border-neutral-200 p-2 hover:border-amber-400 hover:shadow-sm transition">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLOR[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                    {p.platform && <span className="text-[10px] font-semibold text-neutral-500">{p.platform}</span>}
                  </div>
                  <div className="text-sm font-medium leading-snug line-clamp-2">{p.title}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-neutral-500">
                    {p.internal_assignee && <Pill label={p.internal_assignee.name} side="internal" />}
                    {p.internal_pic && <Pill label={p.internal_pic.name} side="internal" kind="pic" />}
                    {p.client_pic && <Pill label={p.client_pic.name} side="client" kind="pic" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Pill({ label, side, kind }: { label: string; side: 'internal' | 'client'; kind?: 'pic' | 'assignee' }) {
  const cls = side === 'client'
    ? 'bg-purple-50 text-purple-700 border-purple-200'
    : 'bg-blue-50 text-blue-700 border-blue-200';
  return (
    <span className={`px-1.5 py-0.5 rounded border ${cls}`}>
      {kind === 'pic' ? '🎯 ' : side === 'client' ? '👤 ' : '✍️ '}{label}
    </span>
  );
}
