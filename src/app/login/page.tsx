'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn, Loader2, User, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { usernameToEmail } from '@/lib/auth/config';
import { safeReturnPath } from '@/lib/auth/redirect';

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginShell() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center text-text-faint font-mono text-sm">Loading…</div>
    </div>
  );
}

function LoginInner() {
  const { ready, user, signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = safeReturnPath(params.get('next'));

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(nextPath);
  }, [ready, user, nextPath, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const email = usernameToEmail(username);
    if (!email) {
      setError('Unknown username.');
      return;
    }
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    router.replace(nextPath);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <div className="text-center mb-8">
          <div className="font-display text-[40px] font-medium tracking-tight leading-none text-ink">
            SONY<span className="text-accent">.</span>
          </div>
          <div className="font-display italic text-lg text-text-mute mt-2">
            Content Calendar
          </div>
        </div>

        {/* Card */}
        <form
          onSubmit={onSubmit}
          className="bg-surface border border-edge rounded-xl shadow-card p-7 space-y-5">
          <div>
            <h1 className="font-display text-[26px] tracking-tight font-medium text-ink">Sign in</h1>
            <p className="text-sm text-text-mute mt-1">
              For the Naughty Things team only.
            </p>
          </div>

          <Field label="Username">
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
              <input
                type="text"
                autoComplete="username"
                required
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-surface border border-edge rounded-md focus:border-edge-strong focus:outline-none placeholder:text-text-faint transition text-ink" />
            </div>
          </Field>

          <Field label="Password">
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
              <input
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full pl-9 pr-10 py-2.5 text-sm bg-surface border border-edge rounded-md focus:border-edge-strong focus:outline-none placeholder:text-text-faint transition text-ink" />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-faint hover:text-ink rounded">
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          {error && (
            <div className="text-sm text-magenta bg-[#FCE0EA] border border-[#F5B5C9] dark:bg-[#3D212E] dark:border-[#7A2A3D] rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !username || !password}
            className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 bg-btn text-btn-text rounded-md hover:bg-accent hover:text-ink transition disabled:opacity-50 disabled:cursor-not-allowed shadow-soft">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint font-mono text-center pt-1">
            Public read-only · staff can edit
          </p>
        </form>

        <p className="text-xs text-text-faint text-center mt-5">
          Just want to view the calendar? <a href="/" className="text-text-soft hover:text-ink underline">Browse without signing in</a>.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.16em] text-text-mute font-mono font-semibold mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
