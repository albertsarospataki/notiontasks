import { isConfigured } from '@/lib/env';
import { getDayView, hasTaskDatabases, listTasks, summarize } from '@/lib/view/tasks';
import { getPortfolio } from '@/lib/view/projects';
import { listSuggestions, suggestionSummary } from '@/lib/insights/engine';
import { formatLong, today } from '@/lib/util/date';
import { TaskList } from '@/components/task-card';
import { OwnerToggle } from '@/components/owner-toggle';
import { SetupNotice } from '@/components/setup-notice';
import { Card, Empty, SectionTitle, Stat, NotionLink, Badge } from '@/components/ui';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const params = await searchParams;
  const ownerOnly = params.owner === '1';

  if (!isConfigured() || !hasTaskDatabases()) {
    return <SetupNotice configured={isConfigured()} hasDatabases={hasTaskDatabases()} />;
  }

  const day = today();
  const view = getDayView(day, ownerOnly);
  const allOpen = listTasks({ ownerOnly, openOnly: true });
  const stats = summarize(allOpen, day);
  const portfolio = getPortfolio(ownerOnly);
  const suggestions = suggestionSummary();
  const topSuggestions = listSuggestions({ severities: ['critical', 'high'], limit: 5 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{formatLong(day)}</h1>
          <p className="soft text-xs">
            {view.dueToday.length} mai · {view.overdue.length} lejárt · {stats.open} nyitott összesen
          </p>
        </div>
        <OwnerToggle />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Ma esedékes" value={view.dueToday.length} tone={view.dueToday.length > 0 ? 'accent' : 'neutral'} />
        <Stat label="Lejárt" value={view.overdue.length} tone={view.overdue.length > 0 ? 'danger' : 'good'} />
        <Stat label="Folyamatban" value={view.inProgress.length} />
        <Stat label="Blokkolt" value={stats.blocked} tone={stats.blocked > 0 ? 'warn' : 'neutral'} />
        <Stat label="Veszélyes projekt" value={portfolio.stats.atRisk} tone={portfolio.stats.atRisk > 0 ? 'danger' : 'good'} />
        <Stat label="Nyitott javaslat" value={suggestions.open} hint="a Javaslatok fülön" />
      </section>

      {topSuggestions.length > 0 && (
        <section>
          <SectionTitle count={suggestions.open} hint="a legsürgősebbek">
            Amire ma érdemes ránézni
          </SectionTitle>
          <Card className="divide-y">
            {topSuggestions.map((s) => (
              <div key={s.id} className="px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-start gap-2">
                  <Badge tone={s.severity === 'critical' ? 'danger' : 'warn'}>
                    {s.severity === 'critical' ? 'kritikus' : 'sürgős'}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="soft mt-0.5 line-clamp-2 text-xs whitespace-pre-line">{s.detail}</p>
                  </div>
                  {s.page?.url && (
                    <NotionLink url={s.page.url} className="soft text-xs">
                      Notion ↗
                    </NotionLink>
                  )}
                </div>
              </div>
            ))}
            <div className="px-3 py-2">
              <Link href="/suggestions" className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
                Összes javaslat és visszaírás →
              </Link>
            </div>
          </Card>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle count={view.overdue.length}>Lejárt</SectionTitle>
          <TaskList tasks={view.overdue} empty="Nincs lejárt feladat. Ritka és jó hír." limit={25} />
        </section>

        <section>
          <SectionTitle count={view.dueToday.length}>Mai határidő</SectionTitle>
          <TaskList tasks={view.dueToday} empty="Ma nincs határidős feladat." />
        </section>

        <section>
          <SectionTitle count={view.inProgress.length}>Folyamatban</SectionTitle>
          <TaskList tasks={view.inProgress} empty="Semmi sincs folyamatban jelölve." limit={20} />
        </section>

        <section>
          <SectionTitle count={view.needsDecision.length} hint="döntésre vár">
            Döntést igényel
          </SectionTitle>
          <TaskList tasks={view.needsDecision} empty="Nincs döntésre váró feladat." limit={15} />
        </section>

        <section>
          <SectionTitle count={view.unscheduledHighPriority.length} hint="magas prioritás, nincs dátum">
            Dátum nélküli sürgős
          </SectionTitle>
          <TaskList tasks={view.unscheduledHighPriority} empty="Minden magas prioritású feladatnak van dátuma." limit={15} />
        </section>

        <section>
          <SectionTitle count={view.completedToday.length}>Ma elkészült</SectionTitle>
          {view.completedToday.length === 0 ? (
            <Empty>Ma még nem zárult le feladat.</Empty>
          ) : (
            <TaskList tasks={view.completedToday} empty="" compact showDue={false} limit={15} />
          )}
        </section>
      </div>
    </div>
  );
}
