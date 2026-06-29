'use client';

import { useEffect } from 'react';
import { Mail, X, CheckCircle2, AlertTriangle } from 'lucide-react';

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

  const isSuccess = item.kind === 'success';
  const isWarning = item.kind === 'warning';
  const Icon = isSuccess ? CheckCircle2 : isWarning ? AlertTriangle : Mail;

  return (
    <div className="pointer-events-auto sheet flex items-start gap-3 bg-surface border border-edge rounded-lg px-3.5 py-3 shadow-pop max-w-sm">
      <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
        isSuccess ? 'bg-[#D9F0E0] text-[#1F5C36]'
        : isWarning ? 'bg-[#FCE0EA] text-[#8E1F4A]'
        : 'bg-accent text-ink'
      }`}>
        <Icon size={13} strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink">{item.title}</div>
        {item.detail && <div className="text-xs text-text-mute mt-0.5 line-clamp-2">{item.detail}</div>}
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
        className="text-text-faint hover:text-ink p-1 rounded">
        <X size={14} />
      </button>
    </div>
  );
}