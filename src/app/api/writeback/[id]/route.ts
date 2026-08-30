import { NextResponse } from 'next/server';
import { authorize, fail } from '@/lib/api';
import { undoWriteback } from '@/lib/notion/writeback';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorize(request))) return fail('Hiányzó vagy hibás hitelesítés.', 401);
  const { id } = await params;

  const logId = Number(id);
  if (!Number.isFinite(logId)) return fail('Érvénytelen naplóazonosító.');

  const result = await undoWriteback(logId);
  return NextResponse.json(result, { status: result.status === 'error' ? 400 : 200 });
}
