import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveredDatabase } from '../src/lib/notion/discovery';

/**
 * Önteszt — Notion-hozzáférés nélkül.
 *
 * Egy eldobható SQLite fájlba felépíti a valódi workspace séma-alakját, feltölti
 * kitalált, de élethű sorokkal, és végigméri a láncot: felfedezés → besorolás →
 * mezőleképezés → normalizálás → nézetek → javaslatok.
 *
 * Futtatás: npm test
 */

const dir = mkdtempSync(join(tmpdir(), 'notion-cockpit-test-'));
process.env.DATA_DIR = dir;
process.env.NOTION_TOKEN = 'test-token-not-used';
process.env.OWNER_EMAIL = 'albert@sarospataki.hu';
process.env.OWNER_NAMES = 'Albert Sárospataki';
process.env.SYNC_INTERVAL_MINUTES = '0';

const { upsertDatabases } = await import('../src/lib/notion/discovery');
const { refreshMappings, getMappedDatabase, updateMapping } = await import('../src/lib/mapping/store');
const { seedDatabases, seedPages } = await import('./seed');
const { resolveOwnerFlags } = await import('../src/lib/sync/engine');
const { getDayView, getMonthView, getWeekView, listTasks, summarize } = await import('../src/lib/view/tasks');
const { getPortfolio } = await import('../src/lib/view/projects');
const { getOrganizations } = await import('../src/lib/view/organizations');
const { generateSuggestions, listSuggestions } = await import('../src/lib/insights/engine');
const { addDays, today } = await import('../src/lib/util/date');
const F = await import('./fixtures');

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function equal<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, `kapott: ${JSON.stringify(actual)}, várt: ${JSON.stringify(expected)}`);
}

// ── 1. Felfedezés és besorolás ────────────────────────────────────────────────

const discovered = seedDatabases();
equal('felfedezés: minden adatbázis bekerül', discovered.length, F.FIXTURES.length);

for (const fixture of F.FIXTURES) {
  const mapped = getMappedDatabase(fixture.id);
  check(`besorolás létrejött: ${fixture.title}`, mapped !== null);
  if (!mapped) continue;

  equal(`szerep: ${fixture.title}`, mapped.role, fixture.expectRole);

  for (const [field, expected] of Object.entries(fixture.expectFields ?? {})) {
    equal(`mező ${fixture.title}.${field}`, mapped.fields[field as keyof typeof mapped.fields], expected);
  }
}

// Új adatbázis a második körben — a kulcsígéret: magától bekerül.
const NEW_DB = '99999999888877776666555544443333';
upsertDatabases([
  ...discovered,
  {
    id: NEW_DB,
    title: 'Feladatok 2027',
    url: `https://notion.so/${NEW_DB}`,
    icon: null,
    parentType: 'workspace',
    parentId: 'workspace',
    isInline: false,
    archived: false,
    properties: {
      Name: { type: 'title' },
      Status: { type: 'select' },
      Határidő: { type: 'date' },
      Prioritás: { type: 'select' },
    } as DiscoveredDatabase['properties'],
    createdTime: '2026-08-30T00:00:00.000Z',
    lastEditedTime: '2026-08-30T00:00:00.000Z',
  },
]);
refreshMappings();
equal('új adatbázis automatikusan feladat-szerepet kap', getMappedDatabase(NEW_DB)?.role, 'task');

// Kézi felülírás nem íródik felül a következő körben.
updateMapping(NEW_DB, { role: 'note' });
refreshMappings();
equal('kézi szerep megmarad újraszámolás után', getMappedDatabase(NEW_DB)?.role, 'note');
updateMapping(NEW_DB, { role: 'ignored' });

// ── 2. Sorok betöltése ────────────────────────────────────────────────────────

const seeded = seedPages();
const T = today();
const { projectZenon: P_ZENON, projectAmigos: P_AMIGOS, subMarketing: S_MARKETING } = seeded.ids;
const overloadDay = seeded.overloadDay;

// ── 3. Normalizálás ───────────────────────────────────────────────────────────

const all = listTasks({ limit: 500 });
equal('feladatok betöltve', all.length, seeded.taskCount);

const overdue = all.find((t) => t.id === 't-overdue')!;
equal('státusz-csoport: In progress', overdue.statusGroup, 'in_progress');
equal('határidő normalizálva', overdue.due, addDays(T, -12));
equal('prioritás rangsor: Magas → 0', overdue.priorityRank, 0);
equal('projekt-kapcsolat feloldva', overdue.project?.title, 'Zenon Clinic — membership modell');
equal('szervezet-kapcsolat feloldva', overdue.organization?.title, 'Zenon Clinic');

const blocked = all.find((t) => t.id === 't-blocked')!;
equal('státusz-csoport: Blokkolt', blocked.statusGroup, 'blocked');

const done = all.find((t) => t.id === 't-done')!;
equal('státusz-csoport: Done', done.statusGroup, 'done');

// Tulajdonos-jelölés: relation-alapú és címke-alapú is.
const ownerResolved = resolveOwnerFlags();
check('relation-alapú saját feladat felismerve', ownerResolved >= 2, `frissített sorok: ${ownerResolved}`);
const ownTasks = listTasks({ ownerOnly: true, limit: 500 });
check('saját feladatok listája nem üres', ownTasks.length >= 3, `${ownTasks.length} db`);
check('a „Saját" címkés feladat is saját', ownTasks.some((t) => t.id === 't-stale'));

