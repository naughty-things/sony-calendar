'use client';

import { useState, useEffect, useRef } from 'react';
import { Post, PostStatus, PostWithPeople, STATUS_LABEL, STATUS_ORDER, CATEGORIES, CATEGORY_LABEL, CATEGORY_GLYPH, PLATFORMS, PLATFORM_GLYPH } from '@/lib/types';
import { getBrowserClient } from '@/lib/supabase/client';
import { X, Trash2, Sparkles, Mail, Briefcase, Building2, FileText, Check, Loader2, Pen, Type } from 'lucide-react';
import { Tape } from './ui/Tape';
import { NameInput } from './ui/NameInput';
import { useIsMobile } from '@/lib/useIsMobile';

const ALL_STATUSES: PostStatus[] = STATUS_ORDER;

/** Normalize whatever shape `post.category` arrives in (string | string[] | null)
 *  into a string[]. The DB column is text[] post-migration, but legacy rows and
 *  optimistic-update payloads can still look scalar. */
function postCategories(post: { category?: string[] | string | null } | null | undefined): string[] {
  if (!post || post.category == null) return [];
  if (Array.isArray(post.category)) return post.category.filter(Boolean) as string[];
  if (typeof post.category === 'string' && post.category) return [post.category];
  return [];
}

export type RecentNames = {
  designer: string[];
  copy_writer: string[];
  internal_pic: string[];
  client_pic: string[];
};

