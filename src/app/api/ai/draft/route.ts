import { NextRequest, NextResponse } from 'next/server';
import { draftCopy } from '@/lib/ai/draftCopy';
import { validateDraftRequest } from '@/lib/ai/draftRequest';
import { isAdminEmail } from '@/lib/auth/config';
import { consumeRateLimit } from '@/lib/security/rateLimit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }
  if (!isAdminEmail(data.user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const rate = consumeRateLimit(`ai:draft:${data.user.id}`, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limit exceeded' },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } }
    );
  }

  const declaredLength = Number(req.headers.get('content-length') || '0');
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'request body too large' }, { status: 413 });
  }
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'request body too large' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const input = validateDraftRequest(parsed);
  if (!input) return NextResponse.json({ error: 'invalid draft request' }, { status: 400 });

  const template = process.env.COPY_TEMPLATE ?? null; // you can drop the template into an env var
  const draft = await draftCopy({ ...input, template });
  return NextResponse.json({ draft });
}
