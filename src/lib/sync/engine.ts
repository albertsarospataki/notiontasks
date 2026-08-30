import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { fetchAllDatabases, upsertDatabases } from '@/lib/notion/discovery';
import { describeError, isNotFound, notion, schedule } from '@/lib/notion/client';
import { listMappedDatabases, refreshMappings, syncableDatabases, type MappedDatabase } from '@/lib/mapping/store';
import { fold } from '@/lib/util/text';
import { normalizePage, type NormalizedRelation, type RawPage } from './normalize';

/**
 * A szinkron-motor.
 *
 * `incremental` módban adatbázisonként csak a legutóbbi szinkron óta módosult
 * oldalakat kérdezzük le (`last_edited_time` szűrő) — ez néhány másodperc.
 * `full` módban mindent újraolvasunk, és a helyi tükörből kitakarítjuk azokat az
 * oldalakat, amelyeket a Notion már nem ad vissza (törölt / kukába tett sorok).
 * Ezért kell időnként teljes kör is: a törléseket csak így vesszük észre.
 */

export type SyncMode = 'full' | 'incremental';

export interface SyncSummary {
  runId: number;
  mode: SyncMode;
  status: 'ok' | 'error';
  startedAt: string;
  finishedAt: string;
  databasesSeen: number;
  databasesNew: number;
  pagesUpserted: number;
  pagesRemoved: number;
  suggestionsNew: number;
  errors: string[];
  log: string[];
}

export interface SyncOptions {
  mode?: SyncMode;
  /** Csak ezeket az adatbázisokat szinkronizálja (azonosítók). */
  onlyDatabaseIds?: string[];
  /** Javaslatok újraszámolása a szinkron végén. */
  generateSuggestions?: boolean;
}

let running: Promise<SyncSummary> | null = null;

/** Egyszerre csak egy szinkron fusson — párhuzamos futás írási ütközést okozna. */
export function isSyncRunning(): boolean {
  return running !== null;
}

export async function runSync(options: SyncOptions = {}): Promise<SyncSummary> {
  if (running) return running;
  running = doSync(options).finally(() => {
    running = null;
  });
  return running;
}

