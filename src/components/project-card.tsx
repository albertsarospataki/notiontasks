import type { ProjectItem } from '@/lib/view/types';
import { isAtRisk } from '@/lib/view/projects';
import { formatShort, relativeLabel, today } from '@/lib/util/date';
import { Badge, NotionLink, type Tone } from './ui';

const STATUS_TONE: Record<string, Tone> = {
  todo: 'neutral', in_progress: 'accent', blocked: 'warn', done: 'good', unknown: 'neutral',
};

function healthTone(health: string | null): Tone {
  if (!health) return 'neutral';
  if (/piros|red|🔴/i.test(health)) return 'danger';
  if (/sárga|sarga|yellow|🟡/i.test(health)) return 'warn';
  if (/zöld|zold|green|🟢/i.test(health)) return 'good';
  return 'neutral';
}

export function ProjectCard({ project }: { project: ProjectItem }) {
  const risk = isAtRisk(project);
  const now = today();
  const s = project.taskStats;

  return (
    <article className="surface rounded-lg p-3" style={risk ? { borderColor: 'var(--color-danger)' } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <NotionLink url={project.url} className="text-sm font-semibold leading-snug">
            {project.icon && !project.icon.startsWith('http') && <span className="mr-1">{project.icon}</span>}
            {project.title}
          </NotionLink>
          {project.description && <p className="soft mt-0.5 line-clamp-2 text-xs">{project.description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {project.health && <Badge tone={healthTone(project.health)}>{project.health}</Badge>}
          {project.status && <Badge tone={STATUS_TONE[project.statusGroup] ?? 'neutral'}>{project.status}</Badge>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {project.area && <Badge tone="accent">{project.area}</Badge>}
        {project.category && <Badge>{project.category}</Badge>}
        {project.organizations.slice(0, 3).map((o) => (
          <NotionLink key={o.id} url={o.url}>
            <Badge>{o.title}</Badge>
          </NotionLink>
        ))}
      </div>

      {project.milestone && (
        <p className="mt-2 text-xs">
          <span className="soft">Mérföldkő: </span>
          {project.milestone}
          {project.milestoneDue && (
            <>
              {' '}
              <Badge tone={project.milestoneDue < now ? 'danger' : 'neutral'}>
                {project.milestoneDue < now ? relativeLabel(project.milestoneDue, now) : formatShort(project.milestoneDue)}
              </Badge>
            </>
          )}
        </p>
      )}

      {project.reviewDate && (
        <p className="soft mt-1 text-xs">
          Újraértékelés: {formatShort(project.reviewDate)}
          {project.reviewDate <= now && <span style={{ color: 'var(--color-warn)' }}> — esedékes</span>}
        </p>
      )}

      <div className="soft tabular mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        <span>{s.open} nyitott</span>
        {s.overdue > 0 && <span style={{ color: 'var(--color-danger)' }}>{s.overdue} lejárt</span>}
        {s.blocked > 0 && <span style={{ color: 'var(--color-warn)' }}>{s.blocked} blokkolt</span>}
        {s.dueThisWeek > 0 && <span>{s.dueThisWeek} e héten</span>}
        <span>{s.done} kész</span>
        {s.nextDue && <span>következő: {formatShort(s.nextDue)}</span>}
      </div>

      {project.subprojects.length > 0 && (
        <ul className="mt-2 space-y-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
          {project.subprojects.map((sub) => (
            <li key={sub.id} className="flex items-baseline justify-between gap-2 text-xs">
              <NotionLink url={sub.url} className="truncate">
                ↳ {sub.title}
              </NotionLink>
              <span className="soft tabular shrink-0 text-[11px]">
                {sub.taskStats.open} nyitott
                {sub.taskStats.overdue > 0 && (
                  <span style={{ color: 'var(--color-danger)' }}> · {sub.taskStats.overdue} lejárt</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
