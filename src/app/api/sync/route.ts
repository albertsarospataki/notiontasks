import { NextResponse } from 'next/server';
import { authorize, fail } from '@/lib/api';
import { getSyncStatus, runSync, type SyncMode } from '@/lib/sync/engine';
import { suggestionSummary } from '@/lib/insights/engine';
import { describeError } from '@/lib/notion/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const status = getSyncStatus();
  return NextResponse.json({ ...status, openSuggestions: suggestionSummary().open });
}

export async function POST(request: Request) {
  if (!(await authorize(request))) return fail('Hiányzó vagy hibás hitelesítés.', 401);

  let mode: SyncMode | undefined;
  let onlyDatabaseIds: string[] | undefined;
  try {
    const body = (await request.json()) as { mode?: string; databaseIds?: string[] };
    if (body.mode === 'full' || body.mode === 'incremental') mode = body.mode;
    if (Array.isArray(body.databaseIds)) onlyDatabaseIds = body.databaseIds;
  } catch {
    /* üres törzs is rendben — alapértelmezett mód */
  }

  try {
    const summary = await runSync({ mode, onlyDatabaseIds });
    return NextResponse.json(summary, { status: summary.status === 'error' ? 500 : 200 });
  } catch (err) {
    return fail(describeError(err), 500);
  }
}