async function doSync(options: SyncOptions): Promise<SyncSummary> {
  const conn = db();
  const startedAt = new Date().toISOString();
  const log: string[] = [];
  const errors: string[] = [];

  const mode: SyncMode = options.mode ?? (shouldRunFullSync() ? 'full' : 'incremental');

  const runId = Number(
    conn
      .prepare('INSERT INTO sync_run (mode, status, started_at) VALUES (?, ?, ?)')
      .run(mode, 'running', startedAt).lastInsertRowid,
  );

  let databasesSeen = 0;
  let databasesNew = 0;
  let pagesUpserted = 0;
  let pagesRemoved = 0;
  let suggestionsNew = 0;

  try {
    // 1. Felfedezés — minden körben, hogy az új adatbázisok maguktól bekerüljenek.
    const discovered = await fetchAllDatabases();
    const upserted = upsertDatabases(discovered);
    databasesSeen = upserted.seen;
    databasesNew = upserted.created.length;
    log.push(`Felfedezés: ${upserted.seen} adatbázis (${upserted.created.length} új, ${upserted.changed.length} módosult séma, ${upserted.removed.length} eltűnt).`);

    // 2. Szerep- és mezőleképezés frissítése.
    const mappingChanges = refreshMappings();
    if (mappingChanges.created.length) log.push(`Új leképezés: ${mappingChanges.created.length} adatbázis.`);
    if (mappingChanges.updated.length) log.push(`Szerep változott: ${mappingChanges.updated.length} adatbázis.`);

    // 3. Oldalak szinkronizálása.
    let targets = syncableDatabases();
    if (options.onlyDatabaseIds?.length) {
      const wanted = new Set(options.onlyDatabaseIds);
      targets = targets.filter((t) => wanted.has(t.id));
    }

    for (const target of targets) {
      try {
        const result = await syncDatabase(target, mode);
        pagesUpserted += result.upserted;
        pagesRemoved += result.removed;
        if (result.upserted || result.removed) {
          log.push(`${target.title}: ${result.upserted} frissítve, ${result.removed} eltávolítva.`);
        }
      } catch (err) {
        const msg = `${target.title}: ${describeError(err)}`;
        errors.push(msg);
        conn
          .prepare(
            `INSERT INTO sync_state (database_id, last_error) VALUES (?, ?)
             ON CONFLICT(database_id) DO UPDATE SET last_error = excluded.last_error`,
          )
          .run(target.id, describeError(err));
      }
    }

    // 4. Relation-alapú „saját feladat" jelölés feloldása.
    const ownerCount = resolveOwnerFlags();
    if (ownerCount) log.push(`${ownerCount} saját feladat azonosítva a felelős-kapcsolat alapján.`);

    // 5. Javaslatok.
    if (options.generateSuggestions !== false) {
      const { generateSuggestions } = await import('@/lib/insights/engine');
      const res = generateSuggestions();
      suggestionsNew = res.created;
      log.push(`Javaslatok: ${res.open} nyitott (${res.created} új, ${res.stale} elavult).`);
    }

    const finishedAt = new Date().toISOString();
    conn
      .prepare(
        `UPDATE sync_run SET status = ?, finished_at = ?, databases_seen = ?, databases_new = ?,
           pages_upserted = ?, pages_removed = ?, suggestions_new = ?, error = ?, log = ?
         WHERE id = ?`,
      )
      .run(
        errors.length ? 'ok' : 'ok',
        finishedAt,
        databasesSeen,
        databasesNew,
        pagesUpserted,
        pagesRemoved,
        suggestionsNew,
        errors.length ? errors.join('\n') : null,
        log.join('\n'),
        runId,
      );

    return {
      runId, mode, status: 'ok', startedAt, finishedAt,
      databasesSeen, databasesNew, pagesUpserted, pagesRemoved, suggestionsNew, errors, log,
    };
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const message = describeError(err);
    conn
      .prepare('UPDATE sync_run SET status = ?, finished_at = ?, error = ?, log = ? WHERE id = ?')
      .run('error', finishedAt, message, log.join('\n'), runId);

    return {
      runId, mode, status: 'error', startedAt, finishedAt,
      databasesSeen, databasesNew, pagesUpserted, pagesRemoved, suggestionsNew,
      errors: [...errors, message], log,
    };
  }
}

interface DatabaseSyncResult {
  upserted: number;
  removed: number;
}

