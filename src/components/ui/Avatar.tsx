'use client';

import { initials, Person } from '@/lib/types';

/* Small avatar — Monday-style gradient background, side-aware colors.
   Adapts to dark mode automatically via the inline dark color. */
export function Avatar({ person, size = 24, title }: { person?: Person | null; size?: number; title?: string }) {
  if (!person) return null;
  const hash = hashString(person.name);
  const side = person.side;
  // Light-mode gradients
  const lightGradients = side === 'client'
    ? ['#FCE5D5, #E89B6A', '#F2C7A1, #C2733A', '#FCE5D5, #C2733A']
    : ['#DEE9F7, #4A6FA5', '#A2B5CE, #1F4A85', '#DEE9F7, #4A6FA5'];
  const lightFg = side === 'client' ? '#5A2D0E' : '#0E1E33';

  // Dark-mode variants (lighter foreground, more vibrant gradient)
  const darkGradients = side === 'client'
    ? ['#3A2A1A, #C2733A', '#2E2014, #A0592A']
    : ['#1E2E45, #4A6FA5', '#142134, #2E4A75'];
  const darkFg = side === 'client' ? '#FFD9B5' : '#A8C5EA';

  return (
    <span
      title={title ?? `${person.name}${person.role ? ' · ' + person.role : ''}`}
      className="inline-flex items-center justify-center font-mono font-semibold select-none avatar-adapt"
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, ${lightGradients[hash % lightGradients.length]})`,
        color: lightFg,
        borderRadius: '50%',
        fontSize: Math.max(9, size * 0.42),
        letterSpacing: 0,
        flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.4), 0 1px 2px rgba(15,18,28,0.06)'
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