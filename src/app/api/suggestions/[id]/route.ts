import { NextResponse } from 'next/server';
import { authorize, fail } from '@/lib/api';
import { applySuggestion, dismissSuggestion, getSuggestion, reopenSuggestion } from '@/lib/insights/engine';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const suggestion = getSuggestion(id);
  if (!suggestion) return fail('Nincs ilyen javaslat.', 404);
  return NextResponse.json(suggestion);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorize(request))) return fail('Hiányzó vagy hibás hitelesítés.', 401);
  const { id } = await params;

  let action = '';
  let reason: string | undefined;
  try {
    const body = (await request.json()) as { action?: string; reason?: string };
    action = body.action ?? '';
    reason = body.reason;
  } catch {
    return fail('Hiányzó kérés-törzs.');
  }

  switch (action) {
    case 'apply': {
      const result = await applySuggestion(id);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    case 'dismiss': {
      const result = dismissSuggestion(id, reason);
      return NextResponse.json(result, { status: result.ok ? 200 : 404 });
    }
    case 'reopen': {
      const result = reopenSuggestion(id);
      return NextResponse.json(result, { status: result.ok ? 200 : 404 });
    }
    default:
      return fail('Ismeretlen művelet. Használható: apply, dismiss, reopen.');
  }
}
