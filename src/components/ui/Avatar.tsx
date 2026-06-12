'use client';

import { initials, Person } from '@/lib/types';

/* A small, distinctive avatar.
   - Internal people: cool steel underline
   - Client people: warm copper underline
   - Uses a hash of the name to deterministically pick a hue within the side's range
*/
export function Avatar({ person, size = 24, title }: { person?: Person | null; size?: number; title?: string }) {
  if (!person) return null;
  const hash = hashString(person.name);
  const side = person.side;
  // Map hash to one of 4 background hues within the side's family
  const hues = side === 'client'
    ? ['#F2C7A1', '#E8A878', '#D8895C', '#C86A2C']  // copper family
    : ['#C7D4E3', '#A2B5CE', '#7991B5', '#2F4B6E']; // steel family
  const bg = hues[hash % hues.length];
  const fg = side === 'client' ? '#3A1A08' : '#0E1E33';

  return (
    <span
      title={title ?? `${person.name}${person.role ? ' · ' + person.role : ''}`}
      className="inline-flex items-center justify-center font-mono font-medium select-none"
      style={{
        width: size, height: size,
        background: bg, color: fg,
        borderRadius: '50%',
        fontSize: Math.max(9, size * 0.42),
        letterSpacing: 0,
        boxShadow: 'inset 0 0 0 1px rgba(11,11,14,0.12)',
        flexShrink: 0
      }}>
      {initials(person.name)}
    </span>
  );
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
