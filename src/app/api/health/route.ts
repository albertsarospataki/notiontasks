import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Életjel a hoszting platform egészség-ellenőrzőjének.
 * Szándékosan nem árul el semmit a tartalomról, és nem kér hitelesítést.
 */
export function GET() {
  return NextResponse.json({ ok: true, service: 'notion-cockpit' });
}
