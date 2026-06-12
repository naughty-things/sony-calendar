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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.POLL_SECRET;
  if (expected) {
    const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      || new URL(req.url).searchParams.get('secret')
      || req.headers.get('x-poll-secret');
    if (got !== expected) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
    const result = await pollGmail();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
