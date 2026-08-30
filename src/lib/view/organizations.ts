import { db } from '@/lib/db/client';
import { listMappedDatabases } from '@/lib/mapping/store';
import { parseProperties, readText } from './read';
import { listTasks, loadPageRefs, summarize } from './tasks';
import type { OrganizationItem, PageRef } from './types';

/**
 * Szervezetek / cégek nézete: minden céghez a hozzá tartozó projektek,
 * emberek és a feladat-terhelés.
 */

interface OrgRow {
  id: string;
  database_id: string;
  title: string;
  url: string | null;
  icon: string | null;
  c_status: string | null;
  c_category: string | null;
  c_background: string | null;
  properties_json: string;
}

export function getOrganizations(ownerOnly = false): OrganizationItem[] {
  const dbs = listMappedDatabases().filter((d) => d.role === 'organization' && d.includeInDashboard);
  if (dbs.length === 0) return [];
  const dbById = new Map(dbs.map((d) => [d.id, d]));
  const ids = dbs.map((d) => d.id);

  const rows = db()
    .prepare<string[], OrgRow>(
      `SELECT id, database_id, title, url, icon, c_status, c_category, c_background, properties_json
       FROM page WHERE database_id IN (${ids.map(() => '?').join(',')}) AND archived = 0 AND in_trash = 0
       ORDER BY title COLLATE NOCASE`,
    )
    .all(...ids);

  if (rows.length === 0) return [];

  const orgIds = rows.map((r) => r.id);
  const incoming = db()
    .prepare<string[], { from_page_id: string; to_page_id: string }>(
      `SELECT from_page_id, to_page_id FROM page_relation
       WHERE canonical = 'organization' AND to_page_id IN (${orgIds.map(() => '?').join(',')})`,
    )
    .all(...orgIds);

  const refs = loadPageRefs(incoming.map((r) => r.from_page_id));

  const relatedByOrg = new Map<string, PageRef[]>();
  for (const rel of incoming) {
    const ref = refs.get(rel.from_page_id);
    if (!ref) continue;
    relatedByOrg.set(rel.to_page_id, [...(relatedByOrg.get(rel.to_page_id) ?? []), ref]);
  }

  const tasks = listTasks({ ownerOnly, limit: 5000 });
  const tasksByOrg = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (!t.organization) continue;
    tasksByOrg.set(t.organization.id, [...(tasksByOrg.get(t.organization.id) ?? []), t]);
  }

  return rows.map((r) => {
    const mapped = dbById.get(r.database_id)!;
    const props = parseProperties(r.properties_json);
    const related = relatedByOrg.get(r.id) ?? [];

    return {
      id: r.id,
      title: r.title || '(névtelen szervezet)',
      url: r.url,
      icon: r.icon,
      databaseTitle: mapped.title,
      category: r.c_category,
      status: r.c_status,
      description: r.c_background ?? readText(props, mapped, 'description'),
      link: readText(props, mapped, 'link'),
      projects: related.filter((x) => x.role === 'project' || x.role === 'subproject'),
      people: related.filter((x) => x.role === 'person'),
      taskStats: summarize(tasksByOrg.get(r.id) ?? []),
    };
  });
}
