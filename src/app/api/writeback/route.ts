import { NextResponse } from 'next/server';
import { listWritebackLog } from '@/lib/notion/writeback';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 100);
  return NextResponse.json({ entries: listWritebackLog(Number.isFinite(limit) ? limit : 100) });
}
