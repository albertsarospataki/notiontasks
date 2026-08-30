import { env } from '@/lib/env';
import {
  plainText, priorityRank, readCheckbox, readChoice, readDate, readMultiChoice,
  readPeople, readRelationIds, statusGroup,
  type NotionProperties, type StatusGroup,
} from '@/lib/notion/properties';
import type { MappedDatabase } from '@/lib/mapping/store';
import { RELATION_TARGET_ROLE, type CanonicalField } from '@/lib/mapping/roles';
import { fold } from '@/lib/util/text';
import { toDayKey } from '@/lib/util/date';

/**
 * Nyers Notion-oldal → a helyi tükör sora.
 *
 * A kanonikus oszlopokat a mezőleképezés tölti ki. Amit nem tudunk leképezni,
 * az nem vész el: a teljes `properties` nyersen is eltárolódik.
 */

export interface RawPage {
  id: string;
  url?: string;
  icon?: { emoji?: string; external?: { url?: string }; file?: { url?: string } } | null;
  archived?: boolean;
  in_trash?: boolean;
  created_time?: string;
  last_edited_time?: string;
  properties?: NotionProperties;
  parent?: { database_id?: string };
}

export interface NormalizedPage {
  id: string;
  database_id: string;
  title: string;
  url: string | null;
  icon: string | null;
  archived: number;
  in_trash: number;
  created_time: string | null;
  last_edited_time: string | null;
  properties_json: string;
  c_status: string | null;
  c_status_group: StatusGroup | null;
  c_start: string | null;
  c_due: string | null;
  c_due_end: string | null;
  c_due_is_time: number;
  c_priority: string | null;
  c_priority_rank: number | null;
  c_area: string | null;
  c_category: string | null;
  c_health: string | null;
  c_next_step: string | null;
  c_background: string | null;
  c_tags: string | null;
  c_is_owner: number;
  c_needs_decision: number;
  synced_at: string;
}

export interface NormalizedRelation {
  from_page_id: string;
  from_database_id: string;
  property: string;
  canonical: string | null;
  to_page_id: string;
}

export interface NormalizedResult {
  page: NormalizedPage;
  relations: NormalizedRelation[];
  /** Relation-célok, amelyek tulajdonost jelölhetnek (utólagos feloldáshoz). */
  ownerCandidateIds: string[];
}

/** A `status` típusú property opció → csoport hozzárendelése a sémából. */
function statusGroupsFromSchema(db: MappedDatabase, propName: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!propName) return out;
  const prop = db.schema[propName] as unknown as {
    type?: string;
    status?: { options?: { id?: string; name?: string }[]; groups?: { name?: string; option_ids?: string[] }[] };
  };
  if (prop?.type !== 'status' || !prop.status) return out;

  const idToName = new Map((prop.status.options ?? []).map((o) => [o.id ?? '', o.name ?? '']));
  for (const g of prop.status.groups ?? []) {
    for (const id of g.option_ids ?? []) {
      const name = idToName.get(id);
      if (name) out.set(name, g.name ?? '');
    }
  }
  return out;
}

export function normalizePage(raw: RawPage, mapped: MappedDatabase, now: string): NormalizedResult {
  const props = raw.properties ?? {};
  const f = mapped.fields;
  const get = (field: CanonicalField) => {
    const name = f[field];
    return name ? props[name] : undefined;
  };

  const title = plainText(get('title')) || plainText(Object.values(props).find((p) => p.type === 'title'));

  const statusName = readChoice(get('status'));
  const groupMap = statusGroupsFromSchema(mapped, f.status);
  const group = statusName ? statusGroup(statusName, groupMap.get(statusName) ?? null) : null;

  const due = readDate(get('due'));
  const start = readDate(get('start'));
  const priority = readChoice(get('priority'));
  const tags = readMultiChoice(get('tags'));

  const relations: NormalizedRelation[] = [];
  const canonicalByProperty = new Map<string, CanonicalField>();
  for (const [field, propName] of Object.entries(f)) {
    if (propName && RELATION_TARGET_ROLE[field as CanonicalField]) {
      canonicalByProperty.set(propName, field as CanonicalField);
    }
  }

  for (const [propName, prop] of Object.entries(props)) {
    if (prop.type !== 'relation') continue;
    const canonical = canonicalByProperty.get(propName) ?? null;
    for (const toId of readRelationIds(prop)) {
      relations.push({
        from_page_id: raw.id,
        from_database_id: mapped.id,
        property: propName,
        canonical,
        to_page_id: toId,
      });
    }
  }

  const ownerCandidateIds = relations
    .filter((r) => r.canonical === 'assignee' || r.canonical === 'people')
    .map((r) => r.to_page_id);

  return {
    page: {
      id: raw.id,
      database_id: mapped.id,
      title,
      url: raw.url ?? null,
      icon: raw.icon?.emoji ?? raw.icon?.external?.url ?? raw.icon?.file?.url ?? null,
      archived: raw.archived ? 1 : 0,
      in_trash: raw.in_trash ? 1 : 0,
      created_time: raw.created_time ?? null,
      last_edited_time: raw.last_edited_time ?? null,
      properties_json: JSON.stringify(props),
      c_status: statusName,
      c_status_group: group,
      c_start: start ? toDayKey(start.start) : null,
      c_due: due ? toDayKey(due.start) : null,
      c_due_end: due?.end ? toDayKey(due.end) : null,
      c_due_is_time: due?.isDateTime ? 1 : 0,
      c_priority: priority,
      c_priority_rank: priority ? priorityRank(priority) : null,
      c_area: readChoice(get('area')) ?? readMultiChoice(get('area'))[0] ?? null,
      c_category: readChoice(get('category')) ?? null,
      c_health: readChoice(get('health')) ?? null,
      c_next_step: plainText(get('nextStep')) || null,
      c_background: plainText(get('background')) || plainText(get('description')) || null,
      c_tags: tags.length ? JSON.stringify(tags) : null,
      c_is_owner: ownerFromDirectSignals(props, f, tags) ? 1 : 0,
      c_needs_decision: readCheckbox(get('needsDecision')) ? 1 : 0,
      synced_at: now,
    },
    relations,
    ownerCandidateIds,
  };
}

/**
 * „Albert saját feladata?" — az a jel, ami az oldalból közvetlenül kiolvasható.
 * A relation-alapú felelős feloldása külön, a szinkron végén történik, amikor
 * már minden személy-oldal a tükörben van.
 */
function ownerFromDirectSignals(
  props: NotionProperties,
  fields: MappedDatabase['fields'],
  tags: string[],
): boolean {
  const emails = env.ownerEmails;
  const names = env.ownerNames.map(fold);

  const assigneeProp = fields.assignee ? props[fields.assignee] : undefined;

  for (const person of readPeople(assigneeProp)) {
    if (person.email && emails.includes(person.email.toLowerCase())) return true;
    if (person.name && names.includes(fold(person.name))) return true;
  }

  // Szöveges vagy select felelős-mező.
  if (assigneeProp && ['select', 'rich_text', 'status'].includes(assigneeProp.type ?? '')) {
    const v = fold(readChoice(assigneeProp) ?? '');
    if (v && names.some((n) => v.includes(n) || n.includes(v))) return true;
  }

  // A workspace konvenciója: a „Saját" címke a magánfeladatot jelöli.
  if (tags.some((t) => fold(t) === 'sajat')) return true;

  return false;
}
