// POST /api/inbound/poll — called by the self-pinger every minute.
// Polls the Gmail API mailbox, ingests new messages, returns counts.

import { NextRequest, NextResponse } from 'next/server';
import { pollGmail } from '@/lib/inbound/gmail';
import { authorizePollRequest } from '@/lib/security/pollAuth';
import { consumeRateLimit } from '@/lib/security/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authorization = authorizePollRequest(req);
  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, error: authorization.error },
      { status: authorization.status }
    );
  }
  const rate = consumeRateLimit('poll:inbound', 5, 60_000);
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
