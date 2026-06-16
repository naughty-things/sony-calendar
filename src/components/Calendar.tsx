'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isSameWeek, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { Holiday, getHolidaysInRange, getHoliday } from '@/lib/holidays';
import { getBrowserClient } from '@/lib/supabase/client';
import { PostWithPeople, PostStatus, Person, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, STATUS_DOT, PLATFORM_GLYPH, CATEGORY_GLYPH, CATEGORIES } from '@/lib/types';
import { PlatformChip } from './ui/PlatformChip';
import { ChevronLeft, ChevronRight, Plus, Search, Sparkles, Filter, Mail, Loader2, Command } from 'lucide-react';
import { PostModal } from './PostModal';
import { WeekKanban } from './WeekKanban';
import { Tape } from './ui/Tape';
import { Toast, ToastItem } from './ui/Toast';
import { useIsMobile } from '@/lib/useIsMobile';
import { useAuth } from '@/lib/auth/AuthProvider';
import { USERS, usernameToEmail } from '@/lib/auth/config';
import { useRouter, usePathname } from 'next/navigation';
import { LogIn, LogOut, User as UserIcon } from 'lucide-react';

/** Look up a friendly display name for the signed-in user. */
function adminDisplayName(email?: string | null): string {
  if (!email) return '';
  const match = USERS.find(u => u.email === email);
  return match ? match.displayName : email;
}

type View = 'month' | 'week';
type StatusFilter = PostStatus | 'all';

