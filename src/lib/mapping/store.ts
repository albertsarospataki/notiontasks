import { db } from '@/lib/db/client';
import { classifyDatabase, refineWithGraph, relationTargets, type Classification } from './classify';
import { detectFields, mergeFieldMaps, type FieldMap, type PropertySchema } from './fields';
import { ROLE_FIELDS, type CanonicalField, type Role } from './roles';

/**
 * A leképezések tára.
 *
 * Az automatikus találgatás és a kézi felülírás külön él egymás mellett:
 * a séma változásakor az `auto` részt újraszámoljuk, a `manual` rész érintetlen
 * marad, és a kettő összefésüléséből áll elő a ténylegesen használt leképezés.
 */

export interface DatabaseRow {
  id: string;
  title: string;
  url: string | null;
  icon: string | null;
  parent_type: string | null;
  parent_id: string | null;
  is_inline: number;
  archived: number;
  schema_json: string;
  schema_hash: string | null;
  created_time: string | null;
  last_edited_time: string | null;
  first_seen_at: string;
  last_seen_at: string;
  removed_at: string | null;
}

export interface MappedDatabase {
  id: string;
  title: string;
  url: string | null;
  icon: string | null;
  archived: boolean;
  removed: boolean;
  schema: PropertySchema;
  role: Role;
  roleSource: 'auto' | 'manual';
  confidence: number;
  reason: string;
  fields: FieldMap;        // ténylegesen használt (auto + manual)
  autoFields: FieldMap;
  manualFields: FieldMap;
  includeInDashboard: boolean;
  reviewed: boolean;
  firstSeenAt: string;
  relationTargets: Record<string, string>;
}

interface StoredFields {
  auto: FieldMap;
  manual: FieldMap;
}

function parseFields(json: string): StoredFields {
  try {
    const parsed = JSON.parse(json) as Partial<StoredFields>;
    return { auto: parsed.auto ?? {}, manual: parsed.manual ?? {} };
  } catch {
    return { auto: {}, manual: {} };
  }
}

function parseSchema(json: string): PropertySchema {
  try {
    return JSON.parse(json) as PropertySchema;
  } catch {
    return {};
  }
}

/**
 * Minden adatbázishoz gondoskodik érvényes leképezésről.
 * Ezt a felfedezés után kell hívni — így egy vadonatúj adatbázis azonnal
 * besorolást és mezőleképezést kap, emberi beavatkozás nélkül.
 */
export function refreshMappings(): { created: string[]; updated: string[] } {
  const conn = db();
  const now = new Date().toISOString();

  const databases = conn
    .prepare<[], DatabaseRow>('SELECT * FROM notion_database WHERE removed_at IS NULL')
    .all();

  const existing = new Map(
    conn
      .prepare<[], { database_id: string; role: string; role_source: string; fields_json: string; reviewed: number }>(
        'SELECT database_id, role, role_source, fields_json, reviewed FROM database_mapping',
      )
      .all()
      .map((r) => [r.database_id, r]),
  );

  // 1. kör: név + séma alapján
  const firstPass = databases.map((d) => ({
    id: d.id,
    title: d.title,
    schema: parseSchema(d.schema_json),
    classification: classifyDatabase(d.title, parseSchema(d.schema_json)),
  }));

  // 2. kör: relation-gráf finomítás
  const refined = refineWithGraph(firstPass);

  const upsert = conn.prepare(`
    INSERT INTO database_mapping
      (database_id, role, role_source, role_confidence, role_reason, fields_json, fields_source,
       include_in_dashboard, reviewed, updated_at)
    VALUES (@database_id, @role, @role_source, @role_confidence, @role_reason, @fields_json, @fields_source,
            @include_in_dashboard, @reviewed, @updated_at)
    ON CONFLICT(database_id) DO UPDATE SET
      role            = excluded.role,
      role_source     = excluded.role_source,
      role_confidence = excluded.role_confidence,
      role_reason     = excluded.role_reason,
      fields_json     = excluded.fields_json,
      updated_at      = excluded.updated_at
  `);

  const created: string[] = [];
  const updated: string[] = [];

  const tx = conn.transaction(() => {
    for (const entry of firstPass) {
      const prev = existing.get(entry.id);
      const classification: Classification = refined.get(entry.id) ?? entry.classification;

      // Kézi szerep-választás mindig nyer.
      const manualRole = prev?.role_source === 'manual';
      const role = (manualRole ? (prev!.role as Role) : classification.role) satisfies Role;

      const stored = prev ? parseFields(prev.fields_json) : { auto: {}, manual: {} };
      const auto = detectFields(entry.schema, role);
      const fields: StoredFields = { auto, manual: stored.manual };

      upsert.run({
        database_id: entry.id,
        role,
        role_source: manualRole ? 'manual' : 'auto',
        role_confidence: manualRole ? 1 : classification.confidence,
        role_reason: manualRole ? 'kézi beállítás' : classification.reason,
        fields_json: JSON.stringify(fields),
        fields_source: Object.keys(stored.manual).length > 0 ? 'mixed' : 'auto',
        include_in_dashboard: role === 'ignored' ? 0 : 1,
        reviewed: prev?.reviewed ?? 0,
        updated_at: now,
      });

      if (!prev) created.push(entry.id);
      else if (prev.role !== role) updated.push(entry.id);
    }
  });

  tx();
  return { created, updated };
}

