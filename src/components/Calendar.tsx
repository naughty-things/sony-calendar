'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isSameWeek, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { Holiday, getHolidaysInRange, getHoliday } from '@/lib/holidays';
import { getBrowserClient } from '@/lib/supabase/client';
import { PostWithPeople, PostStatus, Person, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, STATUS_DOT, PLATFORM_GLYPH, CATEGORY_GLYPH, CATEGORIES } from '@/lib/types';
import { ChevronLeft, ChevronRight, Plus, Search, Sparkles, Filter, Mail, Loader2, Command } from 'lucide-react';
import { PostModal } from './PostModal';
import { WeekKanban } from './WeekKanban';
import { Avatar } from './ui/Avatar';
import { Tape } from './ui/Tape';
import { Toast, ToastItem } from './ui/Toast';

type View = 'month' | 'week';
type StatusFilter = PostStatus | 'all';

export function Calendar() {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [posts, setPosts] = useState<PostWithPeople[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [editing, setEditing] = useState<PostWithPeople | null>(null);
  const [creating, setCreating] = useState<{ date?: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [showReviewInbox, setShowReviewInbox] = useState(false);
  const [lastIngestAt, setLastIngestAt] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [arrivedIds, setArrivedIds] = useState<Set<string>>(new Set());
  const initialLoaded = useRef(false);
  const seenPostIds = useRef<Set<string>>(new Set());

  const supabase = getBrowserClient();

  /* ─── data load ─── */
  const load = useCallback(async (silent = false) => {
    const { data: p } = await supabase
      .from('posts')
      .select('*, internal_assignee:people!posts_internal_assignee_id_fkey(*), internal_pic:people!posts_internal_pic_id_fkey(*), client_pic:people!posts_client_pic_id_fkey(*)')
      .order('publish_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    const next = (p as any) || [];
    setPosts(next);
    const { data: pp } = await supabase.from('people').select('*').order('name');
    setPeople(pp || []);

    // First load: just record what exists
    if (!initialLoaded.current) {
      next.forEach((x: PostWithPeople) => seenPostIds.current.add(x.id));
      initialLoaded.current = true;
      return;
    }

    // Subsequent loads: detect new posts and notify
    if (!silent) {
      const newOnes = next.filter((x: PostWithPeople) => !seenPostIds.current.has(x.id));
      if (newOnes.length > 0) {
        newOnes.forEach((x: PostWithPeople) => {
          seenPostIds.current.add(x.id);
          setArrivedIds(prev => new Set(prev).add(x.id));
          if (x.source === 'email' && x.status === 'needs_review') {
            setToasts(t => [...t, {
              id: 'arr-' + x.id,
              title: 'New from email',
              detail: x.title,
              kind: 'info',
              ttlMs: 6000
            }]);
          }
        });
        // Remove the "just arrived" highlight after 4s
        setTimeout(() => {
          setArrivedIds(prev => {
            const c = new Set(prev);
            newOnes.forEach((x: PostWithPeople) => c.delete(x.id));
            return c;
          });
        }, 4000);
      }
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  /* ─── last ingest timestamp from app_state ─── */
  useEffect(() => {
    let cancelled = false;
    async function checkIngest() {
      const { data } = await supabase
        .from('app_state')
        .select('updated_at')
        .eq('key', 'gmail_last_history_id')
        .single();
      if (!cancelled && data) setLastIngestAt(data.updated_at);
    }
    checkIngest();
    const t = setInterval(checkIngest, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [supabase]);

  /* ─── realtime: refresh on new posts ─── */
  useEffect(() => {
    const channel = supabase
      .channel('posts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => {
        load(false);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, load]);

  /* ─── keyboard shortcuts ─── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      }
      if (e.key === 'n') { e.preventDefault(); setCreating({}); }
      else if (e.key === 't') { e.preventDefault(); setCursor(new Date()); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); setCursor(view === 'month' ? subMonths(cursor, 1) : addDays(cursor, -7)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setCursor(view === 'month' ? addMonths(cursor, 1) : addDays(cursor, 7)); }
      else if (e.key === 'Escape') { setEditing(null); setCreating(null); setShowReviewInbox(false); }
      else if (e.key === 'm') setView('month');
      else if (e.key === 'w') setView('week');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, view]);

  /* ─── derived ─── */
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor]);

  // Holidays in the visible range (month or week)
  const holidayMap = useMemo(() => {
    const start = monthDays[0] ?? weekDays[0];
    const end = monthDays[monthDays.length - 1] ?? weekDays[weekDays.length - 1];
    if (!start || !end) return {} as Record<string, import('@/lib/holidays').Holiday>;
    return getHolidaysInRange(start, end);
  }, [monthDays, weekDays]);

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (q && !p.title?.toLowerCase().includes(q) && !p.notes?.toLowerCase().includes(q) && !(Array.isArray(p.platform) ? p.platform.join(' ').toLowerCase() : (p.platform || '').toLowerCase()).includes(q)) return false;
      return true;
    });
  }, [posts, statusFilter, search]);

  /* Posts that are scheduled to a date — i.e. everything except staging */
  const datedPosts = useMemo(
    () => filteredPosts.filter(p => p.status !== 'staging' && p.publish_date),
    [filteredPosts]
  );

  const reviewQueue = useMemo(
    () => posts.filter(p => p.status === 'needs_review' || p.status === 'client_review')
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [posts]
  );

  const stagingQueue = useMemo(
    () => posts.filter(p => p.status === 'staging')
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [posts]
  );

  const postsOn = useCallback((date: Date) => {
    return datedPosts.filter(p => p.publish_date && isSameDay(new Date(p.publish_date), date));
  }, [datedPosts]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: posts.length };
    STATUS_ORDER.forEach(s => { c[s] = posts.filter(p => p.status === s).length; });
    return c;
  }, [posts]);

  const liveRel = useMemo(() => {
    if (!lastIngestAt) return null;
    const m = (Date.now() - new Date(lastIngestAt).getTime()) / 1000;
    if (m < 60) return 'just now';
    if (m < 3600) return Math.floor(m / 60) + 'm ago';
    if (m < 86400) return Math.floor(m / 3600) + 'h ago';
    return Math.floor(m / 86400) + 'd ago';
  }, [lastIngestAt]);

  return (
    <div className="min-h-screen flex flex-col relative z-10">
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-30 bg-paper/85 backdrop-blur-md">
        <div className="max-w-[1480px] mx-auto px-7 pt-5 pb-3">
          {/* Top bar — wordmark + status live + actions */}
          <div className="flex items-end justify-between gap-6">
            <div className="flex items-baseline gap-3 min-w-0">
              <div className="font-display text-[28px] font-medium tracking-editorial leading-none">
                SONY<span className="text-accent">/</span>
              </div>
              <div className="font-display italic text-[20px] text-ink-soft leading-none -mb-0.5">
                Content&nbsp;Calendar
              </div>
              <div className="hidden md:flex items-center gap-1.5 ml-3 mb-1 text-[10px] uppercase tracking-[0.14em] text-ink-mute font-mono">
                <span className="live-dot" /> Live ingest
                {liveRel && <span className="ml-1.5 text-ink-faint">· {liveRel}</span>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search posts…"
                  className="pl-8 pr-3 py-1.5 w-56 text-sm bg-transparent border-b border-rule-soft focus:border-ink focus:outline-none placeholder:text-ink-faint transition" />
              </div>

              <button
                onClick={() => setShowReviewInbox(true)}
                className={`relative flex items-center gap-1.5 text-sm px-2.5 py-1.5 border border-rule-soft rounded-sm hover:border-ink transition ${(reviewQueue.length + stagingQueue.length) > 0 ? 'text-ink' : 'text-ink-mute'}`}>
                <Mail size={13} />
                Inbox
                {reviewQueue.length > 0 && (
                  <span className="ml-1 text-[10px] font-mono font-semibold bg-accent text-ink rounded-full px-1.5 py-0 leading-[1.4]">
                    {reviewQueue.length}
                  </span>
                )}
                {stagingQueue.length > 0 && (
                  <span className="ml-0.5 text-[10px] font-mono font-semibold bg-plum text-paper rounded-full px-1.5 py-0 leading-[1.4]">
                    {stagingQueue.length}
                  </span>
                )}
              </button>

              <div className="flex items-stretch border border-rule-soft rounded-sm overflow-hidden">
                <button
                  onClick={() => setView('month')}
                  className={`px-2.5 py-1.5 text-xs uppercase tracking-[0.1em] font-semibold transition ${view === 'month' ? 'bg-ink text-paper' : 'text-ink hover:bg-paper-deep'}`}>
                  Month
                </button>
                <button
                  onClick={() => setView('week')}
                  className={`px-2.5 py-1.5 text-xs uppercase tracking-[0.1em] font-semibold transition ${view === 'week' ? 'bg-ink text-paper' : 'text-ink hover:bg-paper-deep'}`}>
                  Week
                </button>
              </div>

              <button
                onClick={() => setCreating({})}
                className="group flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 bg-ink text-paper rounded-sm hover:bg-accent hover:text-ink transition">
                <Plus size={14} strokeWidth={2.5} />
                New post
                <kbd className="ml-1 font-mono text-[10px] text-paper/50 group-hover:text-ink/50">N</kbd>
              </button>
            </div>
          </div>

          {/* Date nav row */}
          <div className="mt-4 flex items-end justify-between gap-4">
            <div className="flex items-end gap-3">
              <button onClick={() => setCursor(view === 'month' ? subMonths(cursor, 1) : addDays(cursor, -7))}
                className="p-1.5 -ml-1 rounded-sm hover:bg-paper-deep text-ink-soft">
                <ChevronLeft size={18} />
              </button>
              <h1 className="font-display text-[56px] sm:text-[68px] leading-[0.9] tracking-editorial font-light text-ink">
                <span className="italic">{format(cursor, view === 'month' ? 'LLLL' : 'MMM')}</span>
                <span className="ml-3 font-mono not-italic text-ink-mute text-[36px] sm:text-[44px] align-[0.05em]">
                  {format(cursor, view === 'month' ? 'yyyy' : 'yyyy')}
                </span>
              </h1>
              <button onClick={() => setCursor(view === 'month' ? addMonths(cursor, 1) : addDays(cursor, 7))}
                className="p-1.5 rounded-sm hover:bg-paper-deep text-ink-soft">
                <ChevronRight size={18} />
              </button>
              <button onClick={() => setCursor(new Date())}
                className="ml-1 mb-1 text-[10px] uppercase tracking-[0.16em] font-semibold text-ink-mute hover:text-ink font-mono">
                today
              </button>
            </div>

            {/* Status filter strip */}
            <div className="flex items-center gap-1.5 flex-wrap justify-end pb-1.5 max-w-[60%]">
              <FilterChip
                label={`All · ${counts.all}`}
                active={statusFilter === 'all'}
                onClick={() => setStatusFilter('all')} />
              {STATUS_ORDER.map(s => {
                const n = counts[s] || 0;
                if (n === 0 && statusFilter !== s) return null;
                return (
                  <FilterChip
                    key={s}
                    label={`${STATUS_LABEL[s]} · ${n}`}
                    color={STATUS_DOT[s]}
                    active={statusFilter === s}
                    onClick={() => setStatusFilter(s)} />
                );
              })}
            </div>
          </div>
        </div>
        <div className="rule-t rule-soft" />
      </header>

      {/* ─── Body ─── */}
      <main className="flex-1 max-w-[1480px] w-full mx-auto px-7 py-6">
        {view === 'month' ? (
          <MonthGrid
            days={monthDays}
            cursor={cursor}
            postsOn={postsOn}
            onOpenDay={(d) => setCreating({ date: format(d, 'yyyy-MM-dd') })}
            onOpenPost={(p) => setEditing(p)}
            arrivedIds={arrivedIds}
            holidays={holidayMap}
          />
        ) : (
          <WeekKanban days={weekDays} posts={datedPosts} onOpenPost={(p) => setEditing(p)} arrivedIds={arrivedIds} holidays={holidayMap} />
        )}

        {/* Subtle legend */}
        <div className="mt-8 flex items-center gap-5 flex-wrap text-[10px] uppercase tracking-[0.14em] text-ink-faint font-mono">
          <span>Press</span>
          <Kbd>N</Kbd><span>new</span>
          <Kbd>←</Kbd><Kbd>→</Kbd><span>navigate</span>
          <Kbd>T</Kbd><span>today</span>
          <Kbd>M</Kbd><Kbd>W</Kbd><span>view</span>
          <Kbd>Esc</Kbd><span>close</span>
        </div>
      </main>

      {/* ─── Review inbox (slide-over) ─── */}
      {showReviewInbox && (
        <ReviewInbox
          reviewItems={reviewQueue}
          stagingItems={stagingQueue}
          people={people}
          onClose={() => setShowReviewInbox(false)}
          onOpen={(p) => { setEditing(p); setShowReviewInbox(false); }} />
      )}

      {/* ─── Modal ─── */}
      {(editing || creating) && (
        <PostModal
          post={editing}
          initialDate={creating?.date}
          people={people}
          onClose={() => { setEditing(null); setCreating(null); }}
          onSaved={async () => { setEditing(null); setCreating(null); await load(false); }}
        />
      )}

      {/* ─── Toasts ─── */}
      <Toast items={toasts} onDismiss={(id) => setToasts(t => t.filter(x => x.id !== id))} />
    </div>
  );
}

/* ─────────────────────────────────────────
   Small UI atoms
   ───────────────────────────────────────── */
function FilterChip({ label, color, active, onClick }: { label: string; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-sm border transition ${
        active ? 'bg-ink text-paper border-ink' : 'border-rule-soft text-ink-soft hover:border-ink-mute hover:text-ink'
      }`}>
      {color && <span className={`w-1.5 h-1.5 rounded-full ${color}`} />}
      {label}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-paper-deep text-ink-soft rounded border border-rule-soft">
      {children}
    </kbd>
  );
}

/* ─────────────────────────────────────────
   Month grid
   ───────────────────────────────────────── */
function MonthGrid({
  days, cursor, postsOn, onOpenDay, onOpenPost, arrivedIds, holidays
}: {
  days: Date[];
  cursor: Date;
  postsOn: (d: Date) => PostWithPeople[];
  onOpenDay: (d: Date) => void;
  onOpenPost: (p: PostWithPeople) => void;
  arrivedIds: Set<string>;
  holidays: Record<string, Holiday>;
}) {
  const today = new Date();
  return (
    <div className="bg-paper-warm border border-rule rounded-sm overflow-hidden">
      {/* Day-of-week header — Sun first */}
      <div className="grid grid-cols-7 bg-paper-deep rule-b border-rule-soft">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
          <div key={d} className={`px-3 py-2.5 text-[10px] uppercase tracking-[0.18em] font-semibold font-mono ${i === 0 ? 'text-holiday' : i === 6 ? 'text-ink-faint' : 'text-ink-mute'}`}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = isSameMonth(d, cursor);
          const items = postsOn(d);
          const isToday = isSameDay(d, today);
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const holiday = holidays[format(d, 'yyyy-MM-dd')] ?? null;
          return (
            <DayCell
              key={i}
              d={d}
              inMonth={inMonth}
              weekend={weekend}
              isToday={isToday}
              items={items}
              holiday={holiday}
              onOpenDay={onOpenDay}
              onOpenPost={onOpenPost}
              arrivedIds={arrivedIds} />
          );
        })}
      </div>
    </div>
  );
}

function DayCell({
  d, inMonth, weekend, isToday, items, holiday, onOpenDay, onOpenPost, arrivedIds
}: {
  d: Date;
  inMonth: boolean;
  weekend: boolean;
  isToday: boolean;
  items: PostWithPeople[];
  holiday: Holiday | null;
  onOpenDay: (d: Date) => void;
  onOpenPost: (p: PostWithPeople) => void;
  arrivedIds: Set<string>;
}) {
  // Sundays (getDay() === 0) are red like holidays. Saturdays stay neutral.
  const isSunday = d.getDay() === 0;
  // Holiday number + name override the normal color; Sundays also get red text
  const dayColor = holiday || isSunday
    ? 'text-holiday'
    : isToday
    ? 'text-accent-deep'
    : inMonth
    ? 'text-ink'
    : 'text-ink-faint';
  return (
    <div
      onClick={() => onOpenDay(d)}
      className={`group relative min-h-[148px] border-r border-b border-rule-soft last:border-r-0 p-2.5 cursor-pointer transition
        ${inMonth ? '' : 'bg-paper-deep/50 text-ink-faint'}
        ${isSunday && inMonth && !holiday ? 'bg-holiday-tint/40' : ''}
        ${holiday ? 'bg-holiday-tint' : ''}
        hover:bg-paper-deep`}>
      {/* Day number — large editorial numeral */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col items-start">
          <span className={`numeral text-[36px] ${dayColor} leading-[0.85] group-hover:text-ink transition`}>
            {format(d, 'd')}
          </span>
          <span className={`mt-1 text-[9px] uppercase tracking-[0.16em] font-mono ${isToday ? 'text-accent-deep font-semibold' : 'text-ink-faint'}`}>
            {format(d, 'MMM')}
          </span>
          {holiday && inMonth && (
            <span title={holiday.name} className="mt-1 text-[9px] font-mono text-holiday font-semibold truncate max-w-full">
              {holiday.name}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <span className="text-[10px] font-mono text-ink-mute mt-0.5">{items.length}</span>
        )}
      </div>

      {/* Post chips */}
      <div className="mt-2 space-y-1">
        {items.slice(0, 3).map(p => (
          <PostChip key={p.id} p={p} onOpen={onOpenPost} highlight={arrivedIds.has(p.id)} />
        ))}
        {items.length > 3 && (
          <div className="text-[10px] text-ink-faint font-mono pl-1.5">+{items.length - 3} more</div>
        )}
      </div>
    </div>
  );
}

function PostChip({ p, onOpen, highlight }: { p: PostWithPeople; onOpen: (p: PostWithPeople) => void; highlight?: boolean }) {
  const cat = p.category && (CATEGORIES as readonly string[]).includes(p.category)
    ? p.category
    : null;
  // Normalize platform to an array — handle legacy string and new array shapes
  const platforms: string[] = Array.isArray(p.platform)
    ? p.platform
    : p.platform
    ? [p.platform]
    : [];
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(p); }}
      className={`group/chip w-full text-left relative flex items-start gap-1.5 px-1.5 py-1 rounded-sm ${STATUS_COLOR[p.status]} ${highlight ? 'just-arrived' : ''} hover:translate-x-0.5 transition-transform`}>
      {/* platform glyph chips (one per platform) */}
      {platforms.length > 0 ? (
        platforms.map(pl => (
          <span key={pl} className="font-mono text-[8px] font-bold leading-tight bg-ink/85 text-paper px-1 py-0.5 rounded-sm shrink-0 mt-[1px]">
            {PLATFORM_GLYPH[pl] || pl}
          </span>
        ))
      ) : (
        <span className="font-mono text-[8px] font-bold leading-tight bg-ink/30 text-paper px-1 py-0.5 rounded-sm shrink-0 mt-[1px]">··</span>
      )}
      {cat && (
        <span className="font-mono text-[8px] font-bold leading-tight bg-paper/70 text-ink px-1 py-0.5 rounded-sm shrink-0 mt-[1px]">
          {CATEGORY_GLYPH[cat as keyof typeof CATEGORY_GLYPH]}
        </span>
      )}
      <span className="text-[11px] leading-[1.25] font-medium line-clamp-2 flex-1 min-w-0">
        {p.title}
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────
   Review inbox (slide-over) with Review + Staging tabs
   ───────────────────────────────────────── */
function ReviewInbox({
  reviewItems, stagingItems, people, onClose, onOpen
}: {
  reviewItems: PostWithPeople[];
  stagingItems: PostWithPeople[];
  people: Person[];
  onClose: () => void;
  onOpen: (p: PostWithPeople) => void;
}) {
  const [tab, setTab] = useState<'review' | 'staging'>(reviewItems.length > 0 ? 'review' : 'staging');
  const items = tab === 'review' ? reviewItems : stagingItems;
  const total = reviewItems.length + stagingItems.length;

  return (
    <>
      <div className="fixed inset-0 bg-ink/30 z-40 sheet" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-paper border-l border-rule shadow-2xl flex flex-col sheet">
        <div className="px-6 pt-5 pb-0 rule-b border-rule-soft">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-ink-mute font-mono">Inbox</div>
              <h2 className="font-display text-2xl tracking-editorial mt-0.5">
                {tab === 'review' ? 'Awaiting review' : 'Staging'}
              </h2>
            </div>
            <button onClick={onClose} className="text-ink-mute hover:text-ink text-xl leading-none">×</button>
          </div>

          {/* Tabs */}
          <div className="mt-4 -mb-px flex items-center gap-1">
            <TabBtn active={tab === 'review'} onClick={() => setTab('review')}>
              <span>Review</span>
              <span className={`ml-2 font-mono text-[10px] rounded-full px-1.5 py-0 leading-[1.4] ${
                tab === 'review' ? 'bg-paper text-ink' : 'bg-accent text-ink'
              }`}>
                {reviewItems.length}
              </span>
            </TabBtn>
            <TabBtn active={tab === 'staging'} onClick={() => setTab('staging')}>
              <span>Staging</span>
              {stagingItems.length > 0 && (
                <span className={`ml-2 font-mono text-[10px] rounded-full px-1.5 py-0 leading-[1.4] ${
                  tab === 'staging' ? 'bg-paper text-ink' : 'bg-plum text-paper'
                }`}>
                  {stagingItems.length}
                </span>
              )}
            </TabBtn>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 && (
            <div className="px-6 py-16 text-center">
              {tab === 'review' ? (
                <>
                  <div className="font-display italic text-3xl text-ink-faint">Inbox zero</div>
                  <div className="text-sm text-ink-mute mt-2">No posts waiting for your eyes.</div>
                </>
              ) : (
                <>
                  <div className="font-display italic text-3xl text-ink-faint">Staging is clear</div>
                  <div className="text-sm text-ink-mute mt-2">Every forwarded email has all the info it needs.</div>
                </>
              )}
            </div>
          )}
          <ul>
            {items.map(p => {
              const people = p.internal_assignee || p.internal_pic || p.client_pic;
              const isStaging = p.status === 'staging';
              return (
                <li key={p.id} className="rule-b border-rule-soft">
                  <button
                    onClick={() => onOpen(p)}
                    className="w-full text-left px-6 py-4 hover:bg-paper-deep transition flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        {isStaging ? (
                          <span className="font-mono text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-sm bg-plum text-paper">
                            Needs details
                          </span>
                        ) : (
                          <Tape status={p.status} size="xs" />
                        )}
                        {p.platform && (
                          <span className="font-mono text-[9px] uppercase tracking-wide text-ink-mute">
                            {Array.isArray(p.platform) ? p.platform.join(' + ') : p.platform}
                          </span>
                        )}
                        {p.publish_date ? (
                          <span className="font-mono text-[10px] text-ink-faint ml-auto">
                            {format(new Date(p.publish_date), 'MMM d')}
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] text-plum ml-auto uppercase tracking-wide">
                            no date
                          </span>
                        )}
                      </div>
                      <div className={`font-medium text-[15px] leading-snug ${isStaging ? 'text-ink-soft' : ''}`}>
                        {p.title}
                      </div>
                      {p.notes && <div className="text-xs text-ink-mute mt-1 line-clamp-2">{p.notes}</div>}

                      {isStaging && p.source_meta?.missing && (
                        <div className="mt-2 text-[10px] text-plum font-mono uppercase tracking-wide">
                          Missing: {p.source_meta.missing}
                        </div>
                      )}

                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-faint font-mono uppercase tracking-wide">
                        {p.source === 'email' && <><Mail size={10} className="inline mr-1" />From email</>}
                        {p.source_meta?.confidence != null && (
                          <span className="ml-1">· {(p.source_meta.confidence * 100).toFixed(0)}% confident</span>
                        )}
                      </div>

                      {isStaging && (
                        <div className="mt-2.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-plum">
                          → Click to complete the details
                        </div>
                      )}
                    </div>
                    {people && <Avatar person={people} size={28} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {total === 0 && null /* hint removed - per-tab empty state above */}
      </aside>
    </>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-3 py-2 text-sm font-medium border-b-2 transition ${
        active
          ? 'border-ink text-ink'
          : 'border-transparent text-ink-mute hover:text-ink'
      }`}>
      {children}
    </button>
  );
}
