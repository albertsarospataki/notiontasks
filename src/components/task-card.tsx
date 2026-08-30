import type { TaskItem } from '@/lib/view/types';
import { formatShort, relativeLabel, today } from '@/lib/util/date';
import { Badge, NotionLink, type Tone } from './ui';

const STATUS_TONE: Record<string, Tone> = {
  todo: 'neutral',
  in_progress: 'accent',
  blocked: 'warn',
  done: 'good',
  unknown: 'neutral',
};

const PRIORITY_TONE: Record<number, Tone> = { 0: 'danger', 1: 'warn', 2: 'neutral', 3: 'neutral' };

export function TaskCard({ task, showDue = true, compact = false }: { task: TaskItem; showDue?: boolean; compact?: boolean }) {
  const now = today();
  const overdue = task.due !== null && (task.dueEnd ?? task.due) < now && task.statusGroup !== 'done';

  return (
    <article
      className="surface rounded-md px-3 py-2"
      style={overdue ? { borderColor: 'var(--color-danger)' } : undefined}
    >
      <div className="flex items-start gap-2">
        {task.icon && !task.icon.startsWith('http') && <span aria-hidden>{task.icon}</span>}
        <div className="min-w-0 flex-1">
          <NotionLink url={task.url} className="block text-sm font-medium leading-snug">
            {task.title}
          </NotionLink>

          {!compact && task.nextStep && (
            <p className="soft mt-0.5 text-xs leading-snug">→ {task.nextStep}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {showDue && task.due && (
              <Badge tone={overdue ? 'danger' : 'neutral'} title={`Határidő: ${task.due}`}>
                {overdue ? relativeLabel(task.dueEnd ?? task.due, now) : formatShort(task.due)}
              </Badge>
            )}

            {task.status && <Badge tone={STATUS_TONE[task.statusGroup] ?? 'neutral'}>{task.status}</Badge>}

            {task.priority && task.priorityRank <= 1 && (
              <Badge tone={PRIORITY_TONE[task.priorityRank] ?? 'neutral'}>{task.priority}</Badge>
            )}

            {task.needsDecision && <Badge tone="warn">döntés kell</Badge>}

            {task.project && (
              <NotionLink url={task.project.url}>
                <Badge tone="accent" title="Projekt">
                  {task.project.title}
                </Badge>
              </NotionLink>
            )}

            {task.subproject && !task.project && (
              <NotionLink url={task.subproject.url}>
                <Badge tone="accent">{task.subproject.title}</Badge>
              </NotionLink>
            )}

            {task.organization && <Badge>{task.organization.title}</Badge>}

            {task.isOwner && <Badge tone="good" title="Albert saját feladata">saját</Badge>}

            {!compact &&
              task.tags.slice(0, 3).map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export function TaskList({ tasks, empty, compact = false, showDue = true, limit }: {
  tasks: TaskItem[];
  empty: string;
  compact?: boolean;
  showDue?: boolean;
  limit?: number;
}) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs"
         style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
        {empty}
      </p>
    );
  }

  const shown = limit ? tasks.slice(0, limit) : tasks;

  return (
    <div className="space-y-1.5">
      {shown.map((t) => (
        <TaskCard key={t.id} task={t} compact={compact} showDue={showDue} />
      ))}
      {limit && tasks.length > limit && (
        <p className="soft px-1 text-xs">… és további {tasks.length - limit} feladat</p>
      )}
    </div>
  );
}
