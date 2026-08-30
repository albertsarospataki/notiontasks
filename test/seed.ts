import type { DiscoveredDatabase } from '../src/lib/notion/discovery';
import { upsertDatabases } from '../src/lib/notion/discovery';
import { refreshMappings, getMappedDatabase } from '../src/lib/mapping/store';
import { normalizePage } from '../src/lib/sync/normalize';
import { db } from '../src/lib/db/client';
import { addDays, today } from '../src/lib/util/date';
import * as F from './fixtures';

/**
 * Élethű, de kitalált workspace felépítése a helyi tükörben.
 *
 * Két helyen használjuk: az önteszt ezen méri a láncot, a `npm run demo` pedig
 * ezzel tölti fel a felületet, hogy Notion-hozzáférés nélkül is végignézhető
 * legyen, mit tud a cockpit.
 */

export interface SeedResult {
  /** A betöltött feladatsorok száma. */
  taskCount: number;
  /** Az a nap, amelyre szándékosan túl sok feladat esik (a túlterhelés-szabályhoz). */
  overloadDay: string;
  ids: {
    projectZenon: string;
    projectBillingo: string;
    projectAmigos: string;
    subMarketing: string;
    orgZenon: string;
    personAlbert: string;
    personKitti: string;
  };
}

/** Az adatbázisok felfedezése és besorolása (oldalak nélkül). */
export function seedDatabases(): DiscoveredDatabase[] {
  const discovered: DiscoveredDatabase[] = F.FIXTURES.map((f) => ({
    id: f.id,
    title: f.title,
    url: `https://notion.so/${f.id}`,
    icon: null,
    parentType: 'workspace',
    parentId: 'workspace',
    isInline: false,
    archived: false,
    properties: f.properties as DiscoveredDatabase['properties'],
    createdTime: '2026-01-01T00:00:00.000Z',
    lastEditedTime: '2026-08-01T00:00:00.000Z',
  }));
  upsertDatabases(discovered);
  refreshMappings();
  return discovered;
}

