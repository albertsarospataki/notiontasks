import { db } from '@/lib/db/client';
import type { StatusGroup } from '@/lib/notion/properties';
import { listMappedDatabases } from '@/lib/mapping/store';
import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek, today, type DayKey } from '@/lib/util/date';
import type { PageRef, TaskItem, TaskStats } from './types';
import { EMPTY_STATS } from './types';

/**
 * Feladat-lekérdezések a helyi tükörből.
 *
 * Minden nézet ugyanabból a `page` táblából dolgozik, a `task` szerepű
 * adatbázisokra szűkítve — tehát bármely új feladat-adatbázis automatikusan
 * megjelenik a napi/heti/havi nézetben, amint a szinkron besorolta.
 */

interface PageRow {
  id: string;
  database_id: string;
  title: string;
  url: string | null;
  icon: string | null;
  c_status: string | null;
  c_status_group: string | null;
  c_due: string | null;
  c_due_end: string | null;
  c_due_is_time: number;
  c_start: string | null;
  c_priority: string | null;
  c_priority_rank: number | null;
  c_area: string | null;
  c_tags: string | null;
  c_next_step: string | null;
  c_background: string | null;
  c_is_owner: number;
  c_needs_decision: number;
  created_time: string | null;
  last_edited_time: string | null;
}

export interface TaskFilter {
  /** Csak Albert saját feladatai. */
  ownerOnly?: boolean;
  /** Csak nyitott (nem kész) feladatok. */
  openOnly?: boolean;
  statusGroups?: StatusGroup[];
  /** Határidő tartomány (bezárólag). */
  dueFrom?: DayKey;
  dueTo?: DayKey;
  /** Határidő nélküli feladatok is kellenek? */
  includeUndated?: boolean;
  projectId?: string;
  organizationId?: string;
  databaseIds?: string[];
  area?: string;
  search?: string;
  limit?: number;
}

function taskDatabaseIds(): string[] {
  return listMappedDatabases()
    .filter((d) => d.role === 'task' && d.includeInDashboard)
    .map((d) => d.id);
}

export function hasTaskDatabases(): boolean {
  return taskDatabaseIds().length > 0;
}

/** A feladatokat egy lekérdezéssel hozzuk, a kapcsolatokat utána, kötegelve. */
export function listTasks(filter: TaskFilter = {}): TaskItem[] {
  const conn = db();
  const dbIds = filter.databaseIds?.length
    ? filter.databaseIds.filter((id) => taskDatabaseIds().includes(id))
    : taskDatabaseIds();
  if (dbIds.length === 0) return [];

  const where: string[] = [
    `p.database_id IN (${dbIds.map(() => '?').join(',')})`,
    'p.archived = 0',
    'p.in_trash = 0',
  ];
  const params: unknown[] = [...dbIds];

  if (filter.ownerOnly) where.push('p.c_is_owner = 1');
  if (filter.openOnly) where.push("(p.c_status_group IS NULL OR p.c_status_group <> 'done')");

  if (filter.statusGroups?.length) {
    where.push(`p.c_status_group IN (${filter.statusGroups.map(() => '?').join(',')})`);
    params.push(...filter.statusGroups);
  }

  if (filter.dueFrom || filter.dueTo) {
    const clauses: string[] = [];
    // Tartomány-határidőnél az a feladat is beleesik, amelyik átnyúlik az intervallumon.
    const rangeClause = 'COALESCE(p.c_due_end, p.c_due) >= ? AND p.c_due <= ?';
    clauses.push(rangeClause);
    params.push(filter.dueFrom ?? '0000-01-01', filter.dueTo ?? '9999-12-31');
    if (filter.includeUndated) clauses.push('p.c_due IS NULL');
    where.push(`(${clauses.join(' OR ')})`);
  } else if (filter.includeUndated === false) {
    where.push('p.c_due IS NOT NULL');
  }

  if (filter.area) {
    where.push('p.c_area = ?');
    params.push(filter.area);
  }

  if (filter.search) {
    where.push('(LOWER(p.title) LIKE ? OR LOWER(COALESCE(p.c_next_step, "")) LIKE ?)');
    const q = `%${filter.search.toLowerCase()}%`;
    params.push(q, q);
  }

  if (filter.projectId) {
    where.push(`p.id IN (SELECT from_page_id FROM page_relation
                          WHERE to_page_id = ? AND canonical IN ('project', 'subproject'))`);
    params.push(filter.projectId);
  }

  if (filter.organizationId) {
    where.push(`p.id IN (SELECT from_page_id FROM page_relation
                          WHERE to_page_id = ? AND canonical = 'organization')`);
    params.push(filter.organizationId);
  }

  const limit = filter.limit ?? 2000;

  const rows = conn
    .prepare<unknown[], PageRow>(
      `SELECT p.* FROM page p
       WHERE ${where.join(' AND ')}
       ORDER BY (p.c_due IS NULL), p.c_due ASC,
                COALESCE(p.c_priority_rank, 2) ASC,
                p.title COLLATE NOCASE
       LIMIT ${limit}`,
    )
    .all(...params);

  return hydrate(rows);
}

