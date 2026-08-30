import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { getMappedDatabase } from '@/lib/mapping/store';
import type { WritebackAction } from '@/lib/insights/types';
import { describeError, notion, schedule } from './client';
import { buildPropertyValue, isWritable, plainText, type NotionProperties } from './properties';

/**
 * Visszaírás a Notionbe.
 *
 * Minden művelet előtt eltároljuk a mező *korábbi* értékét, hogy a
 * `writeback_log` alapján bármelyik változtatás visszavonható legyen. Ha a
 * `WRITEBACK_DRY_RUN` be van kapcsolva, csak naplózunk — így élesítés előtt
 * végignézhető, mit tenne a rendszer.
 */

export interface WritebackResult {
  status: 'ok' | 'error' | 'dry_run';
  message: string;
  logId: number;
  before?: unknown;
  after?: unknown;
}

export async function applyAction(
  action: WritebackAction,
  suggestionId: string | null = null,
): Promise<WritebackResult> {
  const conn = db();
  const now = new Date().toISOString();

  const pageRow = conn
    .prepare<[string], { id: string; title: string; database_id: string; properties_json: string }>(
      'SELECT id, title, database_id, properties_json FROM page WHERE id = ?',
    )
    .get(action.pageId);

  if (!pageRow) {
    return fail(conn, action, suggestionId, null, 'Az oldal nincs a helyi tükörben — futtass szinkront.', now);
  }

  if (action.type === 'comment') {
    if (env.writebackDryRun) {
      return logResult(conn, action, suggestionId, pageRow.title, null, action.text, 'dry_run',
        'Próbaüzem: a megjegyzés nem került ki a Notionbe.', now);
    }
    try {
      await schedule(() =>
        notion().comments.create({
          parent: { page_id: action.pageId },
          rich_text: [{ type: 'text', text: { content: action.text } }],
        }),
      );
      return logResult(conn, action, suggestionId, pageRow.title, null, action.text, 'ok',
        'Megjegyzés kiírva a Notionbe.', now);
    } catch (err) {
      return fail(conn, action, suggestionId, pageRow.title, describeError(err), now);
    }
  }

  // set_field
  const mapped = getMappedDatabase(pageRow.database_id);
  if (!mapped) {
    return fail(conn, action, suggestionId, pageRow.title, 'Az adatbázis leképezése hiányzik.', now);
  }

  const propertyName = mapped.fields[action.field];
  if (!propertyName) {
    return fail(conn, action, suggestionId, pageRow.title,
      `A(z) „${action.field}" mező nincs leképezve ebben az adatbázisban. Állítsd be az Adatbázisok fülön.`, now);
  }

  const propSchema = mapped.schema[propertyName];
  const type = propSchema?.type;
  if (!type || !isWritable(type)) {
    return fail(conn, action, suggestionId, pageRow.title,
      `A(z) „${propertyName}" property (${type ?? 'ismeretlen'}) nem írható.`, now);
  }

  const payload = buildPropertyValue(type, action.value);
  if (!payload) {
    return fail(conn, action, suggestionId, pageRow.title,
      `Nem sikerült értéket építeni a(z) ${type} típushoz.`, now);
  }

  let props: NotionProperties = {};
  try {
    props = JSON.parse(pageRow.properties_json) as NotionProperties;
  } catch {
    /* üres marad */
  }
  const before = plainText(props[propertyName]);

  if (env.writebackDryRun) {
    return logResult(conn, action, suggestionId, pageRow.title, before, action.value, 'dry_run',
      `Próbaüzem: „${propertyName}" nem került frissítésre.`, now);
  }

  try {
    await schedule(() =>
      notion().pages.update({
        page_id: action.pageId,
        properties: { [propertyName]: payload } as never,
      }),
    );
  } catch (err) {
    return fail(conn, action, suggestionId, pageRow.title, describeError(err), now);
  }

  // A helyi tükröt azonnal frissítjük, hogy a felület ne mutasson elavult állapotot.
  // A következő szinkron amúgy is felülírja a Notion hiteles adatával.
  props[propertyName] = { ...(props[propertyName] ?? {}), type, ...payload } as NotionProperties[string];
  conn.prepare('UPDATE page SET properties_json = ? WHERE id = ?').run(JSON.stringify(props), action.pageId);
  applyLocalCanonical(action, propertyName, mapped.fields);

  return logResult(conn, action, suggestionId, pageRow.title, before, action.value, 'ok',
    `„${propertyName}" frissítve a Notionben.`, now);
}

