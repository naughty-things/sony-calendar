// GET /api/cron/poll — Vercel Cron style endpoint.
// If you deploy on Vercel, add this to vercel.json:
//   { "crons": [{ "path": "/api/cron/poll", "schedule": "* * * * *" }] }
//
// On Railway, we use the self-pinging pattern: a tiny background loop inside
// the app (started on first request) hits /api/inbound/poll every 60s.
// For Railway, you can also just use an external cron service hitting
// /api/inbound/poll with the secret header.

import { NextRequest, NextResponse } from 'next/server';
import { pollGmail } from '@/lib/inbound/gmail';
import { authorizePollRequest } from '@/lib/security/pollAuth';
import { consumeRateLimit } from '@/lib/security/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authorization = authorizePollRequest(req);
  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, error: authorization.error },
      { status: authorization.status }
    );
  }
  const rate = consumeRateLimit('poll:cron', 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate limit exceeded' },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } }
    );
  }
  try {
    const result = await pollGmail();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
