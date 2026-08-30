/**
 * Séma-fixtúrák.
 *
 * Ezek a valódi workspace adatbázisainak property-alakját tükrözik (Feladatok,
 * Projekt-nyilvántartás, Alprojektek, Szervezetek, Kapcsolati nyilvántartás),
 * plusz néhány szándékosan trükkös eset: névtelen adatbázis, angol nevű
 * feladatlista, naplók. Az önteszt ezeken méri, hogy az automatikus besorolás és
 * a mezőleképezés eltalálja-e a helyes választ.
 */

export interface FixtureDatabase {
  id: string;
  title: string;
  properties: Record<string, Record<string, unknown>>;
  expectRole: string;
  expectFields?: Record<string, string>;
}

const rel = (databaseId: string) => ({ type: 'relation', relation: { database_id: databaseId } });
const select = (...names: string[]) => ({ type: 'select', select: { options: names.map((n) => ({ id: n, name: n })) } });

const status = (groups: { to_do: string[]; in_progress: string[]; complete: string[] }) => ({
  type: 'status',
  status: {
    options: [...groups.to_do, ...groups.in_progress, ...groups.complete].map((n) => ({ id: n, name: n })),
    groups: [
      { name: 'to_do', option_ids: groups.to_do },
      { name: 'in_progress', option_ids: groups.in_progress },
      { name: 'complete', option_ids: groups.complete },
    ],
  },
});

export const DB_TASKS = '2f9f3a0943b7808497870000bf2e514b';
export const DB_PROJECTS = '7564f4c41a63442e900a6f4a739e0674';
export const DB_SUBPROJECTS = '3bb489209760429da80692f4e10779df';
export const DB_ORGS = '028d4e0777e143c3a67d80e09ed1f417';
export const DB_PEOPLE = '1aab11e7e43d44c4b1298718519649eb';
export const DB_DECISIONS = '881e059a1fad45c6b1a28310e347d6b7';
export const DB_LOG = 'bf7ecd9e7fb84ac28995cc97782e00ff';
export const DB_UNNAMED = 'aaaaaaaabbbbccccddddeeeeeeeeeeee';
export const DB_ENGLISH = 'ffffffff1111222233334444555555ff';

