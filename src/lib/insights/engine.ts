import { db } from '@/lib/db/client';
import { listMappedDatabases, needsReview } from '@/lib/mapping/store';
import { applyAction } from '@/lib/notion/writeback';
import { today } from '@/lib/util/date';
import { getOrganizations } from '@/lib/view/organizations';
import { getPortfolio } from '@/lib/view/projects';
import { listTasks } from '@/lib/view/tasks';
import { runRules, type RuleContext } from './rules';
import { SEVERITY_ORDER, type Severity, type SuggestionDraft, type SuggestionRecord, type WritebackAction } from './types';

/**
 * A javaslat-motor.
 *
 * A szabályok minden futásnál a teljes aktuális állapotból dolgoznak. Az
 * eredményt összevetjük a tárolt javaslatokkal:
 *  - új azonosító → új nyitott javaslat,
 *  - meglévő nyitott → frissül a szövege, marad nyitott,
 *  - eltűnt nyitott → `stale` (a probléma megoldódott, nem kell mutatni),
 *  - `dismissed` / `applied` → érintetlen marad, nem éled újra.
 */

export interface GenerateResult {
  created: number;
  updated: number;
  stale: number;
  open: number;
}

export function buildContext(): RuleContext {
  return {
    today: today(),
    tasks: listTasks({ limit: 5000 }),
    portfolio: getPortfolio(),
    organizations: getOrganizations(),
    databases: listMappedDatabases(),
    unreviewed: needsReview(),
  };
}

export function generateSuggestions(): GenerateResult {
  const conn = db();
  const now = new Date().toISOString();
  const drafts = runRules(buildContext());

  const existing = new Map(
    conn
      .prepare<[], { id: string; status: string }>('SELECT id, status FROM suggestion')
      .all()
      .map((r) => [r.id, r.status]),
  );

  const upsert = conn.prepare(`
    INSERT INTO suggestion (id, rule, severity, title, detail, page_id, database_id, action_json,
                            status, created_at, updated_at, last_seen_at)
    VALUES (@id, @rule, @severity, @title, @detail, @page_id, @database_id, @action_json,
            'open', @now, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      severity     = excluded.severity,
      title        = excluded.title,
      detail       = excluded.detail,
      action_json  = excluded.action_json,
      updated_at   = excluded.updated_at,
      last_seen_at = excluded.last_seen_at,
      -- Egy elavultnak jelölt javaslat újra megnyílik, ha a probléma visszatér.
      status       = CASE WHEN suggestion.status = 'stale' THEN 'open' ELSE suggestion.status END
  `);

  let created = 0;
  let updated = 0;

  const tx = conn.transaction(() => {
    for (const d of drafts) {
      if (!existing.has(d.id)) created += 1;
      else updated += 1;
      upsert.run({
        id: d.id,
        rule: d.rule,
        severity: d.severity,
        title: d.title,
        detail: d.detail,
        page_id: d.pageId,
        database_id: d.databaseId,
        action_json: d.action ? JSON.stringify(d.action) : null,
        now,
      });
    }

    // Ami már nem áll fenn: elavult.
    const seen = new Set(drafts.map((d) => d.id));
    const openIds = [...existing.entries()].filter(([, s]) => s === 'open').map(([id]) => id);
    const gone = openIds.filter((id) => !seen.has(id));
    if (gone.length) {
      const mark = conn.prepare("UPDATE suggestion SET status = 'stale', resolved_at = ?, updated_at = ? WHERE id = ?");
      for (const id of gone) mark.run(now, now, id);
    }
  });

  tx();

  const staleCount = conn
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM suggestion WHERE status = 'stale'")
    .get()?.n ?? 0;
  const openCount = conn
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM suggestion WHERE status = 'open'")
    .get()?.n ?? 0;

  return { created, updated, stale: staleCount, open: openCount };
}

// ── Lekérdezés ────────────────────────────────────────────────────────────────

export interface SuggestionFilter {
  status?: SuggestionRecord['status'][];
  rules?: string[];
  severities?: Severity[];
  pageId?: string;
  databaseId?: string;
  limit?: number;
}

interface SuggestionRow {
  id: string;
  rule: string;
  severity: string;
  title: string;
  detail: string | null;
  page_id: string | null;
  database_id: string | null;
  action_json: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  dismiss_reason: string | null;
  page_title: string | null;
  page_url: string | null;
  db_title: string | null;
}

export function listSuggestions(filter: SuggestionFilter = {}): SuggestionRecord[] {
  const conn = db();
  const where: string[] = [];
  const params: unknown[] = [];

  const statuses = filter.status ?? ['open'];
  where.push(`s.status IN (${statuses.map(() => '?').join(',')})`);
  params.push(...statuses);

  if (filter.rules?.length) {
    where.push(`s.rule IN (${filter.rules.map(() => '?').join(',')})`);
    params.push(...filter.rules);
  }
  if (filter.severities?.length) {
    where.push(`s.severity IN (${filter.severities.map(() => '?').join(',')})`);
    params.push(...filter.severities);
  }
  if (filter.pageId) {
    where.push('s.page_id = ?');
    params.push(filter.pageId);
  }
  if (filter.databaseId) {
    where.push('s.database_id = ?');
    params.push(filter.databaseId);
  }

  const rows = conn
    .prepare<unknown[], SuggestionRow>(
      `SELECT s.*, p.title AS page_title, p.url AS page_url, d.title AS db_title
       FROM suggestion s
       LEFT JOIN page p ON p.id = s.page_id
       LEFT JOIN notion_database d ON d.id = s.database_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE s.severity
                  WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
                  WHEN 'low' THEN 3 ELSE 4 END,
                s.updated_at DESC
       LIMIT ${filter.limit ?? 400}`,
    )
    .all(...params);

  return rows.map(toRecord);
}