/** A kanonikus oszlopot is frissítjük, hogy a nézetek azonnal helyesek legyenek. */
function applyLocalCanonical(
  action: Extract<WritebackAction, { type: 'set_field' }>,
  _propertyName: string,
  _fields: Record<string, string | undefined>,
): void {
  const conn = db();
  const value = action.value;
  const column: Partial<Record<string, string>> = {
    status: 'c_status',
    due: 'c_due',
    start: 'c_start',
    priority: 'c_priority',
    nextStep: 'c_next_step',
    background: 'c_background',
    area: 'c_area',
    category: 'c_category',
    health: 'c_health',
    needsDecision: 'c_needs_decision',
  };
  const col = column[action.field];
  if (!col) return;

  const stored =
    action.field === 'needsDecision'
      ? (value ? 1 : 0)
      : value === null || value === undefined
        ? null
        : typeof value === 'object'
          ? ((value as { start?: string }).start ?? null)
          : String(value);

  conn.prepare(`UPDATE page SET ${col} = ? WHERE id = ?`).run(stored, action.pageId);
}

function logResult(
  conn: ReturnType<typeof db>,
  action: WritebackAction,
  suggestionId: string | null,
  pageTitle: string | null,
  before: unknown,
  after: unknown,
  status: 'ok' | 'dry_run',
  message: string,
  now: string,
): WritebackResult {
  const info = conn
    .prepare(
      `INSERT INTO writeback_log (suggestion_id, page_id, page_title, action_json, before_json, after_json, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(suggestionId, action.pageId, pageTitle, JSON.stringify(action), JSON.stringify(before ?? null), JSON.stringify(after ?? null), status, now);

  return { status, message, logId: Number(info.lastInsertRowid), before, after };
}

function fail(
  conn: ReturnType<typeof db>,
  action: WritebackAction,
  suggestionId: string | null,
  pageTitle: string | null,
  message: string,
  now: string,
): WritebackResult {
  const info = conn
    .prepare(
      `INSERT INTO writeback_log (suggestion_id, page_id, page_title, action_json, before_json, after_json, status, error, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, 'error', ?, ?)`,
    )
    .run(suggestionId, action.pageId, pageTitle, JSON.stringify(action), message, now);

  return { status: 'error', message, logId: Number(info.lastInsertRowid) };
}

export interface WritebackLogEntry {
  id: number;
  suggestionId: string | null;
  pageId: string;
  pageTitle: string | null;
  describe: string;
  before: string | null;
  after: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  undoable: boolean;
}

export function listWritebackLog(limit = 100): WritebackLogEntry[] {
  return db()
    .prepare<[number], {
      id: number; suggestion_id: string | null; page_id: string; page_title: string | null;
      action_json: string; before_json: string | null; after_json: string | null;
      status: string; error: string | null; created_at: string;
    }>('SELECT * FROM writeback_log ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((r) => {
      let describe = '';
      let isSetField = false;
      try {
        const a = JSON.parse(r.action_json) as WritebackAction;
        describe = a.describe;
        isSetField = a.type === 'set_field';
      } catch {
        describe = '(ismeretlen művelet)';
      }
      return {
        id: r.id,
        suggestionId: r.suggestion_id,
        pageId: r.page_id,
        pageTitle: r.page_title,
        describe,
        before: r.before_json,
        after: r.after_json,
        status: r.status,
        error: r.error,
        createdAt: r.created_at,
        undoable: r.status === 'ok' && isSetField && r.before_json !== null,
      };
    });
}

/** Egy sikeres mezőírás visszavonása a naplózott korábbi értékre. */
export async function undoWriteback(logId: number): Promise<WritebackResult> {
  const conn = db();
  const row = conn
    .prepare<[number], { id: number; page_id: string; action_json: string; before_json: string | null; status: string }>(
      'SELECT id, page_id, action_json, before_json, status FROM writeback_log WHERE id = ?',
    )
    .get(logId);

  if (!row) return { status: 'error', message: 'Nincs ilyen naplóbejegyzés.', logId };
  if (row.status !== 'ok') return { status: 'error', message: 'Csak sikeres írás vonható vissza.', logId };

  const action = JSON.parse(row.action_json) as WritebackAction;
  if (action.type !== 'set_field') {
    return { status: 'error', message: 'Megjegyzés nem vonható vissza automatikusan.', logId };
  }

  const before = row.before_json ? (JSON.parse(row.before_json) as unknown) : null;
  const result = await applyAction(
    {
      type: 'set_field',
      pageId: row.page_id,
      field: action.field,
      value: before === '' ? null : before,
      describe: `Visszavonás: ${action.describe}`,
    },
    null,
  );

  if (result.status === 'ok') {
    conn.prepare("UPDATE writeback_log SET status = 'undone' WHERE id = ?").run(logId);
  }
  return result;
}
