'use client';

import { useEffect, useState } from 'react';
import { Mail, X } from 'lucide-react';

/* A simple toast — top-right, slides in.
   Used for "new email arrived" notifications. */
export type ToastItem = {
  id: string;
  title: string;
  detail?: string;
  kind?: 'info' | 'success' | 'warning';
  ttlMs?: number;
};

export function Toast({ items, onDismiss }: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map(t => <ToastCard key={t.id} item={t} onDismiss={onDismiss} />)}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const ttl = item.ttlMs ?? 5500;
    const t = setTimeout(() => onDismiss(item.id), ttl);
    return () => clearTimeout(t);
  }, [item.id, item.ttlMs, onDismiss]);
  return (
    <div className="pointer-events-auto sheet flex items-start gap-3 bg-ink text-paper rounded-md px-3.5 py-3 shadow-2xl max-w-sm">
      <div className="mt-0.5 w-7 h-7 rounded-full bg-accent text-ink flex items-center justify-center shrink-0">
        <Mail size={13} strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{item.title}</div>
        {item.detail && <div className="text-xs text-paper/70 mt-0.5 line-clamp-2">{item.detail}</div>}
      </div>
      <button onClick={() => onDismiss(item.id)} className="text-paper/40 hover:text-paper">
        <X size={14} />
      </button>
    </div>
  );
}
