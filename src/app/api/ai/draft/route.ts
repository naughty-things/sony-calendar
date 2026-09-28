import { NextRequest, NextResponse } from 'next/server';
import { draftCopy, type DraftEmail } from '@/lib/ai/draftCopy';
import { validateDraftRequest } from '@/lib/ai/draftRequest';
import { isAdminEmail } from '@/lib/auth/config';
import { consumeRateLimit } from '@/lib/security/rateLimit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 24 * 1024;

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

  let email: DraftEmail | null = null;
  const sourceWarnings: string[] = [];
  if (input.postId) {
    // Use the signed-in client and its existing RLS policies, never service-role access.
    const { data: post, error } = await supabase.from('posts')
      .select('source, source_meta').eq('id', input.postId).maybeSingle();
    if (error) return NextResponse.json({ error: 'Could not load the source post. Please retry.' }, { status: 503 });
    if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 });
    const meta = post.source_meta && typeof post.source_meta === 'object' ? post.source_meta : {};
    if (post.source === 'email') {
      try {
        if (typeof meta.gmail_id === 'string') {
          const { readLinkedEmail } = await import('@/lib/inbound/gmail');
          email = await readLinkedEmail(meta.gmail_id);
        } else if (typeof meta.body === 'string' && meta.body.trim()) {
          email = { subject: typeof meta.subject === 'string' ? meta.subject : '', body: meta.body };
        }
        if (email) {
          if (email.body.length > 60000) sourceWarnings.push('來源電郵過長，只使用首 60,000 字元；請核對有否遺漏本帖文資料。');
          email = { ...email, body: email.body.slice(0, 60000),
            rowIndex: Number.isInteger(meta.row_index) ? meta.row_index : undefined,
            totalRows: Number.isInteger(meta.total_rows) ? meta.total_rows : undefined };
        }
      } catch {
        sourceWarnings.push('未能讀取來源電郵。今次草稿只根據標題及備註撰寫，請補充或核對原始資料。');
      }
      if (!email?.body && sourceWarnings.length === 0) sourceWarnings.push('此帖文沒有可讀取的來源電郵內容，草稿只根據標題及備註撰寫。');
    }
  }
  if (!process.env.MINIMAX_API_KEY) {
    return NextResponse.json({ error: 'AI drafting is not configured. Set MINIMAX_API_KEY on the server.' }, { status: 503 });
  }
  try {
    const result = await draftCopy({ ...input, email, sourceWarnings, template: process.env.COPY_TEMPLATE ?? null });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Do not leak provider responses, email contents or credentials to the browser/logs.
    return NextResponse.json({ error: 'AI could not finish a usable draft. Please retry; your existing copy has not changed.' }, { status: 502 });
  }
}
