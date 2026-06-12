'use client';

import { useState, useEffect, useRef } from 'react';
import { Person, Post, PostStatus, PostWithPeople, STATUS_LABEL, STATUS_ORDER } from '@/lib/types';
import { getBrowserClient } from '@/lib/supabase/client';
import { X, Trash2, Sparkles, Mail, User, Briefcase, Building2, FileText, Check, Loader2 } from 'lucide-react';
import { Tape } from './ui/Tape';
import { Avatar } from './ui/Avatar';

const ALL_STATUSES: PostStatus[] = STATUS_ORDER;

export function PostModal({
  post, initialDate, people, onClose, onSaved
}: {
  post: PostWithPeople | null;
  initialDate?: string;
  people: Person[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const supabase = getBrowserClient();
  const [title, setTitle] = useState(post?.title ?? '');
  const [platform, setPlatform] = useState(post?.platform ?? 'IG');
  const [publishDate, setPublishDate] = useState(post?.publish_date ?? initialDate ?? new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<PostStatus>(post?.status ?? 'draft');
  const [assigneeId, setAssigneeId] = useState<string>(post?.internal_assignee_id ?? '');
  const [internalPicId, setInternalPicId] = useState<string>(post?.internal_pic_id ?? '');
  const [clientPicId, setClientPicId] = useState<string>(post?.client_pic_id ?? '');
  const [notes, setNotes] = useState(post?.notes ?? '');
  const [copyDraft, setCopyDraft] = useState(post?.copy_draft ?? '');
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => firstFieldRef.current?.focus(), 100);
  }, []);

  const internal = people.filter(p => p.side === 'internal');
  const clients = people.filter(p => p.side === 'client');

  async function save() {
    setSaving(true);
    const payload: Partial<Post> = {
      title, platform, publish_date: publishDate, status,
      internal_assignee_id: assigneeId || null,
      internal_pic_id: internalPicId || null,
      client_pic_id: clientPicId || null,
      notes, copy_draft: copyDraft
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
  const assignee = people.find(p => p.id === assigneeId);
  const iPic = people.find(p => p.id === internalPicId);
  const cPic = people.find(p => p.id === clientPicId);

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="sheet bg-paper text-ink w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded-sm border border-rule shadow-2xl">
        {/* ─── Header ─── */}
        <div className="px-7 py-4 rule-b border-rule-soft flex items-start justify-between gap-4">
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
          <div className="p-7 space-y-5">
            <Field label="Title">
              <input
                ref={firstFieldRef}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Friday IG post for Sony Alpha 7C II"
                className={inputCls} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Platform">
                <select value={platform ?? ''} onChange={e => setPlatform(e.target.value)} className={inputCls}>
                  {['IG','FB','X','LinkedIn','TikTok','YouTube','Blog','Email','Other'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Publish date">
                <input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} className={inputCls} />
              </Field>
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label={<><User size={11} className="inline mr-1" />Internal assignee</>}>
                <PersonSelect value={assigneeId} onChange={setAssigneeId} options={internal} placeholder="— unassigned —" />
                {assignee && <Chip person={assignee} />}
              </Field>
              <Field label={<><Briefcase size={11} className="inline mr-1" />Internal PIC</>}>
                <PersonSelect value={internalPicId} onChange={setInternalPicId} options={internal} placeholder="— none —" />
                {iPic && <Chip person={iPic} />}
              </Field>
              <Field label={<><Building2 size={11} className="inline mr-1" />Client PIC</>}>
                <PersonSelect value={clientPicId} onChange={setClientPicId} options={clients} placeholder="— none —" />
                {cPic && <Chip person={cPic} />}
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
            <div className="bg-paper-deep border-l border-rule-soft p-7 space-y-4">
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

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.16em] text-ink-mute font-mono font-semibold mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function PersonSelect({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: Person[]; placeholder: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.name}{o.role ? ` · ${o.role}` : ''}</option>)}
    </select>
  );
}

function Chip({ person }: { person: Person }) {
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-soft">
      <Avatar person={person} size={16} />
      <span>{person.role}</span>
    </div>
  );
}
