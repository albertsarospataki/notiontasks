import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, secretsMatch, verifySessionToken } from '@/lib/auth/session';

/**
 * Hozzáférés-védelem.
 *
 * A cockpit a teljes Notion-workspace tartalmát mutatja, ezért *zárva* alapértelmezett:
 * ha nincs beállítva jelszó, a szolgáltatás nem enged be senkit, hanem kiírja, mit
 * kell beállítani. Ez szándékos — egy elfelejtett környezeti változó nem eredményezhet
 * nyilvánosan olvasható Notiont.
 *
 * Két belépési mód van:
 *  - böngészőből: aláírt munkamenet-süti (a /login állítja be),
 *  - gépi hívásból: `Authorization: Bearer <SYNC_SECRET>` — ezt használja a külső cron.
 */

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/health'];

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)'],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const password = process.env.APP_PASSWORD ?? '';
  const sessionSecret = process.env.SESSION_SECRET ?? '';
  const authDisabled = process.env.AUTH_DISABLED === 'true';

  // Helyi fejlesztéshez kifejezetten kikapcsolható. Éles üzemben soha ne legyen bekapcsolva.
  if (authDisabled) return NextResponse.next();

  // Zárva alapértelmezett: hiányos konfiguráció esetén nem engedünk be, és nem is
  // hallgatunk róla — a hibaüzenet megmondja, mi hiányzik.
  if (!password || !sessionSecret) {
    const missing = [!password ? 'APP_PASSWORD' : null, !sessionSecret ? 'SESSION_SECRET' : null]
      .filter(Boolean)
      .join(' és ');
    return new NextResponse(
      `A cockpit le van zárva, mert hiányzik a hozzáférés-védelem beállítása: ${missing}.\n\n` +
        'Éles üzemben állítsd be mindkettőt. Helyi fejlesztéshez az AUTH_DISABLED=true is használható.\n',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  // Gépi hívás: a szinkron-titokkal hitelesített kérés süti nélkül is átmegy.
  const syncSecret = process.env.SYNC_SECRET ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  if (syncSecret && authorization.startsWith('Bearer ')) {
    // Konstans idejű összevetés: a sima === az első eltérő bájtnál kilép, és a
    // futásidőből bájtonként kitalálható lenne a titok.
    if (await secretsMatch(authorization.slice('Bearer '.length), syncSecret)) {
      return NextResponse.next();
    }
  }

  const session = await verifySessionToken(sessionSecret, request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  // Az API böngésző-átirányítás helyett tiszta hibát ad, hogy a hívó fél lássa, mi történt.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Bejelentkezés szükséges.' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  const target = `${pathname}${request.nextUrl.search}`;
  if (target !== '/') loginUrl.searchParams.set('next', target);
  return NextResponse.redirect(loginUrl);
}
