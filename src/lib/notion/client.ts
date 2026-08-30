import { Client, APIResponseError } from '@notionhq/client';
import { env } from '@/lib/env';

/**
 * Notion-kliens sorosított, ütemezett hívásokkal.
 *
 * A Notion átlagosan ~3 kérés/másodpercet enged integrációnként. Ha ezt átlépjük,
 * 429-et kapunk, és egy hosszú szinkron félúton elhasal. Ezért minden hívás
 * egyetlen soron megy át, két hívás között minimum `MIN_INTERVAL_MS` telik el,
 * és a 429 / 5xx válaszokat exponenciálisan növekvő várakozással újrapróbáljuk.
 */

const MIN_INTERVAL_MS = 340;
const MAX_RETRIES = 5;

let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

let clientInstance: Client | null = null;

export function notion(): Client {
  if (!env.notionToken) {
    throw new NotionNotConfiguredError();
  }
  if (!clientInstance) {
    clientInstance = new Client({ auth: env.notionToken, notionVersion: '2022-06-28' });
  }
  return clientInstance;
}

export class NotionNotConfiguredError extends Error {
  constructor() {
    super('Hiányzik a NOTION_TOKEN. Állítsd be a .env fájlban.');
    this.name = 'NotionNotConfiguredError';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Minden Notion-hívást ezen keresztül indíts. */
export function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const since = Date.now() - lastCallAt;
    if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);

    let attempt = 0;
    for (;;) {
      try {
        lastCallAt = Date.now();
        return await fn();
      } catch (err) {
        attempt += 1;
        const wait = retryDelayMs(err, attempt);
        if (wait === null || attempt > MAX_RETRIES) throw err;
        await sleep(wait);
      }
    }
  };

  // A láncot akkor is folytatjuk, ha az előző hívás hibázott.
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

/** `null`, ha a hiba nem újrapróbálható. */
function retryDelayMs(err: unknown, attempt: number): number | null {
  const backoff = Math.min(500 * 2 ** (attempt - 1), 15_000);

  if (err instanceof APIResponseError) {
    if (err.status === 429) {
      const header = (err.headers as Record<string, string> | undefined)?.['retry-after'];
      const retryAfter = header ? Number(header) * 1000 : NaN;
      return Number.isFinite(retryAfter) ? Math.max(retryAfter, backoff) : backoff;
    }
    if (err.status >= 500) return backoff;
    return null; // 4xx: jogosultság, nem létező objektum, hibás kérés — nincs értelme újrapróbálni
  }

  // Hálózati hiba (ECONNRESET, fetch failed, timeout) — érdemes újrapróbálni.
  const code = (err as { code?: string } | null)?.code;
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(code)) {
    return backoff;
  }
  if (err instanceof Error && /fetch failed|network|socket/i.test(err.message)) return backoff;
  return null;
}

/** Igaz, ha az objektum nem érhető el az integráció számára (nincs megosztva / törölt). */
export function isNotFound(err: unknown): boolean {
  return err instanceof APIResponseError && (err.status === 404 || err.code === 'object_not_found');
}

/** Emberi hibaüzenet a UI-ra. */
export function describeError(err: unknown): string {
  if (err instanceof NotionNotConfiguredError) return err.message;
  if (err instanceof APIResponseError) {
    if (err.status === 401) return 'A Notion token érvénytelen vagy visszavonták (401).';
    if (err.status === 403) return 'Az integrációnak nincs jogosultsága ehhez a tartalomhoz (403).';
    if (err.status === 404) return 'A Notion objektum nem található vagy nincs megosztva az integrációval (404).';
    if (err.status === 429) return 'A Notion átmenetileg korlátozza a kéréseket (429). Próbáld később.';
    return `Notion API hiba (${err.status}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
