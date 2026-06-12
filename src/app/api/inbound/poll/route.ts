// POST /api/inbound/poll — called by the self-pinger every minute.
// Connects to the Gmail IMAP mailbox, ingests new messages, returns counts.

import { NextRequest, NextResponse } from 'next/server';
import { pollGmail } from '@/lib/inbound/gmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Optional shared secret check to prevent random people from triggering polls
  const expected = process.env.POLL_SECRET;
  if (expected) {
    const got = req.headers.get('x-poll-secret') || new URL(req.url).searchParams.get('secret');
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

// Also expose GET so easy to trigger from a browser during dev
export async function GET(req: NextRequest) {
  return POST(req);
}
