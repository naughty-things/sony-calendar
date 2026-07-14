type RateLimitEntry = { count: number; resetAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __sonyRateLimits: Map<string, RateLimitEntry> | undefined;
}

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): { allowed: boolean; retryAfterSeconds: number } {
  const store = globalThis.__sonyRateLimits ??= new Map<string, RateLimitEntry>();
  const current = store.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;

  entry.count += 1;
  store.set(key, entry);

  if (store.size > 1_000) {
    for (const [candidate, value] of store) {
      if (value.resetAt <= now) store.delete(candidate);
    }
  }

  return {
    allowed: entry.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000))
  };
}
