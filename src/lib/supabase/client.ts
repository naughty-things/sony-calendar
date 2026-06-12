'use client';
import { createBrowserClient } from '@supabase/ssr';

let _c: ReturnType<typeof createBrowserClient> | null = null;
export function getBrowserClient() {
  if (!_c) {
    _c = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _c;
}
