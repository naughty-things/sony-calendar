'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { Holiday, getHolidaysInRange } from '@/lib/holidays';
import { getBrowserClient } from '@/lib/supabase/client';
import { PostWithPeople, PostStatus, Person, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, STATUS_DOT, PLATFORM_GLYPH, CATEGORY_GLYPH, CATEGORIES, CATEGORY_LABEL, postCategories, normalizePlatforms } from '@/lib/types';
import { PlatformChip } from './ui/PlatformChip';
import { ChevronLeft, ChevronRight, Plus, Search, Mail, Loader2, Sun, Moon, ChevronDown } from 'lucide-react';
import { PostModal } from './PostModal';
import { WeekKanban } from './WeekKanban';
import { Tape } from './ui/Tape';
import { Toast, ToastItem } from './ui/Toast';
import { useIsMobile } from '@/lib/useIsMobile';
import { useAuth } from '@/lib/auth/AuthProvider';
import { USERS, usernameToEmail } from '@/lib/auth/config';
import { useRouter, usePathname } from 'next/navigation';
import { LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { useTheme } from '@/lib/useTheme';

/** Look up a friendly display name for the signed-in user. */
function adminDisplayName(email?: string | null): string {
  if (!email) return '';
  const match = USERS.find(u => u.email === email);
  return match ? match.displayName : email;
}

type View = 'month' | 'week';
type StatusFilter = PostStatus | 'all';
type CategoryFilter = Set<string>;

export function Calendar() {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState<Date>(new Date());
  const [posts, setPosts] = useState<PostWithPeople[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [recentNames, setRecentNames] = useState<{ designer: string[]; copy_writer: string[]; internal_pic: string[]; client_pic: string[] }>({ designer: [], copy_writer: [], internal_pic: [], client_pic: [] });
  const [editing, setEditing] = useState<PostWithPeople | null>(null);
  const [creating, setCreating] = useState<{ date?: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(new Set());
  const [quotaMonthOnly, setQuotaMonthOnly] = useState(false);
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
  const { theme, toggle: toggleTheme } = useTheme();

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
    setEditing(p);
  }, []);

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

    const collect = (col: 'designer' | 'copy_writer' | 'internal_pic' | 'client_pic') => {
      const set = new Set<string>();
      for (const x of next) {
        const v = (x as any)[col];
        if (typeof v === 'string' && v.trim()) set.add(v.trim());
      }
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

    if (!initialLoaded.current) {
      next.forEach((x: PostWithPeople) => seenPostIds.current.add(x.id));
      initialLoaded.current = true;
      return;
    }

    if (!silent) {
      const newOnes = next.filter((x: PostWithPeople) => !seenPostIds.current.has(x.id));
      if (newOnes.length > 0) {
        newOnes.forEach((x: PostWithPeople) => {
          seenPostIds.current.add(x.id);
          setArrivedIds(prev => new Set(prev).add(x.id));
          if (x.source === 'email' && x.status === 'client_review') {
            setToasts(t => [...t, {
              id: 'arr-' + x.id,
              title: 'New from email',
              detail: x.title,
              kind: 'info',
              ttlMs: 6000
            }]);
          }
        });
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

  /* ─── drag-to-reschedule ─── */
  const handleMovePost = useCallback(async (postId: string, newDate: string) => {
    if (!isAdmin) return;
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, publish_date: newDate } : p));
    const { error } = await supabase
      .from('posts')
      .update({ publish_date: newDate })
      .eq('id', postId);
    if (error) {
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

  /* ─── last ingest timestamp ─── */
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

  /* ─── realtime ─── */
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

  const holidayMap = useMemo(() => {
    const start = monthDays[0] ?? weekDays[0];
    const end = monthDays[monthDays.length - 1] ?? weekDays[weekDays.length - 1];
    if (!start || !end) return {} as Record<string, import('@/lib/holidays').Holiday>;
    return getHolidaysInRange(start, end);
  }, [monthDays, weekDays]);

  const matchesQuotaMonth = useCallback((p: PostWithPeople) => {
    const monthSource = p.quota_month || p.publish_date;
    if (!monthSource) return false;
    const d = new Date(monthSource);
    return d.getFullYear() === cursor.getFullYear() && d.getMonth() === cursor.getMonth();
  }, [cursor]);

  const quotaScopedPosts = useMemo(
    () => quotaMonthOnly ? posts.filter(matchesQuotaMonth) : posts,
    [posts, quotaMonthOnly, matchesQuotaMonth]
  );

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotaScopedPosts.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (categoryFilter.size > 0) {
        const cats = postCategories(p);
        const noneActive = categoryFilter.has('NONE');
        if (cats.length === 0) {
          if (!noneActive) return false;
        } else {
          if (!cats.some(c => categoryFilter.has(c))) return false;
        }
      }
      if (q) {
        const cats = postCategories(p);
        const haystack = [
          p.title,
          p.notes,
          p.designer,
          p.copy_writer,
          p.internal_pic,
          p.client_pic,
          ...normalizePlatforms(p.platform),
          ...cats,
          ...cats.map(c => CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] || c)
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [quotaScopedPosts, statusFilter, categoryFilter, search]);

  const datedPosts = useMemo(
    () => filteredPosts.filter(p => p.publish_date),
    [filteredPosts]
  );

  const reviewQueue = useMemo(
    () => posts.filter(p => p.status === 'client_review')
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
    const c: Record<string, number> = { all: quotaScopedPosts.length };
    STATUS_ORDER.forEach(s => { c[s] = quotaScopedPosts.filter(p => p.status === s).length; });
    return c;
  }, [quotaScopedPosts]);

  /** Posts scheduled for the currently-viewed month (used for the month summary card) */
  const monthStats = useMemo(() => {
    const inMonth = posts.filter(matchesQuotaMonth);
    const total = inMonth.length;
    return { total };
  }, [posts, matchesQuotaMonth]);

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { NONE: 0 };
    CATEGORIES.forEach(k => { c[k] = 0; });
    for (const p of quotaScopedPosts) {
      const cats = postCategories(p);
      if (cats.length === 0) c.NONE++;
      else for (const cat of cats) c[cat] = (c[cat] || 0) + 1;
    }
    return c;
  }, [quotaScopedPosts]);

  function toggleCategory(cat: string) {
    setCategoryFilter(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const liveRel = useMemo(() => {
    if (!lastIngestAt) return null;
    const m = (Date.now() - new Date(lastIngestAt).getTime()) / 1000;
    if (m < 60) return 'just now';
    if (m < 3600) return Math.floor(m / 60) + 'm ago';
    if (m < 86400) return Math.floor(m / 3600) + 'h ago';
    return Math.floor(m / 86400) + 'd ago';
  }, [lastIngestAt]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ─── Header ─── */}
      <header className="z-30 bg-surface border-b border-edge">
        <div className="max-w-[1480px] mx-auto px-4 sm:px-7 pt-4 sm:pt-5 pb-3">
          {/* Top bar */}
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
              <div className="font-display text-[22px] sm:text-[26px] font-medium tracking-tight leading-none whitespace-nowrap">
                <span className="text-ink">SONY</span>
                <span className="text-accent">.</span>
              </div>
              <div className="hidden sm:block w-px h-5 bg-edge" />
              <div className="hidden sm:block text-[13px] font-medium text-text-mute truncate">
                Content Calendar
              </div>
              <div className="hidden md:flex items-center gap-1.5 ml-2 text-[10px] uppercase tracking-[0.14em] text-text-mute font-mono">
                <span className="live-dot" /> Live
                {liveRel && <span className="ml-1 text-text-faint">· {liveRel}</span>}
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Search */}
              {!isMobile && (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search posts…"
                    className="pl-9 pr-3 py-1.5 w-56 text-sm bg-surface-muted border border-edge rounded-md focus:bg-surface focus:border-edge-strong focus:outline-none placeholder:text-text-faint transition" />
                </div>
              )}
              {isMobile && (
                <button
                  onClick={() => setSearchOpen(v => !v)}
                  aria-label="Search"
                  className={`p-2 rounded-md border transition ${searchOpen ? 'border-edge-strong bg-surface text-ink' : 'border-edge bg-surface text-text-soft'}`}>
                  <Search size={15} />
                </button>
              )}

              {/* Inbox */}
              {isAdmin && (
                <button
                  onClick={openInbox}
                  className={`relative flex items-center gap-1.5 text-[13px] px-2.5 py-1.5 bg-surface border border-edge rounded-md hover:border-edge-strong hover:shadow-soft transition ${(reviewQueue.length + stagingQueue.length) > 0 ? 'text-ink' : 'text-text-mute'}`}>
                  <Mail size={13} />
                  <span className="hidden sm:inline">Inbox</span>
                  {reviewQueue.length > 0 && (
                    <span className="ml-0.5 text-[10px] font-semibold bg-accent text-ink rounded-full px-1.5 py-0 leading-[1.5] min-w-[18px] text-center">
                      {reviewQueue.length}
                    </span>
                  )}
                  {stagingQueue.length > 0 && (
                    <span className="ml-0.5 text-[10px] font-semibold bg-plum text-white rounded-full px-1.5 py-0 leading-[1.5] min-w-[18px] text-center">
                      {stagingQueue.length}
                    </span>
                  )}
                </button>
              )}

              {/* View toggle — segmented control */}
              <div className="flex items-center bg-surface-muted border border-edge rounded-md p-0.5">
                <button
                  onClick={() => setView('month')}
                  className={`px-2.5 py-1 text-[12px] font-semibold rounded-[5px] transition ${view === 'month' ? 'bg-surface text-ink shadow-soft' : 'text-text-mute hover:text-ink'}`}>
                  Month
                </button>
                <button
                  onClick={() => setView('week')}
                  className={`px-2.5 py-1 text-[12px] font-semibold rounded-[5px] transition ${view === 'week' ? 'bg-surface text-ink shadow-soft' : 'text-text-mute hover:text-ink'}`}>
                  Week
                </button>
              </div>

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                className="p-2 bg-surface border border-edge rounded-md hover:border-edge-strong hover:shadow-soft text-text-soft hover:text-ink transition">
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </button>

              {/* Primary CTA */}
              {isAdmin ? (
                <button
                  onClick={() => openCreate()}
                  className="flex items-center gap-1.5 text-[13px] font-semibold px-3 py-1.5 bg-btn text-btn-text rounded-md hover:bg-accent hover:text-ink transition shadow-soft shrink-0"
                  title="New post (N)">
                  <Plus size={14} strokeWidth={2.5} />
                  <span className="hidden sm:inline">New post</span>
                </button>
              ) : (
                <button
                  onClick={() => router.push('/login')}
                  className="flex items-center gap-1.5 text-[13px] font-semibold px-3 py-1.5 bg-btn text-btn-text rounded-md hover:bg-accent hover:text-ink transition shadow-soft shrink-0"
                  title="Sign in to edit">
                  <LogIn size={14} strokeWidth={2.5} />
                  <span>Sign in</span>
                </button>
              )}

              {/* User menu */}
              {isAdmin && (
                <div className="relative">
                  <button
                    onClick={() => setUserMenuOpen(v => !v)}
                    aria-label="Account menu"
                    className="flex items-center gap-1.5 text-[13px] pl-2 pr-2 py-1.5 bg-surface border border-edge rounded-md hover:border-edge-strong hover:shadow-soft text-text-soft transition">
                    <span className="w-5 h-5 rounded-full bg-gradient-to-br from-accent to-copper flex items-center justify-center text-[10px] font-bold text-white">
                      {adminDisplayName(user?.email).slice(0, 1).toUpperCase() || <UserIcon size={11} />}
                    </span>
                    <ChevronDown size={12} className="text-text-faint" />
                  </button>
                  {userMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1.5 z-40 bg-surface border border-edge rounded-lg shadow-pop w-64 py-1.5 overflow-hidden">
                        <div className="px-3 py-2.5 border-b border-edge">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint font-mono">Signed in as</div>
                          <div className="text-sm text-ink mt-0.5 truncate font-medium">{adminDisplayName(user?.email)}</div>
                          <div className="text-[11px] text-text-mute truncate">{user?.email}</div>
                        </div>
                        <button
                          onClick={async () => { setUserMenuOpen(false); await signOut(); }}
                          className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-surface-muted transition flex items-center gap-2">
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

          {/* Mobile search */}
          {isMobile && searchOpen && (
            <div className="mt-3 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                onBlur={() => { if (!search) setSearchOpen(false); }}
                placeholder="Search posts…"
                className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-edge rounded-md focus:border-edge-strong focus:outline-none placeholder:text-text-faint transition" />
            </div>
          )}

          {/* Date nav */}
          <div className="mt-5 flex items-end justify-between gap-3 sm:gap-4">
            <div className="flex items-end gap-2 sm:gap-3 min-w-0">
              <button onClick={() => setCursor(view === 'month' ? subMonths(cursor, 1) : addDays(cursor, -7))}
                className="p-1.5 -ml-1 rounded-md hover:bg-surface-muted text-text-soft hover:text-ink transition shrink-0"
                aria-label="Previous">
                <ChevronLeft size={18} />
              </button>
              <h1 className="font-display text-[34px] sm:text-[56px] leading-[1.05] tracking-tight font-medium text-ink shrink-0 whitespace-nowrap">
                <span>{format(cursor, view === 'month' ? 'LLLL' : 'MMM')}</span>
                <span className="ml-2 sm:ml-3 font-mono font-normal text-text-mute text-[22px] sm:text-[36px] align-[0.08em]">
                  {format(cursor, 'yyyy')}
                </span>
              </h1>
              <button onClick={() => setCursor(view === 'month' ? addMonths(cursor, 1) : addDays(cursor, 7))}
                className="p-1.5 rounded-md hover:bg-surface-muted text-text-soft hover:text-ink transition shrink-0"
                aria-label="Next">
                <ChevronRight size={18} />
              </button>
              <button onClick={() => setCursor(new Date())}
                className="ml-1 mb-1.5 px-2.5 py-1 text-[11px] uppercase tracking-[0.1em] font-semibold text-text-mute hover:text-ink bg-surface-muted hover:bg-surface-sunken rounded-md transition shrink-0">
                Today
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2 shrink-0">
              <MonthQuota
                label="All Posts"
                count={monthStats.total}
                supportingCount={monthStats.total}
                supportingLabel="all statuses"
                target={35}
                monthLabel={format(cursor, 'MMM yyyy')}
              />
            </div>
          </div>

          {/* Filter row */}
          <div className={`${isMobile ? 'mt-3 space-y-2' : 'mt-3 flex items-center justify-between gap-3 sm:gap-4 pb-1'}`}>
            {isMobile ? (
              <>
                <div className="-mx-4 px-4 overflow-x-auto no-scrollbar">
                  <div className="flex items-center gap-1.5 pb-1 min-w-max">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint font-mono mr-1 self-center">cat</span>
                    {categoryFilter.size > 0 && (
                      <FilterChip label="clear" onClick={() => setCategoryFilter(new Set())} />
                    )}
                    {CATEGORIES.map(c => {
                      const n = categoryCounts[c] || 0;
                      return (
                        <FilterChip
                          key={c}
                          label={`${c} · ${n}`}
                          active={categoryFilter.has(c)}
                          onClick={() => toggleCategory(c)} />
                      );
                    })}
                    {(categoryCounts.NONE > 0 || categoryFilter.has('NONE')) && (
                      <FilterChip
                        label={`none · ${categoryCounts.NONE}`}
                        active={categoryFilter.has('NONE')}
                        onClick={() => toggleCategory('NONE')} />
                    )}
                  </div>
                </div>
                <div className="-mx-4 px-4 overflow-x-auto no-scrollbar">
                  <div className="pb-1 min-w-max">
                    <div className="flex items-center gap-2 min-w-max">
                      <FilterChip
                        label={`quota · ${format(cursor, 'MMM yyyy')}`}
                        active={quotaMonthOnly}
                        onClick={() => setQuotaMonthOnly(v => !v)}
                      />
                      <StatusSelect
                        value={statusFilter}
                        counts={counts}
                        onChange={setStatusFilter}
                        fullWidth
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint font-mono mr-1 self-center">cat</span>
                  {categoryFilter.size > 0 && (
                    <FilterChip label="clear" onClick={() => setCategoryFilter(new Set())} />
                  )}
                  {CATEGORIES.map(c => {
                    const n = categoryCounts[c] || 0;
                    return (
                      <FilterChip
                        key={c}
                        label={`${c} · ${n}`}
                        title={CATEGORY_LABEL[c]}
                        active={categoryFilter.has(c)}
                        onClick={() => toggleCategory(c)} />
                    );
                  })}
                  {(categoryCounts.NONE > 0 || categoryFilter.has('NONE')) && (
                    <FilterChip
                      label={`none · ${categoryCounts.NONE}`}
                      title="Posts with no category set"
                      active={categoryFilter.has('NONE')}
                      onClick={() => toggleCategory('NONE')} />
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 shrink-0">
                  <FilterChip
                    label={`quota · ${format(cursor, 'MMM yyyy')}`}
                    active={quotaMonthOnly}
                    onClick={() => setQuotaMonthOnly(v => !v)}
                  />
                  <StatusSelect
                    value={statusFilter}
                    counts={counts}
                    onChange={setStatusFilter}
                  />
                </div>
              </>
            )}
          </div>
        </div>
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

        {!isMobile && isAdmin && (
          <div className="mt-8 flex items-center gap-3 flex-wrap text-[10px] uppercase tracking-[0.14em] text-text-faint font-mono">
            <span>Press</span>
            <Kbd>N</Kbd><span>new</span>
            <Kbd>←</Kbd><Kbd>→</Kbd><span>navigate</span>
            <Kbd>T</Kbd><span>today</span>
            <Kbd>M</Kbd><Kbd>W</Kbd><span>view</span>
            <Kbd>Esc</Kbd><span>close</span>
          </div>
        )}

        {!isAdmin && (
          <div className={`mt-6 ${isMobile ? 'mb-4' : 'mb-2'} flex items-center gap-2.5 px-4 py-2.5 bg-surface-muted border border-edge rounded-md text-sm text-text-soft`}>
            <span className="w-1.5 h-1.5 rounded-full bg-text-faint shrink-0" />
            <span className="flex-1">
              <span className="font-medium text-ink">View-only mode.</span>{' '}
              <span className="text-text-mute">
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

      {/* ─── Review inbox ─── */}
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
          canEdit={isAdmin}
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
function FilterChip({ label, color, active = false, onClick, title }: { label: string; color?: string; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border transition ${
        active
          ? 'bg-btn text-btn-text border-ink shadow-soft'
          : 'bg-surface text-text-soft border-edge hover:border-edge-strong hover:text-ink'
      }`}>
      {color && <span className={`w-1.5 h-1.5 rounded-full ${color}`} />}
      {label}
    </button>
  );
}

function StatusSelect({
  value,
  counts,
  onChange,
  fullWidth = false
}: {
  value: StatusFilter;
  counts: Record<string, number>;
  onChange: (value: StatusFilter) => void;
  fullWidth?: boolean;
}) {
  return (
    <label className={`relative inline-flex items-center ${fullWidth ? 'w-full' : ''}`}>
      <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint font-mono mr-2 shrink-0">
        status
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value as StatusFilter)}
        className={`appearance-none bg-surface text-text-soft border border-edge hover:border-edge-strong focus:border-edge-strong focus:outline-none rounded-md text-[12px] font-medium py-1.5 pl-3 pr-8 transition ${fullWidth ? 'w-full min-w-0' : 'min-w-[170px]'}`}>
        <option value="all">{`All · ${counts.all}`}</option>
        {STATUS_ORDER.map(s => (
          <option key={s} value={s}>
            {`${STATUS_LABEL[s]} · ${counts[s] || 0}`}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
    </label>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="font-mono text-[10px] px-1.5 py-0.5 bg-surface-muted text-text-soft rounded border border-edge">
      {children}
    </kbd>
  );
}

/* ─────────────────────────────────────────
   Month summary card — sits inline with the big month title
   ───────────────────────────────────────── */
function MonthQuota({
  label, count, supportingCount, supportingLabel, target = 35, monthLabel
}: {
  label: string;
  count: number;
  supportingCount: number;
  supportingLabel: string;
  target?: number;
  monthLabel: string;
}) {
  return (
    <div className="bg-surface-muted border border-edge-strong rounded-lg shadow-soft px-3 sm:px-4 py-2 sm:py-2.5 shrink-0 self-end mb-1.5 min-w-[160px] sm:min-w-[200px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.16em] font-mono font-semibold text-text-mute">
            {label}
          </span>
          <span className="font-mono text-[10px] text-text-faint">
            · {monthLabel}
          </span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="numeral font-display text-[22px] sm:text-[26px] leading-none font-semibold text-ink">
            {count}
          </span>
          <span className="font-mono text-[11px] sm:text-[12px] text-text-faint">
            / {target}
          </span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] font-mono">
        <span className="text-text-mute">
          <span className="text-ink font-semibold">{supportingCount}</span> {supportingLabel}
        </span>
        <span className="text-text-mute">month total</span>
      </div>
    </div>
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
    <div className="bg-surface border border-edge rounded-lg overflow-hidden shadow-soft">
      <div className="grid grid-cols-7 bg-surface-sunken border-b border-edge">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
          <div key={d} className={`px-3 py-2.5 text-[10px] uppercase tracking-[0.18em] font-semibold font-mono ${i === 0 ? 'text-holiday' : i === 6 ? 'text-text-faint' : 'text-text-mute'}`}>
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
  const isSunday = d.getDay() === 0;
  const dayColor = holiday || isSunday
    ? 'text-holiday'
    : isToday
    ? 'text-accent-deep'
    : inMonth
    ? 'text-ink'
    : 'text-text-faint';
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
      className={`group relative min-h-[148px] border-r border-b border-edge last:border-r-0 p-2.5 cursor-pointer transition flex flex-col overflow-hidden
        ${inMonth ? '' : 'bg-surface-muted text-text-faint'}
        ${(isSunday && inMonth && !holiday) || holiday ? 'bg-holiday-tint/50' : ''}
        ${dragOver ? 'ring-2 ring-accent ring-inset bg-accent/10' : ''}
        hover:bg-surface-muted`}>
      <div className="flex items-start justify-between">
        <div className="flex flex-col items-start">
          <span className={`numeral text-[34px] ${dayColor} leading-[0.9] group-hover:text-ink transition`}>
            {format(d, 'd')}
          </span>
          <span className={`mt-0.5 text-[9px] uppercase tracking-[0.16em] font-mono ${isToday ? 'text-accent-deep font-semibold' : 'text-text-faint'}`}>
            {format(d, 'MMM')}
          </span>
          {holiday && inMonth && (
            <span title={holiday.name} className="mt-1 text-[9px] font-mono text-holiday font-semibold truncate max-w-full">
              {holiday.name}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <span className="text-[10px] font-mono text-text-mute mt-1 px-1.5 py-0.5 bg-surface-muted rounded">{items.length}</span>
        )}
      </div>

      <div className={`mt-2 space-y-1 pr-1 ${items.length > 3 ? 'max-h-[108px] overflow-y-auto' : ''}`}>
        {items.map(p => (
          <PostChip key={p.id} p={p} onOpen={onOpenPost} highlight={arrivedIds.has(p.id)} draggable={!!isAdmin} />
        ))}
      </div>
    </div>
  );
}

function PostChip({ p, onOpen, highlight, draggable = true }: { p: PostWithPeople; onOpen: (p: PostWithPeople) => void; highlight?: boolean; draggable?: boolean }) {
  const cats = postCategories(p);
  const platforms = normalizePlatforms(p.platform, p.source === 'email' ? ['IG'] : []);
  // Status-tinted left bar + subtle background — gives at-a-glance
  // status scanning in the month grid (was the original "paper tape" feel).
  const statusBar: Record<string, string> = {
    staging:       'before:bg-plum',
    in_progress:   'before:bg-steel',
    client_review: 'before:bg-magenta',
    approved:      'before:bg-accent',
    posted:        'before:bg-forest'
  };
  const statusBg: Record<string, string> = {
    staging:       'bg-[#F6EFF8] dark:bg-[#2A1E32]',
    in_progress:   'bg-[#ECF2FB] dark:bg-[#1B2638]',
    client_review: 'bg-[#FBEDF1] dark:bg-[#321E26]',
    approved:      'bg-accent-soft dark:bg-[#2E2510]',
    posted:        'bg-[#ECF6EF] dark:bg-[#1B2A20]'
  };
  const statusBorder: Record<string, string> = {
    staging:       'border-plum/40 dark:border-plum/40',
    in_progress:   'border-steel/40 dark:border-steel/40',
    client_review: 'border-magenta/40 dark:border-magenta/40',
    approved:      'border-accent/50 dark:border-accent/50',
    posted:        'border-forest/40 dark:border-forest/40'
  };
  return (
    <button
      draggable={draggable}
      onDragStart={draggable ? (e) => {
        e.dataTransfer.setData('application/x-post-id', p.id);
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
      onClick={(e) => { e.stopPropagation(); onOpen(p); }}
      className={`group/chip relative w-full text-left flex items-start gap-1.5 pl-3 pr-2 py-1.5 rounded-md border ${statusBg[p.status]} ${statusBorder[p.status]} ${draggable ? 'cursor-grab active:cursor-grabbing hover:shadow-soft' : ''} ${highlight ? 'just-arrived' : ''} transition before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full ${statusBar[p.status]}`}>
      {platforms.length > 0 ? (
        platforms.map(pl => (
          <PlatformChip key={pl} platform={pl} />
        ))
      ) : (
        <span className="font-mono text-[8px] font-bold leading-tight bg-surface/70 text-text-mute px-1 py-0.5 rounded-sm shrink-0 mt-[1px]">··</span>
      )}
      {cats.length > 0 && (
        <span className="font-mono text-[8px] font-bold leading-tight bg-surface/70 text-text-soft px-1 py-0.5 rounded-sm shrink-0 mt-[1px]">
          {cats.map(c => CATEGORY_GLYPH[c as keyof typeof CATEGORY_GLYPH] || c).join('·')}
        </span>
      )}
      <span className="text-[12px] leading-[1.25] font-medium line-clamp-2 flex-1 min-w-0 text-ink">
        {p.title}
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────
   Mobile agenda
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
  const visible = days;
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
        <div className="text-center py-12 text-text-faint font-display italic text-2xl">
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
    : 'text-text-faint';

  if (compact) {
    return (
      <button
        onClick={() => onOpenDay(d)}
        className={`w-full flex items-baseline gap-3 px-3 py-2 rounded-md transition active:bg-surface-muted ${
          inMonth ? '' : 'opacity-50'
        }`}>
        <span className={`numeral text-[20px] ${dayColor} leading-none w-8 text-left`}>
          {format(d, 'd')}
        </span>
        <span className={`text-[10px] uppercase tracking-[0.18em] font-mono ${
          isToday ? 'text-accent-deep font-semibold' : 'text-text-faint'
        }`}>
          {format(d, 'EEE')}
        </span>
      </button>
    );
  }

  return (
    <div
      onClick={() => onOpenDay(d)}
      className={`relative rounded-lg border p-3 transition active:scale-[0.998] bg-surface ${
        inMonth ? 'border-edge' : 'border-edge opacity-70'
      } ${isToday ? 'border-accent border-2 -m-px' : ''} ${holiday ? 'bg-holiday-tint/50' : ''}`}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={`numeral text-[30px] ${dayColor} leading-none`}>
            {format(d, 'd')}
          </span>
          <div className="flex flex-col">
            <span className={`text-[10px] uppercase tracking-[0.18em] font-mono ${
              isToday ? 'text-accent-deep font-semibold' : 'text-text-mute'
            }`}>
              {format(d, 'EEE')}
              {isToday && <span className="ml-1.5 text-accent-deep">· today</span>}
            </span>
            {holiday ? (
              <span className="text-[10px] font-mono text-holiday font-semibold truncate" title={holiday.name}>
                {holiday.name}
              </span>
            ) : (
              <span className="text-[9px] uppercase tracking-wide font-mono text-text-faint">
                {format(d, 'MMM')}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] font-mono text-text-faint shrink-0">
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
      <div className="fixed inset-0 bg-black/40 dark:bg-black/60 z-40 sheet" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-surface border-l border-edge shadow-pop flex flex-col sheet">
        <div className="px-6 pt-5 pb-0 border-b border-edge">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-text-mute font-mono">Inbox</div>
              <h2 className="font-display text-[26px] tracking-tight font-medium mt-0.5 text-ink">
                {tab === 'review' ? 'Awaiting review' : 'Needs launch date'}
              </h2>
            </div>
            <button onClick={onClose} className="text-text-mute hover:text-ink hover:bg-surface-muted w-8 h-8 rounded-md flex items-center justify-center text-xl leading-none transition">
              ×
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-4 -mb-px flex items-center gap-1">
            <TabBtn active={tab === 'review'} onClick={() => setTab('review')}>
              <span>Review</span>
              <span className={`ml-2 font-mono text-[10px] rounded-full px-1.5 py-0 leading-[1.5] min-w-[18px] text-center ${
                tab === 'review' ? 'bg-surface-muted text-ink' : 'bg-accent text-ink'
              }`}>
                {reviewItems.length}
              </span>
            </TabBtn>
            <TabBtn active={tab === 'staging'} onClick={() => setTab('staging')}>
              <span>Staging</span>
              {stagingItems.length > 0 && (
                <span className={`ml-2 font-mono text-[10px] rounded-full px-1.5 py-0 leading-[1.5] min-w-[18px] text-center ${
                  tab === 'staging' ? 'bg-surface-muted text-ink' : 'bg-plum text-white'
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
                  <div className="font-display italic text-3xl text-text-faint">Inbox zero</div>
                  <div className="text-sm text-text-mute mt-2">No posts waiting for your eyes.</div>
                </>
              ) : (
                <>
                  <div className="font-display italic text-3xl text-text-faint">Staging is clear</div>
                  <div className="text-sm text-text-mute mt-2">Every forwarded email has a launch date. PIC doesn't need to assign anything.</div>
                </>
              )}
            </div>
          )}
          <ul>
            {items.map(p => {
              const peopleLine = [p.designer, p.copy_writer, p.internal_pic, p.client_pic].filter(Boolean).join(' · ');
              const isStaging = p.status === 'staging';
              return (
                <li key={p.id} className="border-b border-edge last:border-b-0">
                  <button
                    onClick={() => onOpen(p)}
                    className="w-full text-left px-4 sm:px-6 py-4 hover:bg-surface-muted transition block">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      {isStaging ? (
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full bg-plum text-white">
                          Needs details
                        </span>
                      ) : (
                        <Tape status={p.status} size="xs" />
                      )}
                      {postCategories(p).length > 0 && (
                        <span className="font-mono text-[9px] uppercase tracking-wide text-text-mute">
                          {postCategories(p).join(' · ')}
                        </span>
                      )}
                      {p.publish_date ? (
                        <span className="font-mono text-[10px] text-text-faint ml-auto shrink-0">
                          {format(new Date(p.publish_date), 'MMM d')}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-plum ml-auto shrink-0 uppercase tracking-wide">
                          no date
                        </span>
                      )}
                    </div>
                    <div className={`font-medium text-[15px] leading-snug text-ink`}>
                      {p.title}
                    </div>
                    {p.notes && <div className="text-xs text-text-mute mt-1 line-clamp-2">{p.notes}</div>}

                    {isStaging && p.source_meta?.missing && (
                      <div className="mt-2 text-[10px] text-plum font-mono uppercase tracking-wide">
                        Missing: {p.source_meta.missing}
                      </div>
                    )}

                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-text-faint font-mono uppercase tracking-wide">
                      {p.source === 'email' && <><Mail size={10} className="inline mr-1" />From email</>}
                      {p.source_meta?.confidence != null && (
                        <span className="ml-1">· {(p.source_meta.confidence * 100).toFixed(0)}% confident</span>
                      )}
                    </div>

                    {peopleLine && (
                      <div className="mt-1.5 text-[10px] text-text-mute font-mono truncate">
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
          ? 'border-accent text-ink'
          : 'border-transparent text-text-mute hover:text-ink'
      }`}>
      {children}
    </button>
  );
}