/** Kapcsolatok feloldása kötegelten — így nincs N+1 lekérdezés. */
function hydrate(rows: PageRow[]): TaskItem[] {
  if (rows.length === 0) return [];
  const conn = db();
  const dbTitles = new Map(listMappedDatabases().map((d) => [d.id, d]));
  const ids = rows.map((r) => r.id);

  const relations = chunked(ids, 400).flatMap((chunk) =>
    conn
      .prepare<string[], { from_page_id: string; canonical: string | null; to_page_id: string }>(
        `SELECT from_page_id, canonical, to_page_id FROM page_relation
         WHERE from_page_id IN (${chunk.map(() => '?').join(',')})
           AND canonical IS NOT NULL`,
      )
      .all(...chunk),
  );

  const refs = loadPageRefs(relations.map((r) => r.to_page_id));

  const byPage = new Map<string, Map<string, PageRef[]>>();
  for (const rel of relations) {
    const ref = refs.get(rel.to_page_id);
    if (!ref || !rel.canonical) continue;
    let m = byPage.get(rel.from_page_id);
    if (!m) {
      m = new Map();
      byPage.set(rel.from_page_id, m);
    }
    const list = m.get(rel.canonical) ?? [];
    list.push(ref);
    m.set(rel.canonical, list);
  }

  return rows.map((r) => {
    const rel = byPage.get(r.id);
    const mapped = dbTitles.get(r.database_id);
    return {
      id: r.id,
      title: r.title || '(névtelen)',
      url: r.url,
      icon: r.icon,
      databaseId: r.database_id,
      databaseTitle: mapped?.title ?? 'Ismeretlen adatbázis',
      status: r.c_status,
      statusGroup: (r.c_status_group as StatusGroup | null) ?? 'unknown',
      due: r.c_due,
      dueEnd: r.c_due_end,
      dueIsTime: r.c_due_is_time === 1,
      start: r.c_start,
      priority: r.c_priority,
      priorityRank: r.c_priority_rank ?? 2,
      area: r.c_area,
      tags: parseTags(r.c_tags),
      nextStep: r.c_next_step,
      background: r.c_background,
      isOwner: r.c_is_owner === 1,
      needsDecision: r.c_needs_decision === 1,
      createdTime: r.created_time,
      lastEditedTime: r.last_edited_time,
      project: rel?.get('project')?.[0] ?? null,
      subproject: rel?.get('subproject')?.[0] ?? null,
      organization: rel?.get('organization')?.[0] ?? null,
      assignees: rel?.get('assignee') ?? [],
      contacts: rel?.get('contact') ?? [],
    };
  });
}