async function syncDatabase(mapped: MappedDatabase, mode: SyncMode): Promise<DatabaseSyncResult> {
  const conn = db();
  const client = notion();
  const now = new Date().toISOString();

  const state = conn
    .prepare<[string], { last_edited_cursor: string | null }>(
      'SELECT last_edited_cursor FROM sync_state WHERE database_id = ?',
    )
    .get(mapped.id);

  const since = mode === 'incremental' ? state?.last_edited_cursor ?? null : null;

  // Egy perc átfedést hagyunk, hogy az órák közti apró eltérés miatt
  // egyetlen módosítás se csússzon ki a szűrőből.
  const filter = since
    ? {
        timestamp: 'last_edited_time' as const,
        last_edited_time: { on_or_after: new Date(new Date(since).getTime() - 60_000).toISOString() },
      }
    : undefined;

  const seenIds: string[] = [];
  let maxEdited = since;
  let upserted = 0;
  let cursor: string | undefined;

  const upsertPage = conn.prepare(`
    INSERT INTO page (
      id, database_id, title, url, icon, archived, in_trash, created_time, last_edited_time,
      properties_json, c_status, c_status_group, c_start, c_due, c_due_end, c_due_is_time,
      c_priority, c_priority_rank, c_area, c_category, c_health, c_next_step, c_background,
      c_tags, c_is_owner, c_needs_decision, synced_at
    ) VALUES (
      @id, @database_id, @title, @url, @icon, @archived, @in_trash, @created_time, @last_edited_time,
      @properties_json, @c_status, @c_status_group, @c_start, @c_due, @c_due_end, @c_due_is_time,
      @c_priority, @c_priority_rank, @c_area, @c_category, @c_health, @c_next_step, @c_background,
      @c_tags, @c_is_owner, @c_needs_decision, @synced_at
    )
    ON CONFLICT(id) DO UPDATE SET
      database_id = excluded.database_id, title = excluded.title, url = excluded.url,
      icon = excluded.icon, archived = excluded.archived, in_trash = excluded.in_trash,
      created_time = excluded.created_time, last_edited_time = excluded.last_edited_time,
      properties_json = excluded.properties_json, c_status = excluded.c_status,
      c_status_group = excluded.c_status_group, c_start = excluded.c_start, c_due = excluded.c_due,
      c_due_end = excluded.c_due_end, c_due_is_time = excluded.c_due_is_time,
      c_priority = excluded.c_priority, c_priority_rank = excluded.c_priority_rank,
      c_area = excluded.c_area, c_category = excluded.c_category, c_health = excluded.c_health,
      c_next_step = excluded.c_next_step, c_background = excluded.c_background,
      c_tags = excluded.c_tags, c_is_owner = excluded.c_is_owner,
      c_needs_decision = excluded.c_needs_decision, synced_at = excluded.synced_at
  `);

  const deleteRelations = conn.prepare('DELETE FROM page_relation WHERE from_page_id = ?');
  const insertRelation = conn.prepare(`
    INSERT OR REPLACE INTO page_relation (from_page_id, from_database_id, property, canonical, to_page_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  do {
    const res = await schedule(() =>
      client.databases.query({
        database_id: mapped.id,
        page_size: 100,
        start_cursor: cursor,
        ...(filter ? { filter } : {}),
      }),
    );

    const batch: { page: ReturnType<typeof normalizePage>['page']; relations: NormalizedRelation[] }[] = [];

    for (const raw of res.results as RawPage[]) {
      if (!raw.id || !raw.properties) continue;
      const normalized = normalizePage(raw, mapped, now);
      batch.push({ page: normalized.page, relations: normalized.relations });
      seenIds.push(raw.id);
      if (raw.last_edited_time && (!maxEdited || raw.last_edited_time > maxEdited)) {
        maxEdited = raw.last_edited_time;
      }
    }

    const writeBatch = conn.transaction(() => {
      for (const item of batch) {
        upsertPage.run(item.page);
        deleteRelations.run(item.page.id);
        for (const rel of item.relations) {
          insertRelation.run(rel.from_page_id, rel.from_database_id, rel.property, rel.canonical, rel.to_page_id);
        }
      }
    });
    writeBatch();
    upserted += batch.length;

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  // Teljes körnél a helyi tükörből kivesszük, amit a Notion már nem ad vissza.
  let removed = 0;
  if (mode === 'full') {
    const seen = new Set(seenIds);
    const local = conn
      .prepare<[string], { id: string }>('SELECT id FROM page WHERE database_id = ?')
      .all(mapped.id);
    const stale = local.filter((r) => !seen.has(r.id)).map((r) => r.id);

    if (stale.length) {
      const cleanup = conn.transaction((ids: string[]) => {
        const delPage = conn.prepare('DELETE FROM page WHERE id = ?');
        const delRel = conn.prepare('DELETE FROM page_relation WHERE from_page_id = ? OR to_page_id = ?');
        for (const id of ids) {
          delPage.run(id);
          delRel.run(id, id);
        }
      });
      cleanup(stale);
      removed = stale.length;
    }
  }

  const pageCount = conn
    .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM page WHERE database_id = ?')
    .get(mapped.id)?.n ?? 0;

  conn
    .prepare(
      `INSERT INTO sync_state (database_id, last_synced_at, last_edited_cursor, last_full_sync_at, page_count, last_error)
       VALUES (@id, @now, @cursor, @full, @count, NULL)
       ON CONFLICT(database_id) DO UPDATE SET
         last_synced_at    = excluded.last_synced_at,
         last_edited_cursor = COALESCE(excluded.last_edited_cursor, sync_state.last_edited_cursor),
         last_full_sync_at = COALESCE(excluded.last_full_sync_at, sync_state.last_full_sync_at),
         page_count        = excluded.page_count,
         last_error        = NULL`,
    )
    .run({
      id: mapped.id,
      now,
      cursor: maxEdited,
      full: mode === 'full' ? now : null,
      count: pageCount,
    });

  return { upserted, removed };
}

/** Kell-e teljes kört futtatni? A törlések csak így derülnek ki. */
function shouldRunFullSync(): boolean {
  const row = db()
    .prepare<[], { last: string | null }>(
      "SELECT MAX(finished_at) AS last FROM sync_run WHERE mode = 'full' AND status = 'ok'",
    )
    .get();
  if (!row?.last) return true;
  const ageHours = (Date.now() - new Date(row.last).getTime()) / 3_600_000;
  return ageHours >= env.fullSyncIntervalHours;
}

/**
 * Relation-alapú felelős feloldása: ha a „Felelős" mező egy személy-oldalra
 * mutat, és annak a címe a tulajdonos valamelyik neve, akkor az oldal saját.
 * Ez csak a személy-oldalak szinkronja után futtatható, ezért külön lépés.
 */
export function resolveOwnerFlags(): number {
  const conn = db();
  const names = env.ownerNames.map(fold);
  if (names.length === 0) return 0;

  const personDbIds = listMappedDatabases()
    .filter((d) => d.role === 'person')
    .map((d) => d.id);
  if (personDbIds.length === 0) return 0;

  const placeholders = personDbIds.map(() => '?').join(',');
  const candidates = conn
    .prepare<string[], { id: string; title: string }>(
      `SELECT id, title FROM page WHERE database_id IN (${placeholders})`,
    )
    .all(...personDbIds);

  const ownerPageIds = candidates
    .filter((p) => {
      const t = fold(p.title);
      return names.some((n) => t === n || t.includes(n));
    })
    .map((p) => p.id);

  if (ownerPageIds.length === 0) return 0;

  const ownerSet = ownerPageIds.map(() => '?').join(',');
  const result = conn
    .prepare(
      `UPDATE page SET c_is_owner = 1
       WHERE c_is_owner = 0 AND id IN (
         SELECT from_page_id FROM page_relation
         WHERE canonical IN ('assignee', 'people') AND to_page_id IN (${ownerSet})
       )`,
    )
    .run(...ownerPageIds);

  return result.changes;
}

export interface SyncStatus {
  configured: boolean;
  running: boolean;
  lastRun: {
    id: number;
    mode: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    databasesSeen: number;
    databasesNew: number;
    pagesUpserted: number;
    pagesRemoved: number;
    error: string | null;
    log: string | null;
  } | null;
  databaseCount: number;
  pageCount: number;
  errorsByDatabase: { title: string; error: string }[];
}

export function getSyncStatus(): SyncStatus {
  const conn = db();
  const last = conn
    .prepare<[], {
      id: number; mode: string; status: string; started_at: string; finished_at: string | null;
      databases_seen: number; databases_new: number; pages_upserted: number; pages_removed: number;
      error: string | null; log: string | null;
    }>('SELECT * FROM sync_run ORDER BY id DESC LIMIT 1')
    .get();

  const counts = conn
    .prepare<[], { dbs: number; pages: number }>(
      `SELECT (SELECT COUNT(*) FROM notion_database WHERE removed_at IS NULL) AS dbs,
              (SELECT COUNT(*) FROM page) AS pages`,
    )
    .get();

  const dbErrors = conn
    .prepare<[], { title: string; error: string }>(
      `SELECT d.title AS title, s.last_error AS error
       FROM sync_state s JOIN notion_database d ON d.id = s.database_id
       WHERE s.last_error IS NOT NULL`,
    )
    .all();

  return {
    configured: env.notionToken.length > 0,
    running: running !== null,
    lastRun: last
      ? {
          id: last.id, mode: last.mode, status: last.status,
          startedAt: last.started_at, finishedAt: last.finished_at,
          databasesSeen: last.databases_seen, databasesNew: last.databases_new,
          pagesUpserted: last.pages_upserted, pagesRemoved: last.pages_removed,
          error: last.error, log: last.log,
        }
      : null,
    databaseCount: counts?.dbs ?? 0,
    pageCount: counts?.pages ?? 0,
    errorsByDatabase: dbErrors,
  };
}

/** Hasznos a hibaüzenetekhez: melyik adatbázisok nem elérhetők. */
export async function probeDatabase(id: string): Promise<'ok' | 'missing' | string> {
  try {
    await schedule(() => notion().databases.retrieve({ database_id: id }));
    return 'ok';
  } catch (err) {
    if (isNotFound(err)) return 'missing';
    return describeError(err);
  }
}
