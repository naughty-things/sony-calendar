'use client';

import { useEffect, useState } from 'react';

/**
 * Returns true when the viewport is below the md breakpoint (768px).
 * Uses matchMedia so it responds to device rotation and resizes,
 * not just the initial render.
 */
export function useIsMobile(breakpointPx = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpointPx]);

  return isMobile;
}
