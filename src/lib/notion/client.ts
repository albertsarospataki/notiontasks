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
    clientInstance = new Client({
      auth: env.notionToken,
      notionVersion: '2022-06-28',
      // Az SDK alapból a konzolra ír minden sikertelen kérést. A hibákat mi
      // magunk fogalmazzuk meg és jelenítjük meg, a nyers üzenet csak zaj.
      logger: () => {},
    });
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

  const status = httpStatus(err);
  if (status !== null) {
    if (status === 429) {
      const header = (err as { headers?: Record<string, string> }).headers?.['retry-after'];
      const retryAfter = header ? Number(header) * 1000 : NaN;
      return Number.isFinite(retryAfter) ? Math.max(retryAfter, backoff) : backoff;
    }
    if (status >= 500) return backoff;
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
  return httpStatus(err) === 404 || (err as { code?: string } | null)?.code === 'object_not_found';
}

/**
 * A HTTP státusz kiolvasása a hibából.
 *
 * Szándékosan nem `instanceof`-fal: ha az `@notionhq/client` egynél több
 * példányban kerül a folyamatba (más-más függőségi ágon), az osztály nem
 * ugyanaz, az `instanceof` hamis lesz, és a felhasználó a nyers SDK-üzenetet
 * kapná a barátságos helyett. A `status` mező viszont mindig ott van.
 */
function httpStatus(err: unknown): number | null {
  if (err instanceof APIResponseError) return err.status;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

/** Emberi hibaüzenet a UI-ra. */
export function describeError(err: unknown): string {
  if (err instanceof NotionNotConfiguredError) return err.message;

  const status = httpStatus(err);
  if (status !== null) {
    if (status === 401 || status === 403) {
      return 'A Notion elutasította a tokent (érvénytelen, visszavonták, vagy nincs jogosultsága). '
        + 'Ellenőrizd a NOTION_TOKEN értékét az integráció beállításainál.';
    }
    if (status === 404) return 'A Notion objektum nem található, vagy nincs megosztva az integrációval (404).';
    if (status === 429) return 'A Notion átmenetileg korlátozza a kéréseket (429). Próbáld később.';
    const message = err instanceof Error ? err.message : String(err);
    return `Notion API hiba (${status}): ${message}`;
  }

  return err instanceof Error ? err.message : String(err);
}
