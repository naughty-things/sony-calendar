// Self-pinger: calls our own /api/inbound/poll every 60s on the server.
// Started lazily on first import. Singleton — never runs more than once.

import { pollGmail } from './gmail';

const INTERVAL_MS = 60_000;
let started = false;
let timer: NodeJS.Timeout | null = null;

export function startSelfPing() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const r = await pollGmail();
      if (r.scanned > 0 || r.ingested > 0) {
        // eslint-disable-next-line no-console
        console.log('[inbound] poll:', r);
      }
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[inbound] poll error:', e.message);
    }
  };

  // Run once after a short delay so we don't block server boot
  setTimeout(tick, 5_000);
  timer = setInterval(tick, INTERVAL_MS);
  // Don't keep the process alive just for this
  if (timer.unref) timer.unref();
}

// Auto-start in Node (Railway / self-hosted). In Vercel/Edge, this file is
// never imported on the server, so the cron endpoint is used instead.
if (typeof process !== 'undefined' && process.env.NEXT_RUNTIME !== 'edge') {
  // Defer to next tick to avoid running during build
  setTimeout(() => {
    if (process.env.DISABLE_SELF_PING !== '1') {
      startSelfPing();
    }
  }, 0);
}
