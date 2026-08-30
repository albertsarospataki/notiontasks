import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env } from '@/lib/env';
import { SCHEMA_SQL } from './schema';

export type DB = Database.Database;

let instance: DB | null = null;

/**
 * A folyamat egyetlen SQLite kapcsolata. Next.js dev módban a modul újratöltődhet,
 * ezért a példányt a globálison is tároljuk, hogy ne nyíljon több író kapcsolat.
 */
const globalRef = globalThis as unknown as { __notionCockpitDb?: DB };

export function db(): DB {
  if (instance) return instance;
  if (globalRef.__notionCockpitDb) {
    instance = globalRef.__notionCockpitDb;
    return instance;
  }

  const dir = resolve(env.dataDir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'cockpit.sqlite');

  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('busy_timeout = 5000');
  conn.exec(SCHEMA_SQL);
  runMigrations(conn);

  instance = conn;
  globalRef.__notionCockpitDb = conn;
  return conn;
}

/**
 * Additív migrációk: a séma bővülésekor a hiányzó oszlopokat pótoljuk, hogy egy
 * meglévő adatfájl frissítés után is használható maradjon (nem kell újraszinkron).
 */
function runMigrations(conn: DB): void {
  const columns = (table: string): Set<string> =>
    new Set(
      conn
        .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
        .all()
        .map((r) => r.name),
    );

  const ensure = (table: string, column: string, ddl: string) => {
    if (!columns(table).has(column)) {
      conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  };

  ensure('page', 'c_due_is_time', 'INTEGER NOT NULL DEFAULT 0');
  ensure('page', 'c_needs_decision', 'INTEGER NOT NULL DEFAULT 0');
  ensure('database_mapping', 'reviewed', 'INTEGER NOT NULL DEFAULT 0');
  ensure('sync_run', 'suggestions_new', 'INTEGER NOT NULL DEFAULT 0');
}

// ── Beállítás-tár ─────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = db()
    .prepare<[string], { value: string }>('SELECT value FROM setting WHERE key = ?')
    .get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db()
    .prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, new Date().toISOString());
}

export function getSettingJson<T>(key: string, fallback: T): T {
  const raw = getSetting(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setSettingJson(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value));
}