export function PostModal({
  post, initialDate, recentNames, onClose, onSaved
}: {
  post: PostWithPeople | null;
  initialDate?: string;
  recentNames: RecentNames;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const supabase = getBrowserClient();
  const [title, setTitle] = useState(post?.title ?? '');
  const [platform, setPlatform] = useState<string[]>(Array.isArray(post?.platform) ? post!.platform! : (post?.platform ? [post.platform] : ['IG']));
  const [category, setCategory] = useState<string[]>(postCategories(post));
  /* For 'staging' posts (missing publish_date), default to empty string so
   the date input shows empty — PIC has to consciously pick a date, not
   accidentally save with today's date as default. */
  const stagingPost = post?.status === 'staging' && !post?.publish_date;
  const [publishDate, setPublishDate] = useState<string>(
    post?.publish_date
      ?? initialDate
      ?? (stagingPost ? '' : new Date().toISOString().slice(0, 10))
  );
  // The two date columns from the email's planning table (Request Date =
  // copy delivery deadline, Target Launch Date = post go-live date).
  // Mostly informational; the user edits publish_date which is what the
  // calendar uses. Read-only-ish: they re-sync if the email gets reprocessed.
  const [targetLaunchDate, setTargetLaunchDate] = useState<string>(post?.target_launch_date ?? '');
  const [requestDate, setRequestDate] = useState<string>(post?.request_date ?? '');
  const [status, setStatus] = useState<PostStatus>(post?.status ?? 'in_progress');
  const [designer, setDesigner] = useState<string>(post?.designer ?? '');
  const [copyWriter, setCopyWriter] = useState<string>(post?.copy_writer ?? '');
  const [internalPic, setInternalPic] = useState<string>(post?.internal_pic ?? '');
  const [clientPic, setClientPic] = useState<string>(post?.client_pic ?? '');
  const [notes, setNotes] = useState(post?.notes ?? '');
  const [copyDraft, setCopyDraft] = useState(post?.copy_draft ?? '');
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => firstFieldRef.current?.focus(), 100);
  }, []);

  async function save() {
    setSaving(true);
    // Defense-in-depth: server-side RLS will reject this too, but bail
    // early with a clear message if somehow reached without auth.
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setSaving(false);
      alert('You need to sign in to save changes.');
      return;
    }
    const trim = (s: string) => s.trim() || null;
    /* Auto-transition: if this post was in 'staging' (missing a launch date)
       and the user just filled in publish_date, promote it to in_progress so
       it shows up on the calendar grid. If they cleared publish_date on a
       post that's not in staging, demote it to staging so PIC knows it
       needs attention. The user can still explicitly pick any status they
       want via the status tape — this only runs when the current status
       matches the auto-transition trigger. */
    let effectiveStatus = status;
    if (post?.status === 'staging' && publishDate) {
      effectiveStatus = 'in_progress';
    } else if (post?.status === 'in_progress' && !publishDate) {
      effectiveStatus = 'staging';
    } else if (post?.status === 'staging' && !publishDate) {
      effectiveStatus = 'staging'; // no-op, just to be explicit
    }
    const payload: Partial<Post> = {
      title: title || '(untitled)',
      platform: platform.length > 0 ? platform : null,
      category: category.length > 0 ? category : null,
      publish_date: publishDate || null,
      target_launch_date: targetLaunchDate || null,
      request_date: requestDate || null,
      status: effectiveStatus,
      designer: trim(designer),
      copy_writer: trim(copyWriter),
      internal_pic: trim(internalPic),
      client_pic: trim(clientPic),
      notes,
      copy_draft: copyDraft
    };
    if (post?.id) {
      await supabase.from('posts').update(payload).eq('id', post.id);
    } else {
      const { data: client } = await supabase.from('clients').select('id').eq('slug', 'sony').single();
      await supabase.from('posts').insert({ ...payload, client_id: client!.id, source: 'manual' });
    }
    setSaving(false);
    setSavedFlash(true);
    setTimeout(() => onSaved(), 250);
  }

  async function remove() {
    if (!post?.id) return;
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      alert('You need to sign in to delete posts.');
      return;
    }
    if (!confirm('Delete this post?')) return;
    await supabase.from('posts').delete().eq('id', post.id);
    await onSaved();
  }

  async function runDraft() {
    setDrafting(true);
    const res = await fetch('/api/ai/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, platform, notes })
    });
    const j = await res.json();
    if (j.draft) setCopyDraft(j.draft);
    setDrafting(false);
  }

  const showEmail = post?.source === 'email' && post?.source_meta;
  const isMobile = useIsMobile();

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-0 sm:p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className={`sheet bg-paper text-ink w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col border-rule shadow-2xl ${
          isMobile ? 'h-screen max-h-screen rounded-none' : 'rounded-sm border'
        }`}>
        {/* ─── Header ─── */}
        <div className="px-4 sm:px-7 py-4 rule-b border-rule-soft flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-ink-mute font-mono">
              {post ? 'Edit' : 'New'} post
              {post?.source === 'email' && (
                <span className="ml-2 flex items-center gap-1 text-magenta">
                  <Mail size={10} /> from email
                </span>
              )}
            </div>
            <h2 className="font-display text-2xl tracking-editorial mt-1 truncate">
              {title || <span className="text-ink-faint italic">Untitled post</span>}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Tape status={status} size="md" />
            <button onClick={onClose} className="p-1.5 -mr-1 text-ink-mute hover:text-ink">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ─── Body — split: form + (optional) email peek ─── */}
        <div className={`flex-1 overflow-y-auto ${showEmail ? 'grid md:grid-cols-[1.4fr_1fr]' : ''}`}>
          {/* FORM */}
          <div className="p-4 sm:p-7 space-y-5">
            {/* Staging hint — show only when this post is in the 'staging'
                state (no publish_date yet). PIC sees a clear call-to-action
                to assign a launch date. The status auto-transitions to
                in_progress on save when publish_date is filled in. */}
            {post?.status === 'staging' && (
              <div className="px-3 py-2.5 rounded-sm border border-plum/30 bg-plum/5 text-sm flex items-start gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-sm bg-plum text-paper shrink-0 mt-0.5">
                  Staging
                </span>
                <div className="flex-1">
                  <div className="text-ink">
                    <span className="font-medium">This post needs a launch date.</span>{' '}
                    <span className="text-ink-mute">
                      Fill in the <span className="font-mono text-[11px]">Publish date</span> field below
                      and save — the status will move to in_progress and the post will appear on the calendar.
                    </span>
                  </div>
                  {post.source_meta?.routed_reason && (
                    <div className="mt-1 text-[11px] text-ink-mute font-mono">
                      {post.source_meta.routed_reason}
                    </div>
                  )}
                </div>
              </div>
            )}
            <Field label="Title">
              <input
                ref={firstFieldRef}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Friday IG post for Sony Alpha 7C II"
                className={inputCls} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Platforms (multi-select)">
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map(p => {
                    const active = platform.includes(p);
                    const isLogo = p === 'IG' || p === 'FB';
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPlatform(active ? platform.filter(x => x !== p) : [...platform, p])}
                        title={p}
                        className={`px-1.5 py-0.5 rounded-sm border transition flex items-center gap-1.5 ${
                          active
                            ? 'bg-ink border-ink'
                            : 'bg-transparent border-rule-soft hover:border-ink-mute'
                        }`}>
                        {isLogo ? (
                          <img
                            src={p === 'IG' ? '/platforms/instagram.png' : '/platforms/facebook.png'}
                            alt={p}
                            width={18}
                            height={18}
                            className="block shrink-0 rounded-[2px]"
                            style={{ width: 18, height: 18 }}
                          />
                        ) : (
                          <span className={`text-[10px] font-semibold uppercase tracking-wide ${active ? 'text-paper' : 'text-ink-soft'}`}>
                            {PLATFORM_GLYPH[p]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Categories (multi-select)">
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map(c => {
                    const active = category.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategory(active ? category.filter(x => x !== c) : [...category, c])}
                        title={CATEGORY_LABEL[c]}
                        className={`px-1.5 py-0.5 rounded-sm border transition flex items-center gap-1.5 ${
                          active
                            ? 'bg-ink border-ink text-paper'
                            : 'bg-transparent border-rule-soft hover:border-ink-mute text-ink-soft'
                        }`}>
                        <span className="text-[10px] font-semibold uppercase tracking-wide">
                          {CATEGORY_GLYPH[c]}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {category.length > 0 && (
                  <div className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-ink-mute font-mono">
                    {category.map(c => (CATEGORY_LABEL as Record<string, string>)[c] || c).join(' · ')}
                  </div>
                )}
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <Field label="Publish date" required={stagingPost}>
                <input
                  type="date"
                  value={publishDate}
                  onChange={e => setPublishDate(e.target.value)}
                  className={`${inputCls} ${stagingPost && !publishDate ? 'border-plum ring-1 ring-plum/30 bg-plum/5' : ''}`}
                />
              </Field>
              {/* Show the planning-table date columns when the email
                  surfaced them. These are mostly informational — the human
                  reviewer uses them as reference when filling in
                  publish_date. Hidden when both are empty. */}
              {(targetLaunchDate || requestDate || post?.target_launch_date || post?.request_date) && (
                <div className="grid grid-cols-2 gap-3 -mt-2">
                  <Field label={
                    <span className="flex items-center gap-1">
                      <span className="text-[10px] text-ink-mute font-mono">Target Launch</span>
                      <span className="text-[9px] text-ink-mute">from email</span>
                    </span>
                  }>
                    <input type="date" value={targetLaunchDate} onChange={e => setTargetLaunchDate(e.target.value)} className={inputCls} />
                  </Field>
                  <Field label={
                    <span className="flex items-center gap-1">
                      <span className="text-[10px] text-ink-mute font-mono">Request Date</span>
                      <span className="text-[9px] text-ink-mute">copy deadline</span>
                    </span>
                  }>
                    <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} className={inputCls} />
                  </Field>
                </div>
              )}
            </div>

            <Field label="Status">
              <div className="flex flex-wrap gap-1.5">
                {ALL_STATUSES.map(s => {
                  const active = status === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      className={`text-[10px] px-2 py-1 rounded-sm border font-semibold uppercase tracking-wide transition ${
                        active
                          ? 'bg-ink text-paper border-ink'
                          : 'bg-transparent text-ink-soft border-rule-soft hover:border-ink-mute'
                      }`}>
                      {STATUS_LABEL[s]}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={<><Pen size={11} className="inline mr-1" />Designer</>}>
                <NameInput
                  id="designer"
                  value={designer}
                  onChange={setDesigner}
                  suggestions={recentNames.designer}
                  placeholder="e.g. Sam Lee"
                  className={inputCls} />
              </Field>
              <Field label={<><Type size={11} className="inline mr-1" />Copy writer</>}>
                <NameInput
                  id="copy-writer"
                  value={copyWriter}
                  onChange={setCopyWriter}
                  suggestions={recentNames.copy_writer}
                  placeholder="e.g. Cheri Cheung"
                  className={inputCls} />
              </Field>
              <Field label={<><Briefcase size={11} className="inline mr-1" />Internal PIC</>}>
                <NameInput
                  id="internal-pic"
                  value={internalPic}
                  onChange={setInternalPic}
                  suggestions={recentNames.internal_pic}
                  placeholder="e.g. Sam Lee"
                  className={inputCls} />
              </Field>
              <Field label={<><Building2 size={11} className="inline mr-1" />Client PIC</>}>
                <NameInput
                  id="client-pic"
                  value={clientPic}
                  onChange={setClientPic}
                  suggestions={recentNames.client_pic}
                  placeholder="e.g. Sony HK"
                  className={inputCls} />
              </Field>
            </div>

            <Field label={<><FileText size={11} className="inline mr-1" />Notes</>}>
              <textarea value={notes ?? ''} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Context, talking points, links…"
                className={inputCls} />
            </Field>

            <Field
              label={
                <div className="flex items-center justify-between w-full">
                  <span><Sparkles size={11} className="inline mr-1" />Copy draft</span>
                  <button
                    onClick={runDraft}
                    disabled={drafting || !title}
                    className="text-[10px] uppercase tracking-[0.14em] font-mono flex items-center gap-1.5 text-accent-deep hover:text-ink disabled:text-ink-faint font-semibold">
                    {drafting ? <><Loader2 size={11} className="animate-spin" /> drafting</> : <><Sparkles size={11} /> AI draft</>}
                  </button>
                </div>
              }>
              <textarea
                value={copyDraft ?? ''}
                onChange={e => setCopyDraft(e.target.value)}
                rows={5}
                className={inputCls}
                placeholder="AI-drafted or hand-written copy…" />
            </Field>
          </div>

          {/* EMAIL PEEK (right side, when source=email) */}
          {showEmail && (
            <div className="bg-paper-deep border-l border-rule-soft p-4 sm:p-7 space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-ink-mute font-mono mb-1.5">From email</div>
                <div className="font-display text-lg tracking-editorial leading-tight">
                  {post.source_meta.subject || '(no subject)'}
                </div>
              </div>
              {post.source_meta.from && (
                <div className="text-xs text-ink-soft font-mono">
                  <span className="text-ink-mute">From:</span> {post.source_meta.from}
                </div>
              )}
              {post.source_meta.confidence != null && (
                <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide bg-accent text-ink px-2 py-1 rounded-sm font-semibold">
                  AI {(post.source_meta.confidence * 100).toFixed(0)}% confident
                </div>
              )}
              {post.source_meta.parse_warnings?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-ink-mute font-mono mb-1.5">
                    ⚠ AI flagged these issues
                  </div>
                  <ul className="text-xs text-ink-soft leading-relaxed space-y-1 list-disc pl-5">
                    {post.source_meta.parse_warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {post.source_meta.mentioned_internal?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-ink-mute font-mono mb-1.5">Mentioned internal</div>
                  <div className="flex flex-wrap gap-1">
                    {post.source_meta.mentioned_internal.map((n: string, i: number) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-sm bg-steel/10 text-steel font-mono">{n}</span>
                    ))}
                  </div>
                </div>
              )}
              {post.source_meta.mentioned_client?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-ink-mute font-mono mb-1.5">Mentioned client</div>
                  <div className="flex flex-wrap gap-1">
                    {post.source_meta.mentioned_client.map((n: string, i: number) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-sm bg-copper/15 text-copper font-mono">{n}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="pt-3 border-t border-rule-soft">
                <div className="text-[10px] uppercase tracking-[0.16em] text-ink-mute font-mono mb-2">Original body</div>
                <div className="text-xs text-ink-soft leading-relaxed font-mono whitespace-pre-wrap max-h-72 overflow-y-auto">
                  {post.source_meta.body || post.notes || '(no body)'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── Footer ─── */}
        <div className="px-7 py-3.5 rule-t border-rule-soft flex items-center justify-between bg-paper-warm">
          {post?.id ? (
            <button onClick={remove} className="text-rust hover:text-ink text-[11px] uppercase tracking-[0.14em] font-mono font-semibold flex items-center gap-1.5">
              <Trash2 size={12} /> Delete
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-[11px] uppercase tracking-[0.14em] font-mono font-semibold text-ink-mute hover:text-ink">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !title}
              className="px-5 py-1.5 text-[11px] uppercase tracking-[0.14em] font-mono font-semibold bg-ink text-paper rounded-sm hover:bg-accent hover:text-ink transition flex items-center gap-1.5 disabled:opacity-30">
              {saving ? <><Loader2 size={11} className="animate-spin" /> saving</>
                : savedFlash ? <><Check size={12} /> saved</>
                : <>Save</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-transparent border-b border-rule-soft focus:border-ink focus:outline-none px-0 py-1.5 text-sm transition placeholder:text-ink-faint';

function Field({ label, children, required }: { label: React.ReactNode; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.16em] text-ink-mute font-mono font-semibold mb-1.5">
        {label}
        {required && <span className="text-plum ml-1" title="Required for staging posts">*</span>}
      </div>
      {children}
    </label>
  );
}
