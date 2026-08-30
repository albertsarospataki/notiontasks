import Link from 'next/link';
import { isConfigured } from '@/lib/env';
import { getMonthView, hasTaskDatabases } from '@/lib/view/tasks';
import { addMonths, dayName, eachDay, monthName, parseDayKey, today } from '@/lib/util/date';
import { OwnerToggle } from '@/components/owner-toggle';
import { PeriodNav } from '@/components/period-nav';
import { SetupNotice } from '@/components/setup-notice';
import { Badge, NotionLink, SectionTitle } from '@/components/ui';
import { TaskList } from '@/components/task-card';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

export default async function MonthPage({
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

  const view = getMonthView(anchor, ownerOnly);
  const now = today();
  const days = eachDay(view.gridStart, view.gridEnd);
  const monthLabel = `${parseDayKey(view.monthStart).getFullYear()}. ${monthName(view.monthStart)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{monthLabel}</h1>
          <p className="soft text-xs">{view.total} határidős feladat ebben a nézetben</p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodNav
            prev={addMonths(view.monthStart, -1)}
            next={addMonths(view.monthStart, 1)}
            current={now}
            label={monthName(view.monthStart)}
          />
          <OwnerToggle />
        </div>
      </div>

      <div className="scroll-x -mx-1 px-1">
        <div className="min-w-[900px]">
          <div className="mb-1 grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((d) => (
              <div key={d} className="soft px-1 text-[11px] font-medium uppercase">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {days.map((day) => {
              const tasks = view.byDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === view.monthStart.slice(0, 7);
              const isToday = day === now;
              const overdueCount = tasks.filter((t) => t.statusGroup !== 'done' && day < now).length;

              return (
                <div
                  key={day}
                  className="surface min-h-[104px] rounded-md p-1.5"
                  style={{
                    borderColor: isToday ? 'var(--color-accent)' : 'var(--border)',
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  <div className="mb-1 flex items-baseline justify-between">
                    <span
                      className="tabular text-[11px] font-semibold"
                      style={isToday ? { color: 'var(--color-accent)' } : undefined}
                      title={dayName(day)}
                    >
                      {parseDayKey(day).getDate()}
                    </span>
                    {tasks.length > 0 && (
                      <Badge tone={overdueCount > 0 ? 'danger' : tasks.length >= 8 ? 'warn' : 'neutral'}>
                        {tasks.length}
                      </Badge>
                    )}
                  </div>

                  <ul className="space-y-0.5">
                    {tasks.slice(0, 4).map((t) => (
                      <li key={t.id} className="truncate text-[11px] leading-tight">
                        <NotionLink url={t.url} className={t.statusGroup === 'done' ? 'soft line-through' : ''}>
                          {t.priorityRank === 0 && <span style={{ color: 'var(--color-danger)' }}>• </span>}
                          {t.title}
                        </NotionLink>
                      </li>
                    ))}
                    {tasks.length > 4 && (
                      <li className="soft text-[11px]">
                        <Link href={`/week?d=${day}${ownerOnly ? '&owner=1' : ''}`}>+{tasks.length - 4} további</Link>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {view.undated.length > 0 && (
        <section>
          <SectionTitle count={view.undated.length}>Nincs határidejük</SectionTitle>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {view.undated.slice(0, 24).map((t) => (
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