export function Calendar() {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [posts, setPosts] = useState<PostWithPeople[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [recentNames, setRecentNames] = useState<{ designer: string[]; copy_writer: string[]; internal_pic: string[]; client_pic: string[] }>({ designer: [], copy_writer: [], internal_pic: [], client_pic: [] });
  const [editing, setEditing] = useState<PostWithPeople | null>(null);
  const [creating, setCreating] = useState<{ date?: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [showReviewInbox, setShowReviewInbox] = useState(false);
  const [lastIngestAt, setLastIngestAt] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [arrivedIds, setArrivedIds] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const initialLoaded = useRef(false);
  const seenPostIds = useRef<Set<string>>(new Set());

  const supabase = getBrowserClient();
  const isMobile = useIsMobile();
  const { user, signOut } = useAuth();
  const isAdmin = !!user;
  const router = useRouter();
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Guards: route write actions through here so non-admins get bounced to /login.
  const requireAdmin = useCallback((): boolean => {
    if (isAdmin) return true;
    const next = encodeURIComponent(pathname || '/');
    router.push(`/login?next=${next}`);
    return false;
  }, [isAdmin, router, pathname]);

  const openCreate = useCallback((init?: { date?: string }) => {
    if (requireAdmin()) setCreating(init ?? {});
  }, [requireAdmin]);

  const openEdit = useCallback((p: PostWithPeople) => {
    if (requireAdmin()) setEditing(p);
  }, [requireAdmin]);

  const openInbox = useCallback(() => {
    if (requireAdmin()) setShowReviewInbox(true);
  }, [requireAdmin]);

  /* ─── data load ─── */
  const load = useCallback(async (silent = false) => {
    const { data: p } = await supabase
      .from('posts')
      .select('*')
      .order('publish_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    const next = (p as any) || [];
    setPosts(next);
    const { data: pp } = await supabase.from('people').select('*').order('name');
    setPeople(pp || []);

    // Build autocomplete suggestions for designer/copy_writer/internal_pic/client_pic
    // from distinct non-null values across all posts, plus the people table for
    // names that may have been mentioned in emails (Sam, Cheri, etc).
    const collect = (col: 'designer' | 'copy_writer' | 'internal_pic' | 'client_pic') => {
      const set = new Set<string>();
      for (const x of next) {
        const v = (x as any)[col];
        if (typeof v === 'string' && v.trim()) set.add(v.trim());
      }
      // Also include people names so email-mentioned folks show up
      for (const person of pp || []) {
        if (person.name && person.name.trim()) set.add(person.name.trim());
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    };
    setRecentNames({
      designer: collect('designer'),
      copy_writer: collect('copy_writer'),
      internal_pic: collect('internal_pic'),
      client_pic: collect('client_pic')
    });

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

  /* ─── drag-to-reschedule: update publish_date in place + toast on result ─── */
  const handleMovePost = useCallback(async (postId: string, newDate: string) => {
    if (!isAdmin) return;
    // Optimistic local update so the chip moves immediately
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, publish_date: newDate } : p));
    const { error } = await supabase
      .from('posts')
      .update({ publish_date: newDate })
      .eq('id', postId);
    if (error) {
      // Revert + show error toast
      await load(true);
      setToasts(t => [...t, {
        id: 'move-err-' + postId + '-' + Date.now(),
        title: 'Could not reschedule',
        detail: error.message,
        kind: 'warning',
        ttlMs: 5000
      }]);
    } else {
      setToasts(t => [...t, {
        id: 'move-' + postId + '-' + Date.now(),
        title: 'Rescheduled',
        detail: newDate,
        kind: 'success',
        ttlMs: 3000
      }]);
    }
  }, [supabase, load, isAdmin]);

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
      if (e.key === 'n') { e.preventDefault(); openCreate(); }
      else if (e.key === 't') { e.preventDefault(); setCursor(new Date()); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); setCursor(view === 'month' ? subMonths(cursor, 1) : addDays(cursor, -7)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setCursor(view === 'month' ? addMonths(cursor, 1) : addDays(cursor, 7)); }
      else if (e.key === 'Escape') { setEditing(null); setCreating(null); setShowReviewInbox(false); }
      else if (e.key === 'm') setView('month');
      else if (e.key === 'w') setView('week');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, view, openCreate]);

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
        <div className="max-w-[1480px] mx-auto px-4 sm:px-7 pt-4 sm:pt-5 pb-3">
          {/* Top bar — wordmark + status live + actions */}
          <div className="flex items-end justify-between gap-3 sm:gap-6">
            <div className="flex items-baseline gap-2 sm:gap-3 min-w-0 shrink">
              <div className="font-display text-[22px] sm:text-[28px] font-medium tracking-editorial leading-none whitespace-nowrap">
                SONY<span className="text-accent">/</span>
              </div>
              <div className="font-display italic text-[15px] sm:text-[20px] text-ink-soft leading-none -mb-0.5 truncate hidden xs:block">
                Content&nbsp;Calendar
              </div>
              <div className="hidden md:flex items-center gap-1.5 ml-3 mb-1 text-[10px] uppercase tracking-[0.14em] text-ink-mute font-mono">
                <span className="live-dot" /> Live ingest
                {liveRel && <span className="ml-1.5 text-ink-faint">· {liveRel}</span>}
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Search — desktop: inline input; mobile: icon that expands */}
              {!isMobile && (
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search posts…"
                    className="pl-8 pr-3 py-1.5 w-56 text-sm bg-transparent border-b border-rule-soft focus:border-ink focus:outline-none placeholder:text-ink-faint transition" />
                </div>
              )}
              {isMobile && (
                <button
                  onClick={() => setSearchOpen(v => !v)}
                  aria-label="Search"
                  className={`p-2 rounded-sm border transition ${searchOpen ? 'border-ink text-ink' : 'border-rule-soft text-ink-soft'}`}>
                  <Search size={15} />
                </button>
              )}

              {/* Inbox + New post — admin only */}
              {isAdmin && (
                <button
                  onClick={openInbox}
                  className={`relative flex items-center gap-1.5 text-sm px-2 sm:px-2.5 py-1.5 border border-rule-soft rounded-sm hover:border-ink transition ${(reviewQueue.length + stagingQueue.length) > 0 ? 'text-ink' : 'text-ink-mute'}`}>
                  <Mail size={13} />
                  <span className="hidden sm:inline">Inbox</span>
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
              )}

              <div className="flex items-stretch border border-rule-soft rounded-sm overflow-hidden">
                <button
                  onClick={() => setView('month')}
                  className={`px-2 sm:px-2.5 py-1.5 text-xs uppercase tracking-[0.1em] font-semibold transition ${view === 'month' ? 'bg-ink text-paper' : 'text-ink hover:bg-paper-deep'}`}
                  title="Month view"
                  aria-label="Month view">
                  <span className="sm:hidden">M</span>
                  <span className="hidden sm:inline">Month</span>
                </button>
                <button
                  onClick={() => setView('week')}
                  className={`px-2 sm:px-2.5 py-1.5 text-xs uppercase tracking-[0.1em] font-semibold transition ${view === 'week' ? 'bg-ink text-paper' : 'text-ink hover:bg-paper-deep'}`}
                  title="Week view"
                  aria-label="Week view">
                  <span className="sm:hidden">W</span>
                  <span className="hidden sm:inline">Week</span>
                </button>
              </div>

              {isAdmin ? (
                <button
                  onClick={() => openCreate()}
                  className="group flex items-center gap-1.5 text-sm font-semibold px-2.5 sm:px-3 py-1.5 bg-ink text-paper rounded-sm hover:bg-accent hover:text-ink transition shrink-0"
                  title="New post (N)"
                  aria-label="New post">
                  <Plus size={14} strokeWidth={2.5} />
                  <span className="hidden sm:inline">New post</span>
                  <kbd className="ml-1 font-mono text-[10px] text-paper/50 group-hover:text-ink/50 hidden sm:inline">N</kbd>
                </button>
              ) : (
                <button
                  onClick={() => router.push('/login')}
                  className="group flex items-center gap-1.5 text-sm font-semibold px-2.5 sm:px-3 py-1.5 bg-ink text-paper rounded-sm hover:bg-accent hover:text-ink transition shrink-0"
                  title="Sign in to edit"
                  aria-label="Sign in">
                  <LogIn size={14} strokeWidth={2.5} />
                  <span>Sign in</span>
                </button>
              )}

              {/* User menu (admin) */}
              {isAdmin && (
                <div className="relative">
                  <button
                    onClick={() => setUserMenuOpen(v => !v)}
                    aria-label="Account menu"
                    className="flex items-center gap-1.5 text-sm px-2 py-1.5 border border-rule-soft rounded-sm hover:border-ink transition text-ink-soft">
                    <UserIcon size={13} />
                    <span className="hidden md:inline text-[11px] font-mono text-ink-faint max-w-[140px] truncate">
                      {adminDisplayName(user?.email)}
                    </span>
                  </button>
                  {userMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1.5 z-40 bg-paper-warm border border-rule rounded-sm shadow-lg w-56 py-1.5">
                        <div className="px-3 py-2 border-b border-rule-soft">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint font-mono">Signed in as</div>
                          <div className="text-sm text-ink mt-0.5 truncate">{adminDisplayName(user?.email)}</div>
                        </div>
                        <button
                          onClick={async () => { setUserMenuOpen(false); await signOut(); }}
                          className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-paper-deep transition flex items-center gap-2">
                          <LogOut size={13} />
                          Sign out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Mobile: expanding search row */}
          {isMobile && searchOpen && (
            <div className="mt-3 relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                onBlur={() => { if (!search) setSearchOpen(false); }}
                placeholder="Search posts…"
                className="w-full pl-8 pr-3 py-2 text-sm bg-paper-warm border border-rule-soft rounded-sm focus:border-ink focus:outline-none placeholder:text-ink-faint transition" />
            </div>
          )}

          {/* Date nav row */}
          <div className="mt-4 flex items-end justify-between gap-3 sm:gap-4">
            <div className="flex items-end gap-2 sm:gap-3 min-w-0 flex-1">
              <button onClick={() => setCursor(view === 'month' ? subMonths(cursor, 1) : addDays(cursor, -7))}
                className="p-1.5 -ml-1 rounded-sm hover:bg-paper-deep text-ink-soft shrink-0"
                aria-label="Previous">
                <ChevronLeft size={18} />
              </button>
              <h1 className="font-display text-[36px] sm:text-[68px] leading-[0.9] tracking-editorial font-light text-ink min-w-0 truncate">
                <span className="italic">{format(cursor, view === 'month' ? 'LLLL' : 'MMM')}</span>
                <span className="ml-2 sm:ml-3 font-mono not-italic text-ink-mute text-[24px] sm:text-[44px] align-[0.05em]">
                  {format(cursor, view === 'month' ? 'yyyy' : 'yyyy')}
                </span>
              </h1>
              <button onClick={() => setCursor(view === 'month' ? addMonths(cursor, 1) : addDays(cursor, 7))}
                className="p-1.5 rounded-sm hover:bg-paper-deep text-ink-soft shrink-0"
                aria-label="Next">
                <ChevronRight size={18} />
              </button>
              <button onClick={() => setCursor(new Date())}
                className="ml-1 mb-1 text-[10px] uppercase tracking-[0.16em] font-semibold text-ink-mute hover:text-ink font-mono shrink-0">
                today
              </button>
            </div>
          </div>

          {/* Status filter strip — desktop inline, mobile horizontally scrollable */}
          <div className={`mt-3 sm:mt-4 ${isMobile ? '-mx-4 px-4 overflow-x-auto no-scrollbar' : 'flex items-center gap-1.5 flex-wrap justify-end pb-1.5'}`}>
            {isMobile ? (
              <div className="flex items-center gap-1.5 pb-1 min-w-max">
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
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
        <div className="rule-t rule-soft" />
      </header>

      {/* ─── Body ─── */}
      <main className={`flex-1 max-w-[1480px] w-full mx-auto px-4 sm:px-7 py-4 sm:py-6 ${isMobile ? 'pb-24 safe-bottom' : ''}`}>
        {view === 'month' ? (
          isMobile ? (
            <MobileAgenda
              days={monthDays}
              cursor={cursor}
              postsOn={postsOn}
              onOpenDay={(d) => openCreate({ date: format(d, 'yyyy-MM-dd') })}
              onOpenPost={(p) => openEdit(p)}
              arrivedIds={arrivedIds}
              holidays={holidayMap}
            />
          ) : (
            <MonthGrid
              days={monthDays}
              cursor={cursor}
              postsOn={postsOn}
              onOpenDay={(d) => openCreate({ date: format(d, 'yyyy-MM-dd') })}
              onOpenPost={(p) => openEdit(p)}
              onMovePost={handleMovePost}
              arrivedIds={arrivedIds}
              holidays={holidayMap}
              isAdmin={isAdmin}
            />
          )
        ) : (
          <WeekKanban days={weekDays} posts={datedPosts} onOpenPost={(p) => openEdit(p)} onMovePost={handleMovePost} arrivedIds={arrivedIds} holidays={holidayMap} />
        )}

        {/* Subtle legend — admin only (just navigation hints otherwise) */}
        {!isMobile && isAdmin && (
          <div className="mt-8 flex items-center gap-5 flex-wrap text-[10px] uppercase tracking-[0.14em] text-ink-faint font-mono">
            <span>Press</span>
            <Kbd>N</Kbd><span>new</span>
            <Kbd>←</Kbd><Kbd>→</Kbd><span>navigate</span>
            <Kbd>T</Kbd><span>today</span>
            <Kbd>M</Kbd><Kbd>W</Kbd><span>view</span>
            <Kbd>Esc</Kbd><span>close</span>
          </div>
        )}

        {/* Read-only banner for unauthenticated viewers */}
        {!isAdmin && (
          <div className={`mt-6 ${isMobile ? 'mb-4' : 'mb-2'} flex items-center gap-2.5 px-4 py-2.5 bg-paper-warm border border-rule-soft rounded-sm text-sm text-ink-soft`}>
            <span className="w-1.5 h-1.5 rounded-full bg-ink-faint shrink-0" />
            <span className="flex-1">
              <span className="font-medium text-ink">View-only mode.</span>{' '}
              <span className="text-ink-mute">
                Sign in as the Naughty Things admin to add or edit posts.
              </span>
            </span>
            <button
              onClick={() => router.push('/login')}
              className="text-ink font-semibold hover:underline shrink-0 inline-flex items-center gap-1">
              <LogIn size={12} /> Sign in
            </button>
          </div>
        )}
      </main>

      {/* ─── Review inbox (slide-over) ─── */}
      {showReviewInbox && (
        <ReviewInbox
          reviewItems={reviewQueue}
          stagingItems={stagingQueue}
          people={people}
          onClose={() => setShowReviewInbox(false)}
          onOpen={(p) => { openEdit(p); setShowReviewInbox(false); }} />
      )}

      {/* ─── Modal ─── */}
      {(editing || creating) && (
        <PostModal
          post={editing}
          initialDate={creating?.date}
          recentNames={recentNames}
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
  days, cursor, postsOn, onOpenDay, onOpenPost, onMovePost, arrivedIds, holidays, isAdmin
}: {
  days: Date[];
  cursor: Date;
  postsOn: (d: Date) => PostWithPeople[];
  onOpenDay: (d: Date) => void;
  onOpenPost: (p: PostWithPeople) => void;
  onMovePost: (postId: string, newDate: string) => Promise<void> | void;
  arrivedIds: Set<string>;
  holidays: Record<string, Holiday>;
  isAdmin?: boolean;
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
              onMovePost={onMovePost}
              arrivedIds={arrivedIds}
              isAdmin={isAdmin} />
          );
        })}
      </div>
    </div>
  );
}

function DayCell({
  d, inMonth, weekend, isToday, items, holiday, onOpenDay, onOpenPost, onMovePost, arrivedIds, isAdmin
}: {
  d: Date;
  inMonth: boolean;
  weekend: boolean;
  isToday: boolean;
  items: PostWithPeople[];
  holiday: Holiday | null;
  onOpenDay: (d: Date) => void;
  onOpenPost: (p: PostWithPeople) => void;
  onMovePost: (postId: string, newDate: string) => Promise<void> | void;
  arrivedIds: Set<string>;
  isAdmin?: boolean;
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
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onClick={() => onOpenDay(d)}
      onDragOver={(e) => {
        if (!isAdmin) return;
        if (e.dataTransfer.types.includes('application/x-post-id')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!isAdmin) return;
        const postId = e.dataTransfer.getData('application/x-post-id');
        if (postId) onMovePost(postId, format(d, 'yyyy-MM-dd'));
      }}
      className={`group relative min-h-[148px] border-r border-b border-rule-soft last:border-r-0 p-2.5 cursor-pointer transition
        ${inMonth ? '' : 'bg-paper-deep/50 text-ink-faint'}
        ${isSunday && inMonth && !holiday ? 'bg-holiday-tint/40' : ''}
        ${holiday ? 'bg-holiday-tint' : ''}
        ${dragOver ? 'ring-2 ring-accent ring-inset bg-accent/10' : ''}
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
          <PostChip key={p.id} p={p} onOpen={onOpenPost} highlight={arrivedIds.has(p.id)} draggable={!!isAdmin} />
        ))}
        {items.length > 3 && (
          <div className="text-[10px] text-ink-faint font-mono pl-1.5">+{items.length - 3} more</div>
        )}
      </div>
    </div>
  );
}

function PostChip({ p, onOpen, highlight, draggable = true }: { p: PostWithPeople; onOpen: (p: PostWithPeople) => void; highlight?: boolean; draggable?: boolean }) {
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
      draggable={draggable}
      onDragStart={draggable ? (e) => {
        e.dataTransfer.setData('application/x-post-id', p.id);
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
      onClick={(e) => { e.stopPropagation(); onOpen(p); }}
      className={`group/chip w-full text-left relative flex items-start gap-1.5 px-1.5 py-1 rounded-sm ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${STATUS_COLOR[p.status]} ${highlight ? 'just-arrived' : ''} ${draggable ? 'hover:translate-x-0.5' : ''} transition-transform`}>
      {/* platform glyph chips (one per platform) */}
      {platforms.length > 0 ? (
        platforms.map(pl => (
          <PlatformChip key={pl} platform={pl} />
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
   Mobile agenda — vertical day list for month view
   Designed for 360–430px wide screens where the 7-column
   grid is unusable. Same editorial style; days as cards.
   ───────────────────────────────────────── */
function MobileAgenda({
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
  // Only show days in the current month, plus a 1-day lookahead if the
  // surrounding weeks bleed into the next month. Keeps the list focused.
  const visible = days; // already padded weeks from the month grid
  // For mobile we just show all the days from the month grid; if a day has
  // no posts and isn't a holiday/today/weekend, collapse it to a thin row
  // so the user can scan quickly. Past days in the month are shown small.
  const hasAnyPost = visible.some(d => postsOn(d).length > 0);
  return (
    <div className="space-y-1.5">
      {visible.map((d, i) => {
        const inMonth = isSameMonth(d, cursor);
        const items = postsOn(d);
        const isToday = isSameDay(d, today);
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        const holiday = holidays[format(d, 'yyyy-MM-dd')] ?? null;
        const isEmpty = items.length === 0 && !holiday && !isToday;
        if (!inMonth && isEmpty) return null;
        return (
          <MobileDayRow
            key={i}
            d={d}
            inMonth={inMonth}
            weekend={weekend}
            isToday={isToday}
            items={items}
            holiday={holiday}
            compact={isEmpty}
            onOpenDay={onOpenDay}
            onOpenPost={onOpenPost}
            arrivedIds={arrivedIds} />
        );
      })}
      {!hasAnyPost && (
        <div className="text-center py-12 text-ink-faint font-display italic text-2xl">
          Nothing scheduled this month
        </div>
      )}
    </div>
  );
}

function MobileDayRow({
  d, inMonth, weekend, isToday, items, holiday, compact, onOpenDay, onOpenPost, arrivedIds
}: {
  d: Date;
  inMonth: boolean;
  weekend: boolean;
  isToday: boolean;
  items: PostWithPeople[];
  holiday: Holiday | null;
  compact: boolean;
  onOpenDay: (d: Date) => void;
  onOpenPost: (p: PostWithPeople) => void;
  arrivedIds: Set<string>;
}) {
  const isSunday = d.getDay() === 0;
  const dayColor = holiday || isSunday
    ? 'text-holiday'
    : isToday
    ? 'text-accent-deep'
    : inMonth
    ? 'text-ink'
    : 'text-ink-faint';

  if (compact) {
    // Thin weekday-only row, but still tappable to create
    return (
      <button
        onClick={() => onOpenDay(d)}
        className={`w-full flex items-baseline gap-3 px-3 py-2 rounded-sm transition active:bg-paper-deep ${
          inMonth ? '' : 'opacity-50'
        }`}>
        <span className={`numeral text-[20px] ${dayColor} leading-none w-8 text-left`}>
          {format(d, 'd')}
        </span>
        <span className={`text-[10px] uppercase tracking-[0.18em] font-mono ${
          isToday ? 'text-accent-deep font-semibold' : 'text-ink-faint'
        }`}>
          {format(d, 'EEE')}
        </span>
      </button>
    );
  }

  return (
    <div
      onClick={() => onOpenDay(d)}
      className={`relative rounded-sm border p-3 transition active:scale-[0.995] ${
        inMonth ? 'bg-paper-warm border-rule-soft' : 'bg-paper border-rule-soft opacity-70'
      } ${isToday ? 'border-accent border-2 -m-px' : ''} ${holiday ? 'bg-holiday-tint/60' : ''}`}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={`numeral text-[32px] ${dayColor} leading-none`}>
            {format(d, 'd')}
          </span>
          <div className="flex flex-col">
            <span className={`text-[10px] uppercase tracking-[0.18em] font-mono ${
              isToday ? 'text-accent-deep font-semibold' : 'text-ink-mute'
            }`}>
              {format(d, 'EEE')}
              {isToday && <span className="ml-1.5 text-accent-deep">· today</span>}
            </span>
            {holiday ? (
              <span className="text-[10px] font-mono text-holiday font-semibold truncate" title={holiday.name}>
                {holiday.name}
              </span>
            ) : (
              <span className="text-[9px] uppercase tracking-wide font-mono text-ink-faint">
                {format(d, 'MMM')}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] font-mono text-ink-faint shrink-0">
          {items.length > 0 ? `${items.length} post${items.length === 1 ? '' : 's'}` : 'tap to add'}
        </span>
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map(p => (
            <PostChip key={p.id} p={p} onOpen={onOpenPost} highlight={arrivedIds.has(p.id)} draggable={false} />
          ))}
        </div>
      )}
    </div>
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
              const peopleLine = [p.designer, p.copy_writer, p.internal_pic, p.client_pic].filter(Boolean).join(' · ');
              const isStaging = p.status === 'staging';
              return (
                <li key={p.id} className="rule-b border-rule-soft">
                  <button
                    onClick={() => onOpen(p)}
                    className="w-full text-left px-4 sm:px-6 py-4 hover:bg-paper-deep transition block">
                    <div className="flex items-center gap-2 mb-1.5">
                      {isStaging ? (
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded-sm bg-plum text-paper">
                          Needs details
                        </span>
                      ) : (
                        <Tape status={p.status} size="xs" />
                      )}
                      {p.category && (
                        <span className="font-mono text-[9px] uppercase tracking-wide text-ink-mute">
                          {p.category}
                        </span>
                      )}
                      {p.publish_date ? (
                        <span className="font-mono text-[10px] text-ink-faint ml-auto shrink-0">
                          {format(new Date(p.publish_date), 'MMM d')}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-plum ml-auto shrink-0 uppercase tracking-wide">
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

                    {peopleLine && (
                      <div className="mt-1.5 text-[10px] text-ink-mute font-mono truncate">
                        {peopleLine}
                      </div>
                    )}

                    {isStaging && (
                      <div className="mt-2.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-plum">
                        → Click to complete the details
                      </div>
                    )}
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