export const FIXTURES: FixtureDatabase[] = [
  {
    id: DB_TASKS,
    title: 'Feladatok',
    expectRole: 'task',
    expectFields: {
      title: 'Name',
      status: 'Status',
      due: 'Due Date',
      priority: 'Prioritás',
      project: 'Projekt',
      subproject: 'Alprojekt',
      organization: 'Szervezet',
      assignee: 'Felelős',
      contact: 'Kapcsolat',
      tags: 'Tags',
      nextStep: 'Következő lépés',
      background: 'Rövid háttér',
      needsDecision: 'Döntés szükséges',
      source: 'Forrás',
    },
    properties: {
      Name: { type: 'title' },
      Status: status({ to_do: ['Not started'], in_progress: ['In progress', 'Blokkolt - vár valakire'], complete: ['Done'] }),
      'Due Date': { type: 'date' },
      Prioritás: select('Magas', 'Közepes', 'Alacsony'),
      Projekt: rel(DB_PROJECTS),
      Alprojekt: rel(DB_SUBPROJECTS),
      Szervezet: rel(DB_ORGS),
      Felelős: rel(DB_PEOPLE),
      Kapcsolat: rel(DB_PEOPLE),
      Döntésnapló: rel(DB_DECISIONS),
      Tags: { type: 'multi_select', multi_select: { options: [{ name: 'Zenon' }, { name: 'Saját' }, { name: 'Család' }] } },
      'Következő lépés': { type: 'rich_text' },
      'Rövid háttér': { type: 'rich_text' },
      'Döntés szükséges': { type: 'checkbox' },
      Forrás: select('E-mail', 'LinkedIn', 'Meeting', 'Hívás', 'Saját', 'Rendszer'),
      Generálta: select('Claude', 'Kézi'),
      Created: { type: 'created_time' },
      'ClickUp task ID': { type: 'rich_text' },
      'ClickUp-ba szinkronizálva': { type: 'checkbox' },
    },
  },
  {
    id: DB_PROJECTS,
    title: 'Projekt-nyilvántartás',
    expectRole: 'project',
    expectFields: {
      title: 'Projekt',
      status: 'Projekt státusz',
      area: 'Terület',
      category: 'Kategória',
      health: 'RAG',
      milestone: 'Következő mérföldkő',
      milestoneDue: 'Mérföldkő határidő',
      reviewDate: 'Újraértékelés dátuma',
      description: 'Rövid leírás',
      tasks: 'Feladatok',
      subprojects: 'Alprojektek',
    },
    properties: {
      Projekt: { type: 'title' },
      'Projekt státusz': select('Intake', 'Értékelés', 'Elkötelezett', 'Végrehajtás', 'Blokkolt', 'Parkoló', 'Lezárt'),
      Terület: select('Üzleti', 'Társadalmi', 'Privát'),
      Kategória: select('Befektetés', 'Alapítás alatt', 'Operatív részesedés'),
      RAG: select('🟢 Zöld', '🟡 Sárga', '🔴 Piros'),
      'Következő mérföldkő': { type: 'rich_text' },
      'Mérföldkő határidő': { type: 'date' },
      'Újraértékelés dátuma': { type: 'date' },
      'Rövid leírás': { type: 'rich_text' },
      Feladatok: rel(DB_TASKS),
      Alprojektek: rel(DB_SUBPROJECTS),
      Kulcsemberek: rel(DB_PEOPLE),
      'Projekt tagok (Albert csapatából)': rel(DB_PEOPLE),
      Döntésnapló: rel(DB_DECISIONS),
      'Szervezet / üzleti terület': { type: 'multi_select', multi_select: { options: [{ name: 'Zenon Clinic' }] } },
      'Link a projekt-oldalra': { type: 'url' },
      Kulcsszavak: { type: 'rich_text' },
      'Felelős (Albert oldaláról)': { type: 'rich_text' },
    },
  },
  {
    id: DB_SUBPROJECTS,
    title: '📂 Alprojektek',
    expectRole: 'subproject',
    expectFields: { title: 'Név', project: 'Projekt', tasks: 'Feladatok' },
    properties: {
      Név: { type: 'title' },
      Projekt: rel(DB_PROJECTS),
      Feladatok: rel(DB_TASKS),
      Státusz: select('Aktív', 'Kész'),
      Határidő: { type: 'date' },
      Leírás: { type: 'rich_text' },
    },
  },
  {
    id: DB_ORGS,
    title: 'Szervezetek',
    expectRole: 'organization',
    expectFields: { title: 'Név' },
    properties: {
      Név: { type: 'title' },
      Kategória: select('Ügyfél', 'Partner', 'Befektető'),
      Weboldal: { type: 'url' },
      Kapcsolattartók: rel(DB_PEOPLE),
      Leírás: { type: 'rich_text' },
    },
  },
  {
    id: DB_PEOPLE,
    title: 'Kapcsolati nyilvántartás',
    expectRole: 'person',
    expectFields: { title: 'Név', email: 'E-mail', isKey: 'Kulcsember' },
    properties: {
      Név: { type: 'title' },
      'E-mail': { type: 'email' },
      Telefon: { type: 'phone_number' },
      Kulcsember: { type: 'checkbox' },
      Szervezet: rel(DB_ORGS),
      Kategória: select('Ügyfél', 'Barát', 'Kolléga'),
    },
  },
  {
    id: DB_DECISIONS,
    title: '🧿 Döntésnapló',
    expectRole: 'decision',
    properties: {
      Döntés: { type: 'title' },
      Státusz: select('Nyitott', 'Döntve'),
      Határidő: { type: 'date' },
      Projekt: rel(DB_PROJECTS),
      Leírás: { type: 'rich_text' },
    },
  },
  {
    id: DB_LOG,
    title: 'Claude Futásnapló',
    expectRole: 'log',
    properties: {
      Futás: { type: 'title' },
      Időpont: { type: 'date' },
      Eredmény: { type: 'rich_text' },
    },
  },
  {
    // Névtelen adatbázis, kizárólag a séma alakja és a gráf alapján sorolható be.
    id: DB_UNNAMED,
    title: '(névtelen adatbázis)',
    expectRole: 'task',
    properties: {
      Name: { type: 'title' },
      Status: status({ to_do: ['Not started'], in_progress: ['In progress'], complete: ['Done'] }),
      'Due Date': { type: 'date' },
      Prioritás: select('Magas', 'Alacsony'),
      Projekt: rel(DB_PROJECTS),
    },
  },
  {
    // Angol nevű feladatlista — más nyelv, ugyanaz a szerep.
    id: DB_ENGLISH,
    title: 'Action items',
    expectRole: 'task',
    expectFields: { status: 'Status', due: 'Deadline', priority: 'Priority', assignee: 'Owner' },
    properties: {
      Name: { type: 'title' },
      Status: select('To do', 'Doing', 'Done'),
      Deadline: { type: 'date' },
      Priority: select('High', 'Medium', 'Low'),
      Owner: { type: 'people' },
      Project: rel(DB_PROJECTS),
    },
  },
];
