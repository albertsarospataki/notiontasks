/**
 * Szerepek és kanonikus mezők.
 *
 * A cockpit nem ismeri előre a Notion-adatbázisok neveit. Ehelyett minden
 * adatbázishoz *szerepet* (role) rendel, és a szerephez tartozó *kanonikus
 * mezőket* képezi le a tényleges Notion-property nevekre. Így egy új
 * "Feladatok 2026" adatbázis ugyanúgy működik, mint a régi, és a felhasználó
 * bármikor felülírhatja a találgatást.
 */

export const ROLES = [
  'task',
  'project',
  'subproject',
  'organization',
  'person',
  'decision',
  'question',
  'log',
  'note',
  'other',
  'ignored',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  task: 'Feladatok',
  project: 'Projektek',
  subproject: 'Alprojektek',
  organization: 'Szervezetek / cégek',
  person: 'Kapcsolatok / emberek',
  decision: 'Döntések',
  question: 'Nyitott kérdések',
  log: 'Naplók / interakciók',
  note: 'Jegyzetek / tudástár',
  other: 'Egyéb',
  ignored: 'Kihagyva',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  task: 'Konkrét, elvégzendő tételek. Ezek adják a napi/heti/havi nézetet.',
  project: 'Nagyobb kezdeményezések, amelyekhez feladatok tartoznak.',
  subproject: 'Projekten belüli munkafolyamok.',
  organization: 'Cégek, intézmények, partnerek.',
  person: 'Emberek — felelősök, kulcsemberek, kapcsolatok.',
  decision: 'Meghozandó vagy meghozott döntések.',
  question: 'Tisztázatlan, választ igénylő kérdések.',
  log: 'Időbélyeges bejegyzések: interakciók, futásnaplók, események.',
  note: 'Szöveges tudástár, amelyből nem lesz feladat.',
  other: 'Besorolatlan — a cockpit tükrözi, de nem értelmezi.',
  ignored: 'Szándékosan kihagyva a szinkronból és a nézetekből.',
};

/** Azok a szerepek, amelyeknek van saját nézete a felületen. */
export const PRIMARY_ROLES: Role[] = ['task', 'project', 'subproject', 'organization', 'person'];

// ── Kanonikus mezők ───────────────────────────────────────────────────────────

export const CANONICAL_FIELDS = [
  'title',
  'status',
  'due',
  'start',
  'priority',
  'assignee',
  'people',
  'project',
  'subproject',
  'organization',
  'contact',
  'tasks',
  'subprojects',
  'tags',
  'area',
  'category',
  'health',
  'nextStep',
  'background',
  'needsDecision',
  'source',
  'milestone',
  'milestoneDue',
  'reviewDate',
  'description',
  'isKey',
  'email',
  'link',
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export const FIELD_LABELS: Record<CanonicalField, string> = {
  title: 'Cím',
  status: 'Státusz',
  due: 'Határidő',
  start: 'Kezdés',
  priority: 'Prioritás',
  assignee: 'Felelős',
  people: 'Résztvevők',
  project: 'Projekt',
  subproject: 'Alprojekt',
  organization: 'Szervezet',
  contact: 'Kapcsolat',
  tasks: 'Feladatok',
  subprojects: 'Alprojektek',
  tags: 'Címkék',
  area: 'Terület (üzleti/társadalmi/privát)',
  category: 'Kategória',
  health: 'Egészség (RAG)',
  nextStep: 'Következő lépés',
  background: 'Háttér',
  needsDecision: 'Döntés szükséges',
  source: 'Forrás',
  milestone: 'Következő mérföldkő',
  milestoneDue: 'Mérföldkő határideje',
  reviewDate: 'Újraértékelés dátuma',
  description: 'Leírás',
  isKey: 'Kulcsember',
  email: 'E-mail',
  link: 'Link',
};

/** Melyik szerephez mely kanonikus mezőket keressük. */
export const ROLE_FIELDS: Record<Role, CanonicalField[]> = {
  task: [
    'title', 'status', 'due', 'start', 'priority', 'assignee', 'project', 'subproject',
    'organization', 'contact', 'tags', 'nextStep', 'background', 'needsDecision', 'source', 'area',
  ],
  project: [
    'title', 'status', 'area', 'category', 'health', 'organization', 'people', 'tasks',
    'subprojects', 'milestone', 'milestoneDue', 'reviewDate', 'description', 'due', 'tags', 'link',
  ],
  subproject: [
    'title', 'status', 'project', 'tasks', 'people', 'due', 'description', 'area', 'health',
  ],
  organization: ['title', 'status', 'category', 'people', 'description', 'link', 'area', 'tags'],
  person: ['title', 'organization', 'isKey', 'email', 'category', 'description', 'tags'],
  decision: ['title', 'status', 'due', 'project', 'description', 'assignee'],
  question: ['title', 'status', 'due', 'project', 'description', 'assignee'],
  log: ['title', 'start', 'project', 'organization', 'contact', 'description'],
  note: ['title', 'tags', 'description', 'project'],
  other: ['title', 'status', 'due'],
  ignored: ['title'],
};

/** A relation-mezők kanonikus neve → melyik szerepre mutat. Az él-gráf ebből épül. */
export const RELATION_TARGET_ROLE: Partial<Record<CanonicalField, Role>> = {
  project: 'project',
  subproject: 'subproject',
  organization: 'organization',
  contact: 'person',
  assignee: 'person',
  people: 'person',
  tasks: 'task',
  subprojects: 'subproject',
};
