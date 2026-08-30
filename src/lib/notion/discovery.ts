import { createHash } from 'node:crypto';
import { db } from '@/lib/db/client';
import { notion, schedule } from './client';

/**
 * A workspace teljes adatbázis-listájának felfedezése.
 *
 * A Notion `search` végpontja minden adatbázist visszaad, amit az integráció
 * lát. Ezt minden szinkronnál újrafuttatjuk — így egy frissen létrehozott
 * adatbázis magától megjelenik, külön beállítás nélkül.
 *
 * Fontos: az integráció csak a vele megosztott oldalfákat látja. A README
 * leírja, hogyan kell a workspace gyökereit megosztani, hogy tényleg "az egész
 * Notionre" rálásson.
 */

export interface DiscoveredDatabase {
  id: string;
  title: string;
  url: string | null;
  icon: string | null;
  parentType: string | null;
  parentId: string | null;
  isInline: boolean;
  archived: boolean;
  properties: Record<string, { id?: string; type?: string; name?: string }>;
  createdTime: string | null;
  lastEditedTime: string | null;
}

interface RawDatabase {
  object?: string;
  id?: string;
  title?: { plain_text?: string }[];
  url?: string;
  icon?: { type?: string; emoji?: string; external?: { url?: string }; file?: { url?: string } } | null;
  parent?: { type?: string; page_id?: string; workspace?: boolean; block_id?: string; database_id?: string };
  is_inline?: boolean;
  archived?: boolean;
  in_trash?: boolean;
  properties?: Record<string, { id?: string; type?: string; name?: string }>;
  created_time?: string;
  last_edited_time?: string;
}

export async function fetchAllDatabases(): Promise<DiscoveredDatabase[]> {
  const client = notion();
  const out: DiscoveredDatabase[] = [];
  let cursor: string | undefined;

  do {
    const res = await schedule(() =>
      client.search({
        filter: { property: 'object', value: 'database' },
        page_size: 100,
        start_cursor: cursor,
      }),
    );

    for (const raw of res.results as RawDatabase[]) {
      if (raw.object !== 'database' || !raw.id) continue;
      out.push(normalize(raw));
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return out;
}

function normalize(raw: RawDatabase): DiscoveredDatabase {
  const title = (raw.title ?? []).map((t) => t.plain_text ?? '').join('').trim();
  const parent = raw.parent ?? {};
  return {
    id: raw.id!,
    title: title || '(névtelen adatbázis)',
    url: raw.url ?? null,
    icon: raw.icon?.emoji ?? raw.icon?.external?.url ?? raw.icon?.file?.url ?? null,
    parentType: parent.type ?? null,
    parentId: parent.page_id ?? parent.block_id ?? parent.database_id ?? (parent.workspace ? 'workspace' : null),
    isInline: Boolean(raw.is_inline),
    archived: Boolean(raw.archived || raw.in_trash),
    properties: raw.properties ?? {},
    createdTime: raw.created_time ?? null,
    lastEditedTime: raw.last_edited_time ?? null,
  };
}

export function schemaHash(properties: Record<string, { type?: string }>): string {
  const shape = Object.entries(properties)
    .map(([name, p]) => `${name}:${p.type ?? '?'}`)
    .sort()
    .join('|');
  return createHash('sha1').update(shape).digest('hex').slice(0, 16);
}

export interface UpsertResult {
  seen: number;
  created: string[];   // újonnan felfedezett adatbázis-azonosítók
  changed: string[];   // olyanok, ahol a séma módosult
  removed: string[];   // amit már nem látunk (törölve / megosztás visszavonva)
}

/** A felfedezett listát beírja a helyi tükörbe, és jelzi, mi változott. */
export function upsertDatabases(list: DiscoveredDatabase[]): UpsertResult {
  const conn = db();
  const now = new Date().toISOString();

  const existing = new Map(
    conn
      .prepare<[], { id: string; schema_hash: string | null; removed_at: string | null }>(
        'SELECT id, schema_hash, removed_at FROM notion_database',
      )
      .all()
      .map((r) => [r.id, r]),
  );

  const insert = conn.prepare(`
    INSERT INTO notion_database
      (id, title, url, icon, parent_type, parent_id, is_inline, archived,
       schema_json, schema_hash, created_time, last_edited_time, first_seen_at, last_seen_at, removed_at)
    VALUES (@id, @title, @url, @icon, @parent_type, @parent_id, @is_inline, @archived,
            @schema_json, @schema_hash, @created_time, @last_edited_time, @now, @now, NULL)
    ON CONFLICT(id) DO UPDATE SET
      title            = excluded.title,
      url              = excluded.url,
      icon             = excluded.icon,
      parent_type      = excluded.parent_type,
      parent_id        = excluded.parent_id,
      is_inline        = excluded.is_inline,
      archived         = excluded.archived,
      schema_json      = excluded.schema_json,
      schema_hash      = excluded.schema_hash,
      last_edited_time = excluded.last_edited_time,
      last_seen_at     = excluded.last_seen_at,
      removed_at       = NULL
  `);

  const result: UpsertResult = { seen: list.length, created: [], changed: [], removed: [] };

  const tx = conn.transaction((items: DiscoveredDatabase[]) => {
    for (const d of items) {
      const hash = schemaHash(d.properties);
      const prev = existing.get(d.id);
      if (!prev) result.created.push(d.id);
      else if (prev.schema_hash !== hash) result.changed.push(d.id);
      else if (prev.removed_at) result.changed.push(d.id); // visszatért

      insert.run({
        id: d.id,
        title: d.title,
        url: d.url,
        icon: d.icon,
        parent_type: d.parentType,
        parent_id: d.parentId,
        is_inline: d.isInline ? 1 : 0,
        archived: d.archived ? 1 : 0,
        schema_json: JSON.stringify(d.properties),
        schema_hash: hash,
        created_time: d.createdTime,
        last_edited_time: d.lastEditedTime,
        now,
      });
    }

    // Amit ebben a körben nem láttunk, azt nem töröljük — csak megjelöljük.
    // A történeti adat így megmarad, és egy visszaállított megosztás után
    // magától újraéled.
    const seenIds = new Set(items.map((d) => d.id));
    for (const [id, row] of existing) {
      if (!seenIds.has(id) && !row.removed_at) {
        conn.prepare('UPDATE notion_database SET removed_at = ? WHERE id = ?').run(now, id);
        result.removed.push(id);
      }
    }
  });

  tx(list);
  return result;
}
