'use client';

import { PLATFORM_GLYPH } from '@/lib/types';

/* Tiny platform glyph chip.
   - IG + FB use the official logo PNG (transparent BG).
   - Other platforms (and unknown) fall back to a mono text glyph on ink.
   Used in PostChip (month) and Card (week) — sized to match the existing
   8px-font text chips so layout doesn't shift. */
export function PlatformChip({ platform, size = 16 }: { platform: string; size?: number }) {
  const logo = platform === 'IG' ? '/platforms/instagram.png'
             : platform === 'FB' ? '/platforms/facebook.png'
             : null;

  if (logo) {
    return (
      <img
        src={logo}
        alt={platform}
        title={platform}
        width={size}
        height={size}
        className="shrink-0 mt-[1px] block rounded-[2px]"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span className="font-mono text-[8px] font-bold leading-tight bg-ink/85 text-paper px-1 py-0.5 rounded-sm shrink-0 mt-[1px]">
      {PLATFORM_GLYPH[platform] || platform}
    </span>
  );
}