function toRecord(r: SuggestionRow): SuggestionRecord {
  let action: WritebackAction | null = null;
  if (r.action_json) {
    try {
      action = JSON.parse(r.action_json) as WritebackAction;
    } catch {
      action = null;
    }
  }
  return {
    id: r.id,
    rule: r.rule,
    severity: r.severity as Severity,
    title: r.title,
    detail: r.detail ?? '',
    pageId: r.page_id,
    databaseId: r.database_id,
    action,
    status: r.status as SuggestionRecord['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastSeenAt: r.last_seen_at,
    resolvedAt: r.resolved_at,
    dismissReason: r.dismiss_reason,
    page: r.page_id
      ? { id: r.page_id, title: r.page_title ?? '(ismeretlen oldal)', url: r.page_url, databaseTitle: r.db_title ?? '' }
      : null,
  };
}

export function getSuggestion(id: string): SuggestionRecord | null {
  const row = db()
    .prepare<[string], SuggestionRow>(
      `SELECT s.*, p.title AS page_title, p.url AS page_url, d.title AS db_title
       FROM suggestion s
       LEFT JOIN page p ON p.id = s.page_id
       LEFT JOIN notion_database d ON d.id = s.database_id
       WHERE s.id = ?`,
    )
    .get(id);
  return row ? toRecord(row) : null;
}

export interface SuggestionSummary {
  open: number;
  bySeverity: { severity: Severity; count: number }[];
  byRule: { rule: string; count: number }[];
  appliedTotal: number;
  dismissedTotal: number;
}

export function suggestionSummary(): SuggestionSummary {
  const conn = db();
  const bySeverity = conn
    .prepare<[], { severity: string; count: number }>(
      "SELECT severity, COUNT(*) AS count FROM suggestion WHERE status = 'open' GROUP BY severity",
    )
    .all()
    .map((r) => ({ severity: r.severity as Severity, count: r.count }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const byRule = conn
    .prepare<[], { rule: string; count: number }>(
      "SELECT rule, COUNT(*) AS count FROM suggestion WHERE status = 'open' GROUP BY rule ORDER BY count DESC",
    )
    .all();

  const totals = conn
    .prepare<[], { open: number; applied: number; dismissed: number }>(
      `SELECT
         SUM(status = 'open')      AS open,
         SUM(status = 'applied')   AS applied,
         SUM(status = 'dismissed') AS dismissed
       FROM suggestion`,
    )
    .get();

  return {
    open: totals?.open ?? 0,
    bySeverity,
    byRule,
    appliedTotal: totals?.applied ?? 0,
    dismissedTotal: totals?.dismissed ?? 0,
  };
}

// ── Műveletek ─────────────────────────────────────────────────────────────────

export interface ApplyResult {
  ok: boolean;
  message: string;
  suggestion: SuggestionRecord | null;
}

/** Jóváhagyott javaslat végrehajtása: visszaírás a Notionbe. */
export async function applySuggestion(id: string): Promise<ApplyResult> {
  const suggestion = getSuggestion(id);
  if (!suggestion) return { ok: false, message: 'Nincs ilyen javaslat.', suggestion: null };
  if (!suggestion.action) {
    return { ok: false, message: 'Ehhez a javaslathoz nem tartozik automatikus művelet — a döntés emberé.', suggestion };
  }
  if (suggestion.status === 'applied') {
    return { ok: false, message: 'Ez a javaslat már végre lett hajtva.', suggestion };
  }

  const result = await applyAction(suggestion.action, suggestion.id);
  const now = new Date().toISOString();

  if (result.status === 'error') {
    return { ok: false, message: result.message, suggestion };
  }

  db()
    .prepare("UPDATE suggestion SET status = 'applied', resolved_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, id);

  return { ok: true, message: result.message, suggestion: getSuggestion(id) };
}

export function dismissSuggestion(id: string, reason?: string): ApplyResult {
  const suggestion = getSuggestion(id);
  if (!suggestion) return { ok: false, message: 'Nincs ilyen javaslat.', suggestion: null };

  const now = new Date().toISOString();
  db()
    .prepare("UPDATE suggestion SET status = 'dismissed', dismiss_reason = ?, resolved_at = ?, updated_at = ? WHERE id = ?")
    .run(reason ?? null, now, now, id);

  return { ok: true, message: 'Javaslat elutasítva — nem fog újra felbukkanni.', suggestion: getSuggestion(id) };
}

export function reopenSuggestion(id: string): ApplyResult {
  const suggestion = getSuggestion(id);
  if (!suggestion) return { ok: false, message: 'Nincs ilyen javaslat.', suggestion: null };

  db()
    .prepare("UPDATE suggestion SET status = 'open', dismiss_reason = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);

  return { ok: true, message: 'Javaslat újra megnyitva.', suggestion: getSuggestion(id) };
}
