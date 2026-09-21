import { normalizeQuotaCount } from '@/lib/types';

export function QuotaBadge({ value }: { value?: number | null }) {
  const count = normalizeQuotaCount(value);
  const tone = count >= 3
    ? 'text-magenta bg-magenta/10 dark:bg-magenta/20'
    : count === 2
    ? 'text-accent-deep bg-accent/15 dark:bg-accent/20'
    : 'text-text-faint bg-surface/80';
  const label = `${count} quota slot${count === 1 ? '' : 's'}`;

  return (
    <span
      aria-label={label}
      title={label}
      className={`pointer-events-none absolute left-1 top-0 z-10 -translate-y-1/2 rounded-sm px-0.5 text-[8px] leading-3 font-mono font-bold ${tone}`}
    >
      {count}
    </span>
  );
}
