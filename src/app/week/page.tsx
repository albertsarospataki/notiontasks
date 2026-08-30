import { isConfigured } from '@/lib/env';
import { getWeekView, hasTaskDatabases } from '@/lib/view/tasks';
import { addDays, dayName, formatShort, isoWeek, today } from '@/lib/util/date';
import { TaskList } from '@/components/task-card';
import { OwnerToggle } from '@/components/owner-toggle';
import { PeriodNav } from '@/components/period-nav';
import { SetupNotice } from '@/components/setup-notice';
import { SectionTitle } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; d?: string }>;
}) {
  const params = await searchParams;
  const ownerOnly = params.owner === '1';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.d ?? '') ? params.d! : today();

  if (!isConfigured() || !hasTaskDatabases()) {
    return <SetupNotice configured={isConfigured()} hasDatabases={hasTaskDatabases()} />;
  }

  const view = getWeekView(anchor, ownerOnly);
  const now = today();
  const total = view.days.reduce((sum, d) => sum + d.tasks.length, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {isoWeek(view.weekStart)}. hét — {formatShort(view.weekStart)} – {formatShort(view.weekEnd)}
          </h1>
          <p className="soft text-xs">
            {total} feladat a héten · {view.overdue.length} korábbról lejárt
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodNav
            prev={addDays(view.weekStart, -7)}
            next={addDays(view.weekStart, 7)}
            current={now}
            label={`${isoWeek(view.weekStart)}. hét`}
          />
          <OwnerToggle />
        </div>
      </div>

      {view.overdue.length > 0 && (
        <section>
          <SectionTitle count={view.overdue.length} hint="a hét kezdete előttről">
            Behozandó
          </SectionTitle>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {view.overdue.slice(0, 12).map((t) => (
              <div key={t.id}>
                <TaskList tasks={[t]} empty="" compact />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="scroll-x -mx-1 px-1 pb-2">
        <div className="grid min-w-[900px] grid-cols-7 gap-2">
          {view.days.map(({ day, tasks }) => {
            const isToday = day === now;
            const weekend = [0, 6].includes(new Date(day).getDay());
            return (
              <section
                key={day}
                className="surface rounded-lg p-2"
                style={{
                  borderColor: isToday ? 'var(--color-accent)' : 'var(--border)',
                  opacity: weekend && tasks.length === 0 ? 0.6 : 1,
                }}
              >
                <header className="mb-2 flex items-baseline justify-between">
                  <span className="text-xs font-semibold" style={isToday ? { color: 'var(--color-accent)' } : undefined}>
                    {dayName(day, true)} {formatShort(day)}
                  </span>
                  <span className="soft tabular text-[11px]">{tasks.length}</span>
                </header>
                <TaskList tasks={tasks} empty="—" compact showDue={false} />
              </section>
            );
          })}
        </div>
      </div>

      {view.undated.length > 0 && (
        <section>
          <SectionTitle count={view.undated.length} hint="nem esik egyik napra sem">
            Dátum nélküli nyitott feladatok
          </SectionTitle>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {view.undated.slice(0, 18).map((t) => (
              <div key={t.id}>
                <TaskList tasks={[t]} empty="" compact showDue={false} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