const SELECT_MAPPED = `
  SELECT d.*, m.role, m.role_source, m.role_confidence, m.role_reason,
         m.fields_json, m.include_in_dashboard, m.reviewed
  FROM notion_database d
  JOIN database_mapping m ON m.database_id = d.id
`;

interface JoinedRow extends DatabaseRow {
  role: string;
  role_source: string;
  role_confidence: number;
  role_reason: string | null;
  fields_json: string;
  include_in_dashboard: number;
  reviewed: number;
}

function toMapped(r: JoinedRow): MappedDatabase {
  const schema = parseSchema(r.schema_json);
  const stored = parseFields(r.fields_json);
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    icon: r.icon,
    archived: r.archived === 1,
    removed: r.removed_at !== null,
    schema,
    role: r.role as Role,
    roleSource: r.role_source === 'manual' ? 'manual' : 'auto',
    confidence: r.role_confidence,
    reason: r.role_reason ?? '',
    autoFields: stored.auto,
    manualFields: stored.manual,
    fields: mergeFieldMaps(stored.auto, stored.manual),
    includeInDashboard: r.include_in_dashboard === 1,
    reviewed: r.reviewed === 1,
    firstSeenAt: r.first_seen_at,
    relationTargets: relationTargets(schema),
  };
}

export function listMappedDatabases(opts: { includeRemoved?: boolean } = {}): MappedDatabase[] {
  const where = opts.includeRemoved ? '' : 'WHERE d.removed_at IS NULL';
  return db()
    .prepare<[], JoinedRow>(`${SELECT_MAPPED} ${where} ORDER BY d.title COLLATE NOCASE`)
    .all()
    .map(toMapped);
}

export function getMappedDatabase(id: string): MappedDatabase | null {
  const row = db().prepare<[string], JoinedRow>(`${SELECT_MAPPED} WHERE d.id = ?`).get(id);
  return row ? toMapped(row) : null;
}

export function databasesWithRole(role: Role): MappedDatabase[] {
  return listMappedDatabases().filter((d) => d.role === role && d.includeInDashboard);
}

/** Azok az adatbázisok, amelyeket ténylegesen szinkronizálunk. */
export function syncableDatabases(): MappedDatabase[] {
  return listMappedDatabases().filter((d) => d.role !== 'ignored' && !d.archived);
}

/** Amelyeknél a besorolás bizonytalan — ezek kerülnek a „megerősítendő" listára. */
export function needsReview(): MappedDatabase[] {
  return listMappedDatabases().filter(
    (d) => !d.reviewed && d.roleSource === 'auto' && (d.confidence < 0.6 || d.role === 'other'),
  );
}

export interface MappingUpdate {
  role?: Role;
  fields?: Partial<Record<CanonicalField, string>>;
  includeInDashboard?: boolean;
  reviewed?: boolean;
}

/** Kézi felülírás mentése. A szerep megváltoztatása újraszámolja az auto-mezőket. */
export function updateMapping(databaseId: string, update: MappingUpdate): MappedDatabase | null {
  const conn = db();
  const current = getMappedDatabase(databaseId);
  if (!current) return null;

  const role = update.role ?? current.role;
  const roleChanged = update.role !== undefined && update.role !== current.role;

  const auto = roleChanged ? detectFields(current.schema, role) : current.autoFields;
  const manual: FieldMap = { ...current.manualFields };

  if (update.fields) {
    const allowed = new Set<CanonicalField>(ROLE_FIELDS[role] ?? []);
    for (const [field, prop] of Object.entries(update.fields)) {
      const key = field as CanonicalField;
      if (!allowed.has(key)) continue;
      if (prop === undefined) continue;
      if (prop === '__auto__') delete manual[key];
      else manual[key] = prop; // '' = szándékos letiltás
    }
  }

  conn
    .prepare(
      `UPDATE database_mapping
         SET role = ?, role_source = ?, role_confidence = ?, role_reason = ?,
             fields_json = ?, fields_source = ?, include_in_dashboard = ?, reviewed = ?, updated_at = ?
       WHERE database_id = ?`,
    )
    .run(
      role,
      update.role !== undefined ? 'manual' : current.roleSource,
      update.role !== undefined ? 1 : current.confidence,
      update.role !== undefined ? 'kézi beállítás' : current.reason,
      JSON.stringify({ auto, manual }),
      Object.keys(manual).length > 0 ? 'mixed' : 'auto',
      (update.includeInDashboard ?? current.includeInDashboard) ? 1 : 0,
      (update.reviewed ?? true) ? 1 : 0,
      new Date().toISOString(),
      databaseId,
    );

  return getMappedDatabase(databaseId);
}
