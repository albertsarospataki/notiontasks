import Link from 'next/link';
import { isConfigured } from '@/lib/env';
import { env } from '@/lib/env';
import { listSuggestions, suggestionSummary } from '@/lib/insights/engine';
import { RULE_META } from '@/lib/insights/rules';
import { SEVERITY_LABELS, type Severity } from '@/lib/insights/types';
import { SuggestionList } from '@/components/suggestion-list';
import { WritebackLog } from '@/components/writeback-log';
import { SetupNotice } from '@/components/setup-notice';
import { SectionTitle, Stat } from '@/components/ui';
import type { SuggestionRecord } from '@/lib/insights/types';

export const dynamic = 'force-dynamic';

const STATUS_TABS: { key: SuggestionRecord['status']; label: string }[] = [
  { key: 'open', label: 'Nyitott' },
  { key: 'applied', label: 'Végrehajtva' },
  { key: 'dismissed', label: 'Elutasítva' },
  { key: 'stale', label: 'Megoldódott' },
];

export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; rule?: string }>;
}) {
  if (!isConfigured()) return <SetupNotice configured={false} hasDatabases={false} />;

  const params = await searchParams;
  const status = (STATUS_TABS.find((t) => t.key === params.status)?.key ?? 'open') as SuggestionRecord['status'];
  const rule = params.rule;

  const summary = suggestionSummary();
  const suggestions = listSuggestions({ status: [status], rules: rule ? [rule] : undefined });
  const ruleLabels = Object.fromEntries(RULE_META.map((r) => [r.id, r.label]));

  const severityCount = (s: Severity) => summary.bySeverity.find((x) => x.severity === s)?.count ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Javaslatok</h1>
        <p className="soft text-xs">
          A cockpit a teljes tükör alapján keres eltéréseket. Amit jóváhagysz, azt visszaírja a Notionbe.
          {env.writebackDryRun && (
            <span style={{ color: 'var(--color-warn)' }}> Próbaüzem aktív — a visszaírás csak naplózódik.</span>
          )}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Nyitott" value={summary.open} tone={summary.open ? 'accent' : 'good'} />
        <Stat label="Kritikus" value={severityCount('critical')} tone={severityCount('critical') ? 'danger' : 'neutral'} />
        <Stat label="Sürgős" value={severityCount('high')} tone={severityCount('high') ? 'danger' : 'neutral'} />
        <Stat label="Fontos" value={severityCount('medium')} tone={severityCount('medium') ? 'warn' : 'neutral'} />
        <Stat label="Végrehajtva" value={summary.appliedTotal} tone="good" />
        <Stat label="Elutasítva" value={summary.dismissedTotal} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/suggestions?status=${tab.key}${rule ? `&rule=${rule}` : ''}`}
            className="rounded px-2.5 py-1 text-xs font-medium"
            style={
              status === tab.key
                ? { background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }
                : { background: 'var(--color-muted-soft)', color: 'var(--text-soft)' }
            }
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {summary.byRule.length > 0 && status === 'open' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href="/suggestions"
            className="rounded px-2 py-0.5 text-[11px]"
            style={!rule
              ? { background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }
              : { background: 'var(--color-muted-soft)', color: 'var(--text-soft)' }}
          >
            mind
          </Link>
          {summary.byRule.map((r) => (
            <Link
              key={r.rule}
              href={`/suggestions?status=open&rule=${r.rule}`}
              className="rounded px-2 py-0.5 text-[11px]"
              style={rule === r.rule
                ? { background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }
                : { background: 'var(--color-muted-soft)', color: 'var(--text-soft)' }}
              title={RULE_META.find((m) => m.id === r.rule)?.description}
            >
              {ruleLabels[r.rule] ?? r.rule} <span className="tabular">{r.count}</span>
            </Link>
          ))}
        </div>
      )}

      <SuggestionList suggestions={suggestions} ruleLabels={ruleLabels} />

      <section>
        <SectionTitle hint="a Notionbe kiírt változtatások">Visszaírás-napló</SectionTitle>
        <WritebackLog />
      </section>
    </div>
  );
}
