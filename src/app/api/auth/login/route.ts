import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken, secretsMatch } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Bejelentkezés.
 *
 * Egyfelhasználós szolgáltatás, ezért egyetlen közös jelszó véd — de a
 * próbálgatás ellen így is kell korlát: IP-nként öt hibás kísérlet után
 * tizenöt perc tiltás. A számláló a folyamat memóriájában él, ami egy
 * példánynál pontosan elég; több példánynál közös tárra lenne szükség.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;
const FAILURE_DELAY_MS = 400;

interface Attempts {
  count: number;
  firstAt: number;
}

const globalRef = globalThis as unknown as { __cockpitLoginAttempts?: Map<string, Attempts> };
const attempts = (globalRef.__cockpitLoginAttempts ??= new Map<string, Attempts>());

/**
 * A kérés forrásának azonosítója a korláthoz.
 *
 * Csak olyan fejlécben bízunk, amit a *platform* ír: az `X-Forwarded-For`
 * bármelyik elemét a kliens is elhelyezheti, tehát ha abból képeznénk kulcsot,
 * a támadó minden kéréshez új „IP-t" találna ki, és a korlát semmit nem érne.
 *
 * Ha nincs megbízható fejléc, minden kérés EGY közös vödörbe számít. Ez
 * szigorúbb — rossz proxy-beállításnál akár saját magadat is kizárhatja —, de a
 * fordítottja rosszabb lenne: egy néma, megkerülhető korlát.
 *
 * Fordított proxy mögött állítsd be az `X-Real-IP` fejlécet (nginx:
 * `proxy_set_header X-Real-IP $remote_addr;`). A Fly.io magától küldi a
 * `Fly-Client-IP`-t, ott nincs teendő.
 */
function clientKey(request: Request): string {
  const trusted = request.headers.get('fly-client-ip') ?? request.headers.get('x-real-ip');
  return trusted?.trim() || 'megbizhato-forras-nelkul';
}

function throttled(key: string, now: number): number | null {
  const entry = attempts.get(key);
  if (!entry) return null;
  if (now - entry.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return null;
  }
  if (entry.count < MAX_ATTEMPTS) return null;
  return Math.ceil((entry.firstAt + WINDOW_MS - now) / 60_000);
}

function recordFailure(key: string, now: number): void {
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

export async function POST(request: Request) {
  const password = process.env.APP_PASSWORD ?? '';
  const sessionSecret = process.env.SESSION_SECRET ?? '';

  if (!password || !sessionSecret) {
    return NextResponse.json(
      { ok: false, error: 'A szolgáltatás nincs beállítva: hiányzik az APP_PASSWORD vagy a SESSION_SECRET.' },
      { status: 503 },
    );
  }

  const now = Date.now();
  const key = clientKey(request);

  const wait = throttled(key, now);
  if (wait !== null) {
    return NextResponse.json(
      { ok: false, error: `Túl sok sikertelen próbálkozás. Próbáld újra ${wait} perc múlva.` },
      { status: 429 },
    );
  }

  let submitted = '';
  try {
    const body = (await request.json()) as { password?: string };
    submitted = body.password ?? '';
  } catch {
    return NextResponse.json({ ok: false, error: 'Hiányzó jelszó.' }, { status: 400 });
  }

  if (!(await secretsMatch(submitted, password))) {
    recordFailure(key, now);
    // Fix késleltetés minden hibás kísérletnél: a próbálgatás sebességét attól
    // függetlenül megfogja, hogy a támadó tudja-e váltogatni a forrás-azonosítót.
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return NextResponse.json({ ok: false, error: 'Hibás jelszó.' }, { status: 401 });
  }

  attempts.delete(key);

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionToken(sessionSecret, now),
    httpOnly: true,
    sameSite: 'lax',
    // A HTTPS-kényszer helyi HTTP-n kizárná a belépést, ezért csak éles módban kérjük.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
