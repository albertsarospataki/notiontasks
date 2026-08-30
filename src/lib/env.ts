/**
 * Környezeti konfiguráció egyetlen helyen. Minden más modul innen olvas,
 * hogy a `process.env` szétszórt használata ne okozzon néma hibát.
 */

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'igen'].includes(v.toLowerCase());
}

function list(name: string): string[] {
  return str(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  get notionToken(): string {
    return str('NOTION_TOKEN');
  },
  get ownerEmails(): string[] {
    return list('OWNER_EMAIL').map((e) => e.toLowerCase());
  },
  get ownerNames(): string[] {
    return list('OWNER_NAMES');
  },
  get dataDir(): string {
    return str('DATA_DIR', './data');
  },
  get syncIntervalMinutes(): number {
    return num('SYNC_INTERVAL_MINUTES', 10);
  },
  get fullSyncIntervalHours(): number {
    return num('FULL_SYNC_INTERVAL_HOURS', 24);
  },
  get syncSecret(): string {
    return str('SYNC_SECRET');
  },
  get writebackDryRun(): boolean {
    return bool('WRITEBACK_DRY_RUN', false);
  },
  get timezone(): string {
    return str('TZ', 'Europe/Budapest');
  },
};

/** Igaz, ha a Notion-integráció be van állítva. A UI ez alapján mutat setup-képernyőt. */
export function isConfigured(): boolean {
  return env.notionToken.length > 0;
}
