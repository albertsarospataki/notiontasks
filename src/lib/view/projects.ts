import { db } from '@/lib/db/client';
import type { StatusGroup } from '@/lib/notion/properties';
import { listMappedDatabases, type MappedDatabase } from '@/lib/mapping/store';
import { today } from '@/lib/util/date';
import { parseProperties, readDayField, readText } from './read';
import { listTasks, loadPageRefs, summarize } from './tasks';
import type { PageRef, ProjectItem, TaskItem, TaskStats } from './types';
import { EMPTY_STATS } from './types';

/**
 * Projekt-portfólió a helyi tükörből.
 *
 * A projekt és az alprojekt ugyanaz a szerkezet, csak más szerep. A fát a
 * relation-gráfból építjük: az alprojekt „Projekt" kapcsolata, vagy a projekt
 * „Alprojektek" kapcsolata — bármelyik irány elég.
 */

interface ProjectRow {
  id: string;
  database_id: string;
  title: string;
  url: string | null;
  icon: string | null;
  c_status: string | null;
  c_status_group: string | null;
  c_area: string | null;
  c_category: string | null;
  c_health: string | null;
  c_background: string | null;
  c_due: string | null;
  last_edited_time: string | null;
  properties_json: string;
}

function roleDatabases(role: 'project' | 'subproject'): MappedDatabase[] {
  return listMappedDatabases().filter((d) => d.role === role && d.includeInDashboard);
}

function loadRows(dbs: MappedDatabase[]): ProjectRow[] {
  if (dbs.length === 0) return [];
  const ids = dbs.map((d) => d.id);
  return db()
    .prepare<string[], ProjectRow>(
      `SELECT id, database_id, title, url, icon, c_status, c_status_group, c_area, c_category,
              c_health, c_background, c_due, last_edited_time, properties_json
       FROM page
       WHERE database_id IN (${ids.map(() => '?').join(',')}) AND archived = 0 AND in_trash = 0
       ORDER BY title COLLATE NOCASE`,
    )
    .all(...ids);
}

interface RelationIndex {
  /** oldal → kanonikus kapcsolat → célok */
  out: Map<string, Map<string, string[]>>;
  /** cél → forrás oldalak (kanonikus kapcsolat szerint) */
  in: Map<string, Map<string, string[]>>;
}

function loadRelations(): RelationIndex {
  const rows = db()
    .prepare<[], { from_page_id: string; canonical: string | null; to_page_id: string }>(
      'SELECT from_page_id, canonical, to_page_id FROM page_relation WHERE canonical IS NOT NULL',
    )
    .all();

  const out = new Map<string, Map<string, string[]>>();
  const inc = new Map<string, Map<string, string[]>>();

  for (const r of rows) {
    if (!r.canonical) continue;
    const o = out.get(r.from_page_id) ?? new Map<string, string[]>();
    o.set(r.canonical, [...(o.get(r.canonical) ?? []), r.to_page_id]);
    out.set(r.from_page_id, o);

    const i = inc.get(r.to_page_id) ?? new Map<string, string[]>();
    i.set(r.canonical, [...(i.get(r.canonical) ?? []), r.from_page_id]);
    inc.set(r.to_page_id, i);
  }

  return { out, in: inc };
}

export interface Portfolio {
  projects: ProjectItem[];
  /** Terület szerint csoportosítva: Üzleti / Társadalmi / Privát / besorolatlan. */
  byArea: { area: string; projects: ProjectItem[] }[];
  orphanSubprojects: ProjectItem[];
  stats: {
    total: number;
    active: number;
    blocked: number;
    atRisk: number;
    withoutOpenTasks: number;
  };
}

