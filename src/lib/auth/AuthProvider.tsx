'use client';

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { getBrowserClient } from '@/lib/supabase/client';

type AuthState = {
  /** Hydrated — we've checked the session at least once. */
  ready: boolean;
  /** Currently signed-in user (null = signed out). */
  user: User | null;
  /** Sign in with email + password. Resolves to { user, error }. */
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  /** Sign out the current user. */
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = getBrowserClient();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // Load initial session + subscribe to changes
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }: { data: { session: any } }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: any) => {
      setUser(session?.user ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const signIn = useCallback<AuthState['signIn']>(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, [supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, [supabase]);

  const value = useMemo<AuthState>(() => ({ ready, user, signIn, signOut }), [ready, user, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Returns the current session access token (JWT), for authenticated reads/writes. */
export function useAccessToken(): string | null {
  const { user } = useAuth();
  // supabase-js attaches the token to each request automatically; we expose
  // this for debugging only.
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (!user) { setToken(null); return; }
    getBrowserClient().auth.getSession().then(({ data }: { data: { session: any } }) => setToken(data.session?.access_token ?? null));
  }, [user]);
  return token;
}