// ── 4. Nézetek ────────────────────────────────────────────────────────────────

const day = getDayView(T);
check('napi nézet: van lejárt', day.overdue.some((t) => t.id === 't-overdue'));
check('napi nézet: mai határidő', day.dueToday.some((t) => t.id === 't-today'));
check('napi nézet: kész feladat nem szerepel a nyitottak közt', !day.dueToday.some((t) => t.id === 't-done'));
check('napi nézet: döntésre váró', day.needsDecision.some((t) => t.id === 't-decision'));
check('napi nézet: dátum nélküli magas prioritás', day.unscheduledHighPriority.some((t) => t.id === 't-highprio-nodue'));

const week = getWeekView(T);
equal('heti nézet: hét napjai', week.days.length, 7);
check('heti nézet: a mai feladat a mai napon van', week.days.some((d) => d.day === T && d.tasks.some((t) => t.id === 't-today')));

const month = getMonthView(T);
check('havi nézet: a túlterhelt nap tele van', (month.byDay.get(overloadDay) ?? []).length === 8);
check('havi nézet: rács hétfővel kezdődik', new Date(month.gridStart).getDay() === 1);

const stats = summarize(all.filter((t) => t.statusGroup !== 'done'), T);
check('összesítés: van lejárt', stats.overdue >= 1);
check('összesítés: van blokkolt', stats.blocked >= 1);

// ── 5. Portfólió ──────────────────────────────────────────────────────────────

const portfolio = getPortfolio();
equal('portfólió: projektek száma', portfolio.projects.length, 3);

const zenon = portfolio.projects.find((p) => p.id === P_ZENON)!;
equal('projekt: RAG kiolvasva', zenon.health, '🔴 Piros');
equal('projekt: mérföldkő szövege', zenon.milestone, 'Árazás jóváhagyása');
equal('projekt: mérföldkő határideje', zenon.milestoneDue, addDays(T, -10));
equal('projekt: alprojekt hozzárendelve', zenon.subprojects.length, 1);
check('projekt: az alprojekt feladatai beleszámítanak', zenon.taskStats.total >= 10, `${zenon.taskStats.total}`);

const amigos = portfolio.projects.find((p) => p.id === P_AMIGOS)!;
equal('projekt: újraértékelés dátuma', amigos.reviewDate, addDays(T, -3));

const areas = portfolio.byArea.map((a) => a.area);
equal('portfólió: első terület az Üzleti', areas[0], 'Üzleti');
check('portfólió: a Társadalmi is szerepel', areas.includes('Társadalmi'));
check('portfólió: veszélyben lévő projekt észlelve', portfolio.stats.atRisk >= 1);

const orgs = getOrganizations();
equal('szervezetek: egy cég', orgs.length, 1);
check('szervezet: projekt hozzárendelve vagy feladat kötve', orgs[0].taskStats.total >= 1);

// ── 6. Javaslatok ─────────────────────────────────────────────────────────────

const generated = generateSuggestions();
check('javaslatok keletkeztek', generated.created > 0, `${generated.created} db`);

const open = listSuggestions({ limit: 500 });
const rules = new Set(open.map((s) => s.rule));

for (const expected of [
  'overdue_task',
  'due_today_no_next_step',
  'high_priority_no_due',
  'blocked_too_long',
  'stale_open_task',
  'task_without_project',
  'decision_pending',
  'possible_duplicate',
  'day_overloaded',
  'project_at_risk',
  'project_milestone_overdue',
  'project_review_due',
]) {
  check(`szabály tüzel: ${expected}`, rules.has(expected), `nem szerepel a ${rules.size} tüzelt szabály közt`);
}

const overdueSuggestion = open.find((s) => s.rule === 'overdue_task' && s.pageId === 't-overdue');
check('lejárt javaslathoz tartozik visszaírási művelet', overdueSuggestion?.action?.type === 'set_field');
equal('a visszaírás a határidőt célozza', overdueSuggestion?.action && overdueSuggestion.action.type === 'set_field' ? overdueSuggestion.action.field : null, 'due');

const projectGuess = open.find((s) => s.rule === 'task_without_project' && s.pageId === 't-noproject');
check('projekt nélküli feladathoz projekt-javaslat készült', Boolean(projectGuess?.action), 'a szervezet-egyezésből kellene jönnie');

// Determinizmus: második futás nem hoz újat.
const second = generateSuggestions();
equal('ismételt futás nem hoz új javaslatot', second.created, 0);

// Az azonosító stabil: elutasítás után nem éled újra.
if (overdueSuggestion) {
  const { dismissSuggestion } = await import('../src/lib/insights/engine');
  dismissSuggestion(overdueSuggestion.id, 'teszt');
  generateSuggestions();
  const after = listSuggestions({ status: ['open'], limit: 500 });
  check('elutasított javaslat nem tér vissza', !after.some((s) => s.id === overdueSuggestion.id));
}

// ── Összegzés ─────────────────────────────────────────────────────────────────

rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} ellenőrzés rendben.`);
if (failures.length > 0) {
  console.error(`\n${failures.length} HIBA:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('Az önteszt sikeres.\n');
