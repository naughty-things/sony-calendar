import { NextRequest, NextResponse } from 'next/server';
import { draftCopy } from '@/lib/ai/draftCopy';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { title, platform, notes } = await req.json();
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const template = process.env.COPY_TEMPLATE ?? null; // you can drop the template into an env var
  const draft = await draftCopy({ title, platform, notes, template });
  return NextResponse.json({ draft });
}
