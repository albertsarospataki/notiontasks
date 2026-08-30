import { NextResponse } from 'next/server';
import { authorize, fail } from '@/lib/api';
import { generateSuggestions, listSuggestions, suggestionSummary } from '@/lib/insights/engine';
import type { SuggestionRecord } from '@/lib/insights/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = (url.searchParams.get('status')?.split(',') ?? ['open']) as SuggestionRecord['status'][];
  const rules = url.searchParams.get('rule')?.split(',').filter(Boolean);
  return NextResponse.json({
    summary: suggestionSummary(),
    suggestions: listSuggestions({ status, rules }),
  });
}

/** Újraszámolás szinkron nélkül — hasznos szabály-hangolás közben. */
export async function POST(request: Request) {
  if (!authorize(request)) return fail('Hiányzó vagy hibás hitelesítés.', 401);
  const result = generateSuggestions();
  return NextResponse.json({ ok: true, ...result });
}