export function getPortfolio(ownerOnly = false): Portfolio {
  const projectDbs = roleDatabases('project');
  const subDbs = roleDatabases('subproject');
  const dbById = new Map(listMappedDatabases().map((d) => [d.id, d]));

  const projectRows = loadRows(projectDbs);
  const subRows = loadRows(subDbs);
  const relations = loadRelations();

  // Feladatokat egyszer kérünk le, és projektenként osztjuk szét.
  const tasks = listTasks({ ownerOnly, limit: 5000 });
  const tasksByTarget = new Map<string, TaskItem[]>();
  for (const t of tasks) {
    for (const ref of [t.project, t.subproject]) {
      if (!ref) continue;
      const list = tasksByTarget.get(ref.id) ?? [];
      list.push(t);
      tasksByTarget.set(ref.id, list);
    }
  }

  const allRefIds = [
    ...relations.out.values(),
  ].flatMap((m) => [...m.values()].flat());
  const refs = loadPageRefs(allRefIds);

  const build = (row: ProjectRow, role: 'project' | 'subproject'): ProjectItem => {
    const mapped = dbById.get(row.database_id)!;
    const props = parseProperties(row.properties_json);
    const out = relations.out.get(row.id);
    const inc = relations.in.get(row.id);

    const resolve = (ids: string[] | undefined): PageRef[] =>
      (ids ?? []).map((id) => refs.get(id)).filter((r): r is PageRef => Boolean(r));

    const ownTasks = tasksByTarget.get(row.id) ?? [];

    return {
      id: row.id,
      title: row.title || '(névtelen projekt)',
      url: row.url,
      icon: row.icon,
      databaseId: row.database_id,
      databaseTitle: mapped.title,
      role,
      status: row.c_status,
      statusGroup: (row.c_status_group as StatusGroup | null) ?? 'unknown',
      area: row.c_area,
      category: row.c_category,
      health: row.c_health,
      milestone: readText(props, mapped, 'milestone'),
      milestoneDue: readDayField(props, mapped, 'milestoneDue'),
      reviewDate: readDayField(props, mapped, 'reviewDate'),
      description: row.c_background ?? readText(props, mapped, 'description'),
      due: row.c_due,
      lastEditedTime: row.last_edited_time,
      organizations: resolve(out?.get('organization')),
      people: [...resolve(out?.get('people')), ...resolve(out?.get('assignee'))],
      parentProject: resolve(out?.get('project'))[0] ?? null,
      subprojects: [],
      taskStats: summarize(ownTasks),
    };
  };

  const subprojects = subRows.map((r) => build(r, 'subproject'));
  const projects = projectRows.map((r) => build(r, 'project'));

  const subById = new Map(subprojects.map((s) => [s.id, s]));
  const attached = new Set<string>();

  for (const p of projects) {
    const out = relations.out.get(p.id);
    const inc = relations.in.get(p.id);
    const childIds = new Set<string>([
      ...(out?.get('subprojects') ?? []),
      ...(out?.get('subproject') ?? []),
      // az alprojekt felől: „Projekt" kapcsolat erre a projektre mutat
      ...(inc?.get('project') ?? []),
    ]);

    for (const id of childIds) {
      const child = subById.get(id);
      if (!child) continue;
      p.subprojects.push(child);
      attached.add(id);
    }

    // A projekt összesített statisztikája az alprojektek feladatait is tartalmazza.
    p.taskStats = mergeStats([p.taskStats, ...p.subprojects.map((s) => s.taskStats)]);
    p.subprojects.sort((a, b) => a.title.localeCompare(b.title, 'hu'));
  }

  projects.sort(projectOrder);

  const areaOrder = ['Üzleti', 'Társadalmi', 'Privát'];
  const areaMap = new Map<string, ProjectItem[]>();
  for (const p of projects) {
    const key = p.area ?? 'Besorolatlan';
    areaMap.set(key, [...(areaMap.get(key) ?? []), p]);
  }
  const byArea = [...areaMap.entries()]
    .map(([area, list]) => ({ area, projects: list }))
    .sort((a, b) => {
      const ia = areaOrder.indexOf(a.area);
      const ib = areaOrder.indexOf(b.area);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.area.localeCompare(b.area, 'hu');
    });

  return {
    projects,
    byArea,
    orphanSubprojects: subprojects.filter((s) => !attached.has(s.id)),
    stats: {
      total: projects.length,
      active: projects.filter((p) => p.statusGroup === 'in_progress').length,
      blocked: projects.filter((p) => p.statusGroup === 'blocked').length,
      atRisk: projects.filter((p) => isAtRisk(p)).length,
      withoutOpenTasks: projects.filter((p) => p.statusGroup !== 'done' && p.taskStats.open === 0).length,
    },
  };
}

/** Piros RAG vagy lejárt mérföldkő — ez az, ami eszkalációt érdemel. */
export function isAtRisk(p: ProjectItem): boolean {
  if (p.statusGroup === 'done') return false;
  if (p.health && /piros|red|🔴/i.test(p.health)) return true;
  if (p.milestoneDue && p.milestoneDue < today()) return true;
  if (p.taskStats.overdue > 0 && p.statusGroup === 'in_progress') return true;
  return false;
}

function projectOrder(a: ProjectItem, b: ProjectItem): number {
  const risk = Number(isAtRisk(b)) - Number(isAtRisk(a));
  if (risk !== 0) return risk;
  const rank = (p: ProjectItem) =>
    p.statusGroup === 'in_progress' ? 0 : p.statusGroup === 'blocked' ? 1 : p.statusGroup === 'done' ? 3 : 2;
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  return a.title.localeCompare(b.title, 'hu');
}

function mergeStats(list: TaskStats[]): TaskStats {
  const out: TaskStats = { ...EMPTY_STATS };
  for (const s of list) {
    out.total += s.total;
    out.open += s.open;
    out.done += s.done;
    out.blocked += s.blocked;
    out.overdue += s.overdue;
    out.dueThisWeek += s.dueThisWeek;
    if (s.nextDue && (out.nextDue === null || s.nextDue < out.nextDue)) out.nextDue = s.nextDue;
  }
  return out;
}

export function getProject(id: string, ownerOnly = false): ProjectItem | null {
  const portfolio = getPortfolio(ownerOnly);
  return (
    portfolio.projects.find((p) => p.id === id) ??
    portfolio.projects.flatMap((p) => p.subprojects).find((s) => s.id === id) ??
    portfolio.orphanSubprojects.find((s) => s.id === id) ??
    null
  );
}
