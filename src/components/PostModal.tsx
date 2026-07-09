'use client';

import { useState, useEffect, useRef } from 'react';
import { Post, PostStatus, PostWithPeople, STATUS_LABEL, STATUS_ORDER, CATEGORIES, CATEGORY_LABEL, CATEGORY_GLYPH, PLATFORMS, PLATFORM_GLYPH, normalizeCategories, normalizePlatforms, postCategories } from '@/lib/types';
import { getBrowserClient } from '@/lib/supabase/client';
import { X, Trash2, Sparkles, Mail, Briefcase, Building2, FileText, Check, Loader2, Pen, Type } from 'lucide-react';
import { Tape } from './ui/Tape';
import { NameInput } from './ui/NameInput';
import { useIsMobile } from '@/lib/useIsMobile';
import { normalizeMentionedPeople } from '@/lib/emailParticipants';

const ALL_STATUSES: PostStatus[] = STATUS_ORDER;

export type RecentNames = {
  designer: string[];
  copy_writer: string[];
  internal_pic: string[];
  client_pic: string[];
};

export function PostModal({
  post, initialDate, recentNames, canEdit = true, onClose, onSaved
}: {
  post: PostWithPeople | null;
  initialDate?: string;
  recentNames: RecentNames;
  canEdit?: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const supabase = getBrowserClient();
  const [title, setTitle] = useState(post?.title ?? '');
  const [platform, setPlatform] = useState<string[]>(normalizePlatforms(post?.platform, ['IG']));
  const [category, setCategory] = useState<string[]>(postCategories(post));
  const stagingPost = post?.status === 'staging' && !post?.publish_date;
  const [publishDate, setPublishDate] = useState<string>(
    post?.publish_date
      ?? initialDate
      ?? (stagingPost ? '' : new Date().toISOString().slice(0, 10))
  );
  const [quotaMonth, setQuotaMonth] = useState<string>(post?.quota_month ? post.quota_month.slice(0, 7) : '');
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
  const [deleting, setDeleting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => firstFieldRef.current?.focus(), 100);
  }, []);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setSaving(false);
      alert('You need to sign in to save changes.');
      return;
    }
    const trim = (s: string) => s.trim() || null;
    let effectiveStatus = status;
    if (post?.status === 'staging' && publishDate) {
      effectiveStatus = 'in_progress';
    } else if (post?.status === 'in_progress' && !publishDate) {
      effectiveStatus = 'staging';
    } else if (post?.status === 'staging' && !publishDate) {
      effectiveStatus = 'staging';
    }
    const normalizedCategory = normalizeCategories(category);
    const payload: Partial<Post> = {
      title: title || '(untitled)',
      platform: normalizePlatforms(platform, ['IG']),
      category: normalizedCategory.length > 0 ? normalizedCategory : null,
      publish_date: publishDate || null,
      quota_month: quotaMonth ? `${quotaMonth}-01` : null,
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
    if (!canEdit || !post?.id) return;
    setDeleting(true);
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setDeleting(false);
      alert('You need to sign in to delete posts.');
      return;
    }
    if (!confirm('Delete this post?')) {
      setDeleting(false);
      return;
    }

    const { error: unlinkError } = await supabase
      .from('email_ingests')
      .update({ created_post_id: null })
      .eq('created_post_id', post.id);
    if (unlinkError) {
      setDeleting(false);
      alert(`Could not prepare delete: ${unlinkError.message}`);
      return;
    }

    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .eq('id', post.id);
    if (deleteError) {
      setDeleting(false);
      alert(`Could not delete post: ${deleteError.message}`);
      return;
    }

    setDeleting(false);
    await onSaved();
  }

  async function runDraft() {
    if (!canEdit) return;
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

  const showEmail = canEdit && post?.source === 'email' && post?.source_meta;
  const normalizedMentions = normalizeMentionedPeople(
    {
      mentioned_internal: post?.source_meta?.mentioned_internal,
      mentioned_client: post?.source_meta?.mentioned_client
    },
    post?.source_meta?.effective_from || post?.source_meta?.from
  );
  const isMobile = useIsMobile();

  return (
    <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 flex items-center justify-center p-0 sm:p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className={`sheet bg-surface text-ink w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col border border-edge-strong shadow-pop ${
          isMobile ? 'h-screen max-h-screen rounded-none' : 'rounded-xl border'
        }`}>
        {/* ─── Header ─── */}
        <div className="px-4 sm:px-6 py-4 border-b border-edge flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-text-mute font-mono font-semibold">
              {post ? (canEdit ? 'Edit' : 'View') : 'New'} post
              {showEmail && (
                <span className="ml-1 inline-flex items-center gap-1 text-magenta">
                  <Mail size={10} /> from email
                </span>
              )}
            </div>
            <h2 className="font-display text-[22px] tracking-tight font-medium mt-1 truncate text-ink">
              {title || <span className="text-text-faint italic">Untitled post</span>}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Tape status={status} size="md" />
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 -mr-1 text-text-mute hover:text-ink hover:bg-surface-muted rounded-md transition">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ─── Body ─── */}
        <div className={`flex-1 overflow-y-auto ${showEmail ? 'grid md:grid-cols-[1.4fr_1fr]' : ''}`}>
          {/* FORM */}
          <div className="p-4 sm:p-6 space-y-5">
              {canEdit && post?.status === 'staging' && (
              <div className="px-3 py-2.5 rounded-md border border-plum/30 bg-plum/5 text-sm flex items-start gap-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full bg-plum text-white shrink-0 mt-0.5">
                  Staging
                </span>
                <div className="flex-1">
                  <div className="text-ink">
                    <span className="font-medium">This post needs a launch date.</span>{' '}
                    <span className="text-text-mute">
                      Fill in the <span className="font-mono text-[11px]">Publish date</span> field below
                      and save — the status will move to in_progress and the post will appear on the calendar.
                    </span>
                  </div>
                  {post.source_meta?.routed_reason && (
                    <div className="mt-1 text-[11px] text-text-mute font-mono">
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
                readOnly={!canEdit}
                placeholder="Friday IG post for Sony Alpha 7C II"
                className={inputCls} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Platforms">
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map(p => {
                    const active = platform.includes(p);
                    const isLogo = p === 'IG' || p === 'FB';
                    return (
                      <button
                        key={p}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => setPlatform(active ? platform.filter(x => x !== p) : [...platform, p])}
                        title={p}
                        className={`px-1.5 py-1 rounded-md border transition flex items-center gap-1.5 ${
                          active
                            ? 'bg-btn border-btn text-white shadow-soft'
                            : 'bg-surface border-edge hover:border-edge-strong text-text-soft'
                        } ${!canEdit ? 'opacity-70 cursor-default' : ''}`}>
                        {isLogo ? (
                          <img
                            src={p === 'IG' ? '/platforms/instagram.png' : '/platforms/facebook.png'}
                            alt={p}
                            width={20}
                            height={20}
                            className="block shrink-0 rounded"
                            style={{ width: 20, height: 20 }}
                          />
                        ) : (
                          <span className={`text-[11px] font-semibold uppercase tracking-wide ${active ? 'text-white' : 'text-text-soft'}`}>
                            {PLATFORM_GLYPH[p]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Categories">
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map(c => {
                    const active = category.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => setCategory(active ? category.filter(x => x !== c) : [...category, c])}
                        title={CATEGORY_LABEL[c]}
                        className={`min-w-[32px] px-1.5 py-1 rounded-md border transition flex items-center justify-center ${
                          active
                            ? 'bg-btn border-btn text-white shadow-soft'
                            : 'bg-surface border-edge hover:border-edge-strong text-text-soft'
                        } ${!canEdit ? 'opacity-70 cursor-default' : ''}`}>
                        <span className="text-[11px] font-semibold uppercase tracking-wide">
                          {CATEGORY_GLYPH[c]}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {category.length > 0 && (
                  <div className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-text-mute font-mono">
                    {category.map(c => (CATEGORY_LABEL as Record<string, string>)[c] || c).join(' · ')}
                  </div>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Publish date" required={stagingPost}>
                  <input
                    type="date"
                    value={publishDate}
                    onChange={e => setPublishDate(e.target.value)}
                    readOnly={!canEdit}
                    disabled={!canEdit}
                    className={`${inputCls} ${stagingPost && !publishDate ? 'border-plum ring-2 ring-plum/30 bg-plum/5' : ''}`}
                  />
                </Field>
                <Field label="Quota month">
                  <input
                    type="month"
                    value={quotaMonth}
                    onChange={e => setQuotaMonth(e.target.value)}
                    readOnly={!canEdit}
                    disabled={!canEdit}
                    className={inputCls}
                  />
                  <div className="mt-1 text-[10px] font-mono text-text-faint">
                    Leave blank to count this post in the publish-date month.
                  </div>
                </Field>
              </div>
              {(targetLaunchDate || (canEdit && requestDate) || post?.target_launch_date || (canEdit && post?.request_date)) && (
                <div className={`grid gap-3 -mt-2 ${canEdit ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <Field label={
                    <span className="flex items-center gap-1.5">
                      <span className="text-[10px] text-text-mute font-mono">Target Launch</span>
                      <span className="text-[9px] text-text-faint">from email</span>
                    </span>
                  }>
                    <input type="date" value={targetLaunchDate} onChange={e => setTargetLaunchDate(e.target.value)} readOnly={!canEdit} disabled={!canEdit} className={inputCls} />
                  </Field>
                  {canEdit && (
                    <Field label={
                      <span className="flex items-center gap-1.5">
                        <span className="text-[10px] text-text-mute font-mono">Request Date</span>
                        <span className="text-[9px] text-text-faint">copy deadline</span>
                      </span>
                    }>
                      <input type="date" value={requestDate} onChange={e => setRequestDate(e.target.value)} readOnly={!canEdit} disabled={!canEdit} className={inputCls} />
                    </Field>
                  )}
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
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setStatus(s)}
                      className={`text-[11px] px-3 py-1.5 rounded-md border font-medium transition ${
                        active
                          ? 'bg-btn text-btn-text border-ink shadow-soft'
                          : 'bg-surface text-text-soft border-edge hover:border-edge-strong'
                      } ${!canEdit ? 'opacity-70 cursor-default' : ''}`}>
                      {STATUS_LABEL[s]}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {canEdit && (
                <Field label={<><Pen size={11} className="inline mr-1" />Designer</>}>
                  <NameInput
                    id="designer"
                    value={designer}
                    onChange={setDesigner}
                    suggestions={recentNames.designer}
                    placeholder="e.g. Sam Lee"
                    className={inputCls} />
                </Field>
              )}
              {canEdit && (
                <Field label={<><Type size={11} className="inline mr-1" />Copy writer</>}>
                  <NameInput
                    id="copy-writer"
                    value={copyWriter}
                    onChange={setCopyWriter}
                    suggestions={recentNames.copy_writer}
                    placeholder="e.g. Cheri Cheung"
                    className={inputCls} />
                </Field>
              )}
              <Field label={<><Briefcase size={11} className="inline mr-1" />Internal PIC</>}>
                <NameInput
                  id="internal-pic"
                  value={internalPic}
                  onChange={canEdit ? setInternalPic : () => {}}
                  suggestions={recentNames.internal_pic}
                  readOnly={!canEdit}
                  disabled={!canEdit}
                  placeholder="e.g. Sam Lee"
                  className={inputCls} />
              </Field>
              <Field label={<><Building2 size={11} className="inline mr-1" />Client PIC</>}>
                <NameInput
                  id="client-pic"
                  value={clientPic}
                  onChange={canEdit ? setClientPic : () => {}}
                  suggestions={recentNames.client_pic}
                  readOnly={!canEdit}
                  disabled={!canEdit}
                  placeholder="e.g. Sony HK"
                  className={inputCls} />
              </Field>
            </div>

            <Field label={<><FileText size={11} className="inline mr-1" />Notes</>}>
              <textarea value={notes ?? ''} onChange={e => setNotes(e.target.value)} readOnly={!canEdit} rows={3}
                placeholder="Context, talking points, links…"
                className={inputCls} />
            </Field>

            {canEdit && (
              <Field
                label={
                  <div className="flex items-center justify-between w-full">
                    <span><Sparkles size={11} className="inline mr-1" />Copy draft</span>
                    <button
                      onClick={runDraft}
                      disabled={drafting || !title}
                      className="text-[10px] uppercase tracking-[0.14em] font-mono flex items-center gap-1.5 text-accent-deep hover:text-ink disabled:text-text-faint font-semibold">
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
            )}
          </div>

          {/* EMAIL PEEK */}
          {showEmail && (
            <div className="bg-surface-muted border-l border-edge p-4 sm:p-6 space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-text-mute font-mono font-semibold mb-1.5">From email</div>
                <div className="font-display text-lg tracking-tight leading-tight font-medium text-ink">
                  {post.source_meta.subject || '(no subject)'}
                </div>
              </div>
              {post.source_meta.from && (
                <div className="text-xs text-text-soft font-mono">
                  <span className="text-text-mute">From:</span> {post.source_meta.from}
                </div>
              )}
              {post.source_meta.confidence != null && (
                <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide bg-accent text-ink px-2.5 py-1 rounded-full font-semibold">
                  AI {(post.source_meta.confidence * 100).toFixed(0)}% confident
                </div>
              )}
              {post.source_meta.parse_warnings?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-text-mute font-mono font-semibold mb-1.5">
                    ⚠ AI flagged these issues
                  </div>
                  <ul className="text-xs text-text-soft leading-relaxed space-y-1 list-disc pl-5">
                    {post.source_meta.parse_warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {normalizedMentions.mentioned_internal.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-text-mute font-mono font-semibold mb-1.5">Mentioned internal</div>
                  <div className="flex flex-wrap gap-1">
                    {normalizedMentions.mentioned_internal.map((n: string, i: number) => (
                      <span key={i} className="tag-internal text-xs px-2 py-0.5 rounded-full font-mono">{n}</span>
                    ))}
                  </div>
                </div>
              )}
              {normalizedMentions.mentioned_client.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-text-mute font-mono font-semibold mb-1.5">Mentioned client</div>
                  <div className="flex flex-wrap gap-1">
                    {normalizedMentions.mentioned_client.map((n: string, i: number) => (
                      <span key={i} className="tag-client text-xs px-2 py-0.5 rounded-full font-mono">{n}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="pt-3 border-t border-edge">
                <div className="text-[10px] uppercase tracking-[0.16em] text-text-mute font-mono font-semibold mb-2">Original body</div>
                <div className="text-xs text-text-soft leading-relaxed font-mono whitespace-pre-wrap max-h-72 overflow-y-auto">
                  {post.source_meta.body || post.notes || '(no body)'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── Footer ─── */}
        <div className="px-6 py-3.5 border-t border-edge flex items-center justify-between bg-surface-muted">
          {canEdit && post?.id ? (
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="text-magenta hover:text-ink text-[11px] uppercase tracking-[0.14em] font-mono font-semibold flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-surface transition disabled:opacity-40 disabled:cursor-not-allowed">
              {deleting ? <><Loader2 size={12} className="animate-spin" /> deleting</> : <><Trash2 size={12} /> Delete</>}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-[12px] font-medium text-text-soft hover:text-ink hover:bg-surface rounded-md transition">
              {canEdit ? 'Cancel' : 'Close'}
            </button>
            {canEdit && (
              <button
                onClick={save}
                disabled={saving || !title}
                className="px-5 py-1.5 text-[12px] font-semibold bg-btn text-btn-text rounded-md hover:bg-accent hover:text-ink transition flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-soft">
                {saving ? <><Loader2 size={12} className="animate-spin" /> saving</>
                  : savedFlash ? <><Check size={12} /> saved</>
                  : <>Save</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-transparent border-b border-edge focus:border-ink focus:outline-none px-0 py-1.5 text-sm transition placeholder:text-text-faint text-ink';

function Field({ label, children, required }: { label: React.ReactNode; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.16em] text-text-mute font-mono font-semibold mb-1.5">
        {label}
        {required && <span className="text-plum ml-1" title="Required for staging posts">*</span>}
      </div>
      {children}
    </label>
  );
}
