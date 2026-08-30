import type { StatusGroup } from '@/lib/notion/properties';
import type { Role } from '@/lib/mapping/roles';

export interface PageRef {
  id: string;
  title: string;
  url: string | null;
  icon: string | null;
  role: Role | null;
}

export interface TaskItem {
  id: string;
  title: string;
  url: string | null;
  icon: string | null;
  databaseId: string;
  databaseTitle: string;
  status: string | null;
  statusGroup: StatusGroup;
  due: string | null;
  dueEnd: string | null;
  dueIsTime: boolean;
  start: string | null;
  priority: string | null;
  priorityRank: number;
  area: string | null;
  tags: string[];
  nextStep: string | null;
  background: string | null;
  isOwner: boolean;
  needsDecision: boolean;
  createdTime: string | null;
  lastEditedTime: string | null;
  project: PageRef | null;
  subproject: PageRef | null;
  organization: PageRef | null;
  assignees: PageRef[];
  contacts: PageRef[];
}

export interface ProjectItem {
  id: string;
  title: string;
  url: string | null;
  icon: string | null;
  databaseId: string;
  databaseTitle: string;
  role: 'project' | 'subproject';
  status: string | null;
  statusGroup: StatusGroup;
  area: string | null;
  category: string | null;
  health: string | null;
  milestone: string | null;
  milestoneDue: string | null;
  reviewDate: string | null;
  description: string | null;
  due: string | null;
  lastEditedTime: string | null;
  organizations: PageRef[];
  people: PageRef[];
  parentProject: PageRef | null;
  subprojects: ProjectItem[];
  taskStats: TaskStats;
}

export interface TaskStats {
  total: number;
  open: number;
  done: number;
  blocked: number;
  overdue: number;
  dueThisWeek: number;
  nextDue: string | null;
}

export const EMPTY_STATS: TaskStats = {
  total: 0, open: 0, done: 0, blocked: 0, overdue: 0, dueThisWeek: 0, nextDue: null,
};

export interface OrganizationItem {
  id: string;
  title: string;
  url: string | null;
  icon: string | null;
  databaseTitle: string;
  category: string | null;
  status: string | null;
  description: string | null;
  link: string | null;
  projects: PageRef[];
  people: PageRef[];
  taskStats: TaskStats;
}
