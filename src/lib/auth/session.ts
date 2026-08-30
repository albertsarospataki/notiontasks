/**
 * Munkamenet-sütik aláírása és ellenőrzése.
 *
 * A middleware Edge futtatókörnyezetben fut, ahol nincs `node:crypto` — ezért
 * mindent a Web Crypto API-val csinálunk, ami mindkét környezetben elérhető.
 *
 * A süti tartalma nem titkos, csak hamisíthatatlan: egy lejárati időbélyeg,
 * HMAC-SHA256 aláírással. Nincs benne jelszó és nincs benne Notion-adat.
 */

const ENCODER = new TextEncoder();

export interface SessionPayload {
  /** Lejárat, másodpercben (Unix idő). */
  exp: number;
  /** Kiállítás ideje — a süti korának naplózásához. */
  iat: number;
}

export const SESSION_COOKIE = 'cockpit_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 nap

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A visszatérési típust kifejezetten ArrayBuffer-re szűkítjük: a Web Crypto
// nem fogad SharedArrayBuffer-alapú nézetet.
function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Aláírt munkamenet-token készítése. */
export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const payload: SessionPayload = {
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const body = base64UrlEncode(ENCODER.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), ENCODER.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Token ellenőrzése. `null`, ha az aláírás hamis, a formátum rossz, vagy lejárt.
 * Az aláírás-ellenőrzés a Web Crypto `verify` hívásán keresztül megy, ami
 * konstans idejű — így a token nem próbálgatható ki bájtonként.
 */
export async function verifySessionToken(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!token) return null;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlDecode(signature),
      ENCODER.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
  } catch {
    return null;
  }

  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
  return payload;
}

/**
 * Két titok egyezésének ellenőrzése úgy, hogy a futásidő ne áruljon el semmit
 * arról, hányadik karakternél tért el. A hosszkülönbség önmagában kiderül —
 * ezért előbb mindkettőt fix hosszúságú lenyomattá alakítjuk, és azt vetjük össze.
 */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  if (a.length === 0 || b.length === 0) return false;

  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', ENCODER.encode(a)),
    crypto.subtle.digest('SHA-256', ENCODER.encode(b)),
  ]);

  const viewA = new Uint8Array(digestA);
  const viewB = new Uint8Array(digestB);

  let diff = 0;
  for (let i = 0; i < viewA.length; i++) diff |= viewA[i] ^ viewB[i];
  return diff === 0;
}