export function loadPageRefs(ids: string[]): Map<string, PageRef> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const conn = db();
  const roleByDb = new Map(listMappedDatabases().map((d) => [d.id, d.role]));

  const rows = chunked(unique, 400).flatMap((chunk) =>
    conn
      .prepare<string[], { id: string; title: string; url: string | null; icon: string | null; database_id: string }>(
        `SELECT id, title, url, icon, database_id FROM page WHERE id IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(...chunk),
  );

  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, title: r.title || '(névtelen)', url: r.url, icon: r.icon, role: roleByDb.get(r.database_id) ?? null },
    ]),
  );
}

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

// ── Nézetek ───────────────────────────────────────────────────────────────────

export interface DayView {
  day: DayKey;
  overdue: TaskItem[];
  dueToday: TaskItem[];
  inProgress: TaskItem[];
  needsDecision: TaskItem[];
  unscheduledHighPriority: TaskItem[];
  completedToday: TaskItem[];
}

export function getDayView(day: DayKey = today(), ownerOnly = false): DayView {
  const open = listTasks({ ownerOnly, openOnly: true });
  const doneRecently = listTasks({ ownerOnly, statusGroups: ['done'], limit: 500 });

  const overdue = open.filter((t) => t.due !== null && (t.dueEnd ?? t.due) < day);
  const dueToday = open.filter((t) => t.due !== null && t.due <= day && (t.dueEnd ?? t.due) >= day);
  const inProgress = open.filter((t) => t.statusGroup === 'in_progress' && !dueToday.includes(t) && !overdue.includes(t));

  return {
    day,
    overdue,
    dueToday,
    inProgress,
    needsDecision: open.filter((t) => t.needsDecision),
    unscheduledHighPriority: open.filter((t) => t.due === null && t.priorityRank === 0),
    completedToday: doneRecently.filter((t) => t.lastEditedTime?.slice(0, 10) === day),
  };
}

export interface WeekView {
  weekStart: DayKey;
  weekEnd: DayKey;
  days: { day: DayKey; tasks: TaskItem[] }[];
  overdue: TaskItem[];
  undated: TaskItem[];
}

export function getWeekView(anchor: DayKey = today(), ownerOnly = false): WeekView {
  const weekStart = startOfWeek(anchor);
  const weekEnd = endOfWeek(anchor);

  const inWeek = listTasks({ ownerOnly, openOnly: false, dueFrom: weekStart, dueTo: weekEnd });
  const open = listTasks({ ownerOnly, openOnly: true });

  const days: { day: DayKey; tasks: TaskItem[] }[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    days.push({
      day,
      tasks: inWeek.filter((t) => t.due !== null && t.due <= day && (t.dueEnd ?? t.due) >= day),
    });
  }

  return {
    weekStart,
    weekEnd,
    days,
    overdue: open.filter((t) => t.due !== null && (t.dueEnd ?? t.due) < weekStart),
    undated: open.filter((t) => t.due === null).slice(0, 50),
  };
}

export interface MonthView {
  monthStart: DayKey;
  monthEnd: DayKey;
  gridStart: DayKey;
  gridEnd: DayKey;
  byDay: Map<DayKey, TaskItem[]>;
  total: number;
  undated: TaskItem[];
}

export function getMonthView(anchor: DayKey = today(), ownerOnly = false): MonthView {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  const tasks = listTasks({ ownerOnly, dueFrom: gridStart, dueTo: gridEnd });
  const byDay = new Map<DayKey, TaskItem[]>();
  for (const t of tasks) {
    if (!t.due) continue;
    const last = t.dueEnd ?? t.due;
    for (let d = t.due; d <= last && d <= gridEnd; d = addDays(d, 1)) {
      if (d < gridStart) continue;
      const list = byDay.get(d) ?? [];
      list.push(t);
      byDay.set(d, list);
    }
  }

  return {
    monthStart, monthEnd, gridStart, gridEnd, byDay,
    total: tasks.length,
    undated: listTasks({ ownerOnly, openOnly: true }).filter((t) => t.due === null),
  };
}

/** Feladat-statisztika egy tetszőleges halmazra. */
export function summarize(tasks: TaskItem[], from: DayKey = today()): TaskStats {
  if (tasks.length === 0) return { ...EMPTY_STATS };
  const weekEnd = endOfWeek(from);
  let open = 0, done = 0, blocked = 0, overdue = 0, dueThisWeek = 0;
  let nextDue: string | null = null;

  for (const t of tasks) {
    if (t.statusGroup === 'done') { done += 1; continue; }
    open += 1;
    if (t.statusGroup === 'blocked') blocked += 1;
    if (t.due) {
      if ((t.dueEnd ?? t.due) < from) overdue += 1;
      else {
        if (t.due <= weekEnd) dueThisWeek += 1;
        if (nextDue === null || t.due < nextDue) nextDue = t.due;
      }
    }
  }

  return { total: tasks.length, open, done, blocked, overdue, dueThisWeek, nextDue };
}