export function seedPages(): SeedResult {
const now = new Date().toISOString();
const T = today();

interface SeedPage {
  id: string;
  databaseId: string;
  props: Record<string, unknown>;
  lastEdited?: string;
}

function page(id: string, databaseId: string, props: Record<string, unknown>, lastEdited?: string): SeedPage {
  return { id, databaseId, props, lastEdited };
}

const title = (t: string) => ({ type: 'title', title: [{ plain_text: t }] });
const text = (t: string) => ({ type: 'rich_text', rich_text: [{ plain_text: t }] });
const sel = (n: string | null) => ({ type: 'select', select: n ? { name: n } : null });
const stat = (n: string) => ({ type: 'status', status: { id: n, name: n } });
const date = (d: string | null) => ({ type: 'date', date: d ? { start: d } : null });
const relation = (...ids: string[]) => ({ type: 'relation', relation: ids.map((id) => ({ id })) });
const multi = (...names: string[]) => ({ type: 'multi_select', multi_select: names.map((n) => ({ name: n })) });
const check_ = (v: boolean) => ({ type: 'checkbox', checkbox: v });

const P_ZENON = 'proj-zenon';
const P_BILLINGO = 'proj-billingo';
const P_AMIGOS = 'proj-amigos';
const S_MARKETING = 'sub-marketing';
const O_ZENON = 'org-zenon';
const PERSON_ALBERT = 'person-albert';
const PERSON_KITTI = 'person-kitti';

const seeds: SeedPage[] = [
  // Emberek
  page(PERSON_ALBERT, F.DB_PEOPLE, { Név: title('Albert Sárospataki'), Kulcsember: check_(true) }),
  page(PERSON_KITTI, F.DB_PEOPLE, { Név: title('Kitti'), Kulcsember: check_(false) }),

  // Szervezet
  page(O_ZENON, F.DB_ORGS, { Név: title('Zenon Clinic'), Kategória: sel('Ügyfél'), Weboldal: { type: 'url', url: 'https://zenon.hu' } }),

  // Projektek
  page(P_ZENON, F.DB_PROJECTS, {
    Projekt: title('Zenon Clinic — membership modell'),
    'Projekt státusz': sel('Végrehajtás'),
    Terület: sel('Üzleti'),
    RAG: sel('🔴 Piros'),
    'Következő mérföldkő': text('Árazás jóváhagyása'),
    'Mérföldkő határidő': date(addDays(T, -10)),
    'Rövid leírás': text('Előfizetéses modell bevezetése.'),
    'Szervezet / üzleti terület': multi('Zenon Clinic'),
    Alprojektek: relation(S_MARKETING),
    Kulcsemberek: relation(PERSON_ALBERT),
  }),
  page(P_BILLINGO, F.DB_PROJECTS, {
    Projekt: title('Billingo — UAE terjeszkedés'),
    'Projekt státusz': sel('Végrehajtás'),
    Terület: sel('Üzleti'),
    RAG: sel('🟢 Zöld'),
    'Rövid leírás': text('Piacra lépés az Emírségekben.'),
  }),
  page(P_AMIGOS, F.DB_PROJECTS, {
    Projekt: title('Amigos Alapítvány'),
    'Projekt státusz': sel('Parkoló'),
    Terület: sel('Társadalmi'),
    'Újraértékelés dátuma': date(addDays(T, -3)),
  }),

  // Alprojekt
  page(S_MARKETING, F.DB_SUBPROJECTS, {
    Név: title('Zenon marketing indítás'),
    Projekt: relation(P_ZENON),
    Státusz: sel('Aktív'),
  }),
];

// Feladatok: lefedik a szabályok összes ágát.
const tasks: SeedPage[] = [
  page('t-overdue', F.DB_TASKS, {
    Name: title('Árazási tábla véglegesítése'),
    Status: stat('In progress'),
    'Due Date': date(addDays(T, -12)),
    Prioritás: sel('Magas'),
    Projekt: relation(P_ZENON),
    Szervezet: relation(O_ZENON),
    Felelős: relation(PERSON_ALBERT),
    'Következő lépés': text('Egyeztetés a könyvelővel'),
  }),
  page('t-today', F.DB_TASKS, {
    Name: title('Heti vezetői kör'),
    Status: stat('Not started'),
    'Due Date': date(T),
    Prioritás: sel('Közepes'),
    Projekt: relation(P_BILLINGO),
    Felelős: relation(PERSON_ALBERT),
  }),
  page('t-today-nostep', F.DB_TASKS, {
    Name: title('Szerződés átnézése'),
    Status: stat('Not started'),
    'Due Date': date(T),
    Projekt: relation(P_BILLINGO),
  }),
  page('t-blocked', F.DB_TASKS, {
    Name: title('Bankszámla nyitás visszaigazolása'),
    Status: stat('Blokkolt - vár valakire'),
    'Due Date': date(addDays(T, 5)),
    Kapcsolat: relation(PERSON_KITTI),
    Projekt: relation(P_BILLINGO),
  }, addDays(T, -40)),
  page('t-highprio-nodue', F.DB_TASKS, {
    Name: title('Befektetői anyag összeállítása'),
    Status: stat('Not started'),
    'Due Date': date(null),
    Prioritás: sel('Magas'),
    Projekt: relation(P_ZENON),
  }),
  page('t-stale', F.DB_TASKS, {
    Name: title('Régi ötlet: podcast sorozat'),
    Status: stat('Not started'),
    'Due Date': date(null),
    Tags: multi('Saját'),
  }, addDays(T, -90)),
  page('t-noproject', F.DB_TASKS, {
    Name: title('Zenon Clinic árlista frissítés'),
    Status: stat('Not started'),
    'Due Date': date(addDays(T, 3)),
    Szervezet: relation(O_ZENON),
    Tags: multi('Zenon'),
  }),
  page('t-decision', F.DB_TASKS, {
    Name: title('Döntés: kilépjünk-e a Suarából'),
    Status: stat('Not started'),
    'Döntés szükséges': check_(true),
    'Rövid háttér': text('A partner nem teljesíti a vállalásokat.'),
    'Due Date': date(addDays(T, 10)),
  }, addDays(T, -20)),
  page('t-dupe-a', F.DB_TASKS, {
    Name: title('Könyvelés egyeztetés augusztus'),
    Status: stat('Not started'),
    'Due Date': date(addDays(T, 2)),
  }),
  page('t-dupe-b', F.DB_TASKS, {
    Name: title('Könyvelés egyeztetés augusztusi'),
    Status: stat('Not started'),
    'Due Date': date(addDays(T, 2)),
  }),
  page('t-done', F.DB_TASKS, {
    Name: title('Heti riport elküldve'),
    Status: stat('Done'),
    'Due Date': date(addDays(T, -1)),
    Projekt: relation(P_ZENON),
  }),
  page('t-nextweek', F.DB_TASKS, {
    Name: title('Ügyvédi egyeztetés'),
    Status: stat('Not started'),
    'Due Date': date(addDays(T, 9)),
    Projekt: relation(P_BILLINGO),
  }),
];

// Egy túlterhelt nap: nyolc feladat ugyanarra a dátumra.
const overloadDay = addDays(T, 4);
for (let i = 0; i < 8; i++) {
  tasks.push(
    page(`t-load-${i}`, F.DB_TASKS, {
      Name: title(`Kampány-feladat ${i + 1}`),
      Status: stat('Not started'),
      'Due Date': date(overloadDay),
      Alprojekt: relation(S_MARKETING),
    }),
  );
}

const conn = db();
const insertPage = conn.prepare(`
  INSERT OR REPLACE INTO page (
    id, database_id, title, url, icon, archived, in_trash, created_time, last_edited_time,
    properties_json, c_status, c_status_group, c_start, c_due, c_due_end, c_due_is_time,
    c_priority, c_priority_rank, c_area, c_category, c_health, c_next_step, c_background,
    c_tags, c_is_owner, c_needs_decision, synced_at
  ) VALUES (
    @id, @database_id, @title, @url, @icon, @archived, @in_trash, @created_time, @last_edited_time,
    @properties_json, @c_status, @c_status_group, @c_start, @c_due, @c_due_end, @c_due_is_time,
    @c_priority, @c_priority_rank, @c_area, @c_category, @c_health, @c_next_step, @c_background,
    @c_tags, @c_is_owner, @c_needs_decision, @synced_at
  )
`);
const insertRel = conn.prepare(
  'INSERT OR REPLACE INTO page_relation (from_page_id, from_database_id, property, canonical, to_page_id) VALUES (?, ?, ?, ?, ?)',
);

for (const seed of [...seeds, ...tasks]) {
  const mapped = getMappedDatabase(seed.databaseId);
  if (!mapped) throw new Error(`Nincs leképezés: ${seed.databaseId}`);
  const normalized = normalizePage(
    {
      id: seed.id,
      url: `https://notion.so/${seed.id}`,
      archived: false,
      in_trash: false,
      created_time: '2026-06-01T09:00:00.000Z',
      last_edited_time: seed.lastEdited ? `${seed.lastEdited}T09:00:00.000Z` : now,
      properties: seed.props as never,
    },
    mapped,
    now,
  );
  insertPage.run(normalized.page);
  for (const r of normalized.relations) {
    insertRel.run(r.from_page_id, r.from_database_id, r.property, r.canonical, r.to_page_id);
  }
}

  return {
    taskCount: tasks.length,
    overloadDay,
    ids: {
      projectZenon: P_ZENON,
      projectBillingo: P_BILLINGO,
      projectAmigos: P_AMIGOS,
      subMarketing: S_MARKETING,
      orgZenon: O_ZENON,
      personAlbert: PERSON_ALBERT,
      personKitti: PERSON_KITTI,
    },
  };
}
