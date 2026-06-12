'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { getBrowserClient } from '@/lib/supabase/client';
import { PostWithPeople, PostStatus, Person, STATUS_COLOR, STATUS_LABEL } from '@/lib/types';
import { ChevronLeft, ChevronRight, LayoutGrid, Columns, Plus } from 'lucide-react';
import { PostModal } from './PostModal';
import { WeekKanban } from './WeekKanban';

type View = 'month' | 'week';

export function Calendar() {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [posts, setPosts] = useState<PostWithPeople[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [editing, setEditing] = useState<PostWithPeople | null>(null);
  const [creating, setCreating] = useState<{ date?: string } | null>(null);

  const supabase = getBrowserClient();

  async function load() {
    const { data: p } = await supabase
      .from('posts')
      .select('*, internal_assignee:people!posts_internal_assignee_id_fkey(*), internal_pic:people!posts_internal_pic_id_fkey(*), client_pic:people!posts_client_pic_id_fkey(*)')
      .order('publish_date', { ascending: true });
    setPosts((p as any) || []);
    const { data: pp } = await supabase.from('people').select('*').order('name');
    setPeople(pp || []);
  }

  useEffect(() => { load(); }, []);

  // ── Month grid
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  // ── Week kanban
  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);

  function postsOn(date: Date) {
    return posts.filter(p => isSameDay(new Date(p.publish_date), date));
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-black text-amber-400 font-black flex items-center justify-center">S</div>
            <div>
              <div className="text-sm text-neutral-500">SONY</div>
              <div className="font-semibold -mt-0.5">Content Calendar</div>
            </div>
          </div>

          <div className="ml-6 flex items-center gap-1">
            <button onClick={() => setCursor(view === 'month' ? subMonths(cursor, 1) : addDays(cursor, -7))} className="p-2 rounded hover:bg-neutral-100">
              <ChevronLeft size={18} />
            </button>
            <div className="px-3 font-medium w-56 text-center">
              {view === 'month'
                ? format(cursor, 'MMMM yyyy')
                : `${format(weekDays[0], 'MMM d')} – ${format(weekDays[6], 'MMM d, yyyy')}`}
            </div>
            <button onClick={() => setCursor(view === 'month' ? addMonths(cursor, 1) : addDays(cursor, 7))} className="p-2 rounded hover:bg-neutral-100">
              <ChevronRight size={18} />
            </button>
            <button onClick={() => setCursor(new Date())} className="ml-2 px-3 py-1.5 text-sm rounded border border-neutral-300 hover:bg-neutral-50">Today</button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded border border-neutral-300 overflow-hidden">
              <button
                onClick={() => setView('month')}
                className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${view === 'month' ? 'bg-black text-white' : 'bg-white'}`}>
                <LayoutGrid size={14} /> Month
              </button>
              <button
                onClick={() => setView('week')}
                className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${view === 'week' ? 'bg-black text-white' : 'bg-white'}`}>
                <Columns size={14} /> Week kanban
              </button>
            </div>
            <button
              onClick={() => setCreating({})}
              className="px-3 py-1.5 text-sm rounded bg-amber-400 text-black font-medium flex items-center gap-1.5 hover:bg-amber-300">
              <Plus size={14} /> New post
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        {view === 'month' ? (
          <MonthGrid
            days={monthDays}
            cursor={cursor}
            postsOn={postsOn}
            onOpenDay={(d) => setCreating({ date: format(d, 'yyyy-MM-dd') })}
            onOpenPost={(p) => setEditing(p)}
          />
        ) : (
          <WeekKanban days={weekDays} posts={posts} onOpenPost={(p) => setEditing(p)} />
        )}
      </main>

      {(editing || creating) && (
        <PostModal
          post={editing}
          initialDate={creating?.date}
          people={people}
          onClose={() => { setEditing(null); setCreating(null); }}
          onSaved={async () => { setEditing(null); setCreating(null); await load(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Month grid
// ─────────────────────────────────────────
function MonthGrid({
  days, cursor, postsOn, onOpenDay, onOpenPost
}: {
  days: Date[];
  cursor: Date;
  postsOn: (d: Date) => PostWithPeople[];
  onOpenDay: (d: Date) => void;
  onOpenPost: (p: PostWithPeople) => void;
}) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-neutral-50 border-b border-neutral-200 text-xs font-medium text-neutral-500 uppercase tracking-wide">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
          <div key={d} className="px-3 py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = isSameMonth(d, cursor);
          const items = postsOn(d);
          const isToday = isSameDay(d, new Date());
          return (
            <div
              key={i}
              onClick={() => onOpenDay(d)}
              className={`min-h-[120px] border-r border-b border-neutral-100 p-2 cursor-pointer hover:bg-neutral-50 ${inMonth ? '' : 'bg-neutral-50/60 text-neutral-400'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-medium ${isToday ? 'bg-black text-amber-400 px-1.5 py-0.5 rounded' : ''}`}>
                  {format(d, 'd')}
                </span>
                {items.length > 0 && <span className="text-[10px] text-neutral-500">{items.length}</span>}
              </div>
              <div className="mt-1 space-y-1">
                {items.slice(0, 3).map(p => (
                  <button
                    key={p.id}
                    onClick={(e) => { e.stopPropagation(); onOpenPost(p); }}
                    className={`w-full text-left text-[11px] px-1.5 py-1 rounded truncate ${STATUS_COLOR[p.status]}`}>
                    {p.platform && <span className="font-semibold mr-1">{p.platform}</span>}
                    {p.title}
                  </button>
                ))}
                {items.length > 3 && (
                  <div className="text-[10px] text-neutral-500">+{items.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
