'use client';

import { useState } from 'react';
import { Person, Post, PostStatus, PostWithPeople, STATUS_LABEL } from '@/lib/types';
import { getBrowserClient } from '@/lib/supabase/client';
import { X, Trash2, Sparkles, Mail } from 'lucide-react';

const ALL_STATUSES: PostStatus[] = [
  'draft','in_progress','needs_review','client_review','approved','scheduled','posted','blocked','archived'
];

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
    await onSaved();
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

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wide">{post ? 'Edit post' : 'New post'}</div>
            <h2 className="text-lg font-semibold">{post?.title || 'Untitled'}</h2>
          </div>
          <div className="flex items-center gap-2">
            {post?.source === 'email' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 flex items-center gap-1">
                <Mail size={10} /> From email
              </span>
            )}
            <button onClick={onClose} className="p-1.5 rounded hover:bg-neutral-100"><X size={18} /></button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <Field label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
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
              {ALL_STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`text-xs px-2.5 py-1 rounded border ${status === s ? 'bg-black text-amber-400 border-black' : 'bg-white border-neutral-300 hover:border-neutral-500'}`}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Internal assignee">
              <PersonSelect value={assigneeId} onChange={setAssigneeId} options={internal} placeholder="— unassigned —" />
            </Field>
            <Field label="Internal PIC">
              <PersonSelect value={internalPicId} onChange={setInternalPicId} options={internal} placeholder="— none —" />
            </Field>
            <Field label="Client-side PIC">
              <PersonSelect value={clientPicId} onChange={setClientPicId} options={clients} placeholder="— none —" />
            </Field>
          </div>

          <Field label="Notes">
            <textarea value={notes ?? ''} onChange={e => setNotes(e.target.value)} rows={3} className={inputCls} />
          </Field>

          <Field
            label={
              <div className="flex items-center justify-between">
                <span>Copy draft</span>
                <button
                  onClick={runDraft}
                  disabled={drafting || !title}
                  className="text-xs flex items-center gap-1 text-amber-700 hover:text-amber-900 disabled:text-neutral-400">
                  <Sparkles size={12} /> {drafting ? 'Drafting…' : 'AI draft'}
                </button>
              </div>
            }>
            <textarea value={copyDraft ?? ''} onChange={e => setCopyDraft(e.target.value)} rows={5} className={inputCls} placeholder="AI-drafted or hand-written copy…" />
          </Field>

          {post?.source_meta?.from && (
            <details className="text-xs text-neutral-500 bg-neutral-50 rounded p-2">
              <summary className="cursor-pointer">Email source</summary>
              <div className="mt-1">From: {post.source_meta.from}</div>
              <div>Subject: {post.source_meta.subject}</div>
              {post.source_meta.confidence != null && (
                <div>AI confidence: {(post.source_meta.confidence * 100).toFixed(0)}%</div>
              )}
            </details>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-neutral-200 px-6 py-3 flex items-center justify-between">
          {post?.id ? (
            <button onClick={remove} className="text-red-600 hover:text-red-800 text-sm flex items-center gap-1">
              <Trash2 size={14} /> Delete
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-neutral-300 hover:bg-neutral-50">Cancel</button>
            <button onClick={save} disabled={saving || !title} className="px-4 py-1.5 text-sm rounded bg-black text-amber-400 font-medium hover:bg-neutral-800 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded border border-neutral-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent';

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-neutral-600 mb-1">{label}</div>
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
