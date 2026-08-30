import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

/** Egységes hibaválasz. */
export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Írási végpontok védelme. Ha `SYNC_SECRET` be van állítva, akkor kötelező a
 * `Authorization: Bearer <secret>` fejléc — így külső cron biztonságosan
 * hívhatja a szinkront akkor is, ha a szolgáltatás publikusan elérhető.
 * Ha nincs beállítva, a védelem kikapcsolt (helyi, egyfelhasználós futtatás).
 */
export function authorize(request: Request): boolean {
  const secret = env.syncSecret;
  if (!secret) return true;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}
