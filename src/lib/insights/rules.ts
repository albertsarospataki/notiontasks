import { createHash } from 'node:crypto';
import type { MappedDatabase } from '@/lib/mapping/store';
import { ROLE_LABELS } from '@/lib/mapping/roles';
import { addDays, daysBetween, endOfWeek, formatShort, today, type DayKey } from '@/lib/util/date';
import { fold, similarity, truncate } from '@/lib/util/text';
import type { Portfolio } from '@/lib/view/projects';
import { isAtRisk } from '@/lib/view/projects';
import type { OrganizationItem, ProjectItem, TaskItem } from '@/lib/view/types';
import type { RuleMeta, Severity, SuggestionDraft } from './types';

/**
 * Javaslat-szabályok.
 *
 * Mindegyik determinisztikus: ugyanaz az állapot ugyanazokat a javaslatokat
 * adja, ugyanazzal az azonosítóval — így egy javaslat elutasítása tartós marad,
 * és nem bukkan fel újra minden szinkronnál.
 *
 * Ahol értelmes, a javaslat *konkrét visszaírási műveletet* hoz magával, hogy
 * egy kattintással orvosolható legyen. Ahol a döntés emberé, ott a művelet
 * megjegyzés a Notion-oldalon, vagy egyáltalán nincs művelet.
 */

export interface RuleContext {
  today: DayKey;
  tasks: TaskItem[];
  portfolio: Portfolio;
  organizations: OrganizationItem[];
  databases: MappedDatabase[];
  unreviewed: MappedDatabase[];
}

type Rule = (ctx: RuleContext) => SuggestionDraft[];

export const RULE_META: RuleMeta[] = [
  { id: 'overdue_task', label: 'Lejárt határidő', description: 'Nyitott feladat, amelynek határideje elmúlt.' },
  { id: 'due_today_no_next_step', label: 'Ma esedékes, lépés nélkül', description: 'Ma vagy holnap esedékes feladat, amelyhez nincs rögzítve következő lépés.' },
  { id: 'high_priority_no_due', label: 'Magas prioritás határidő nélkül', description: 'Magas prioritású feladat dátum nélkül — könnyen elsüllyed.' },
  { id: 'blocked_too_long', label: 'Régóta blokkolt', description: 'Blokkolt feladat, amin két hete nem történt semmi.' },
  { id: 'stale_open_task', label: 'Elfelejtett feladat', description: 'Nyitott feladat, amelyet régóta nem érintett senki, és nincs határideje.' },
  { id: 'task_without_project', label: 'Projekt nélküli feladat', description: 'Nyitott feladat, amely egyetlen projekthez sem kapcsolódik.' },
  { id: 'decision_pending', label: 'Elakadt döntés', description: 'Döntést igénylő feladat, amely régóta nyitott.' },
  { id: 'possible_duplicate', label: 'Lehetséges duplikátum', description: 'Két nagyon hasonló című nyitott feladat ugyanabban az adatbázisban.' },
  { id: 'day_overloaded', label: 'Túlterhelt nap', description: 'Egy napra a szokásosnál lényegesen több feladat esik.' },
  { id: 'project_at_risk', label: 'Veszélyeztetett projekt', description: 'Piros RAG, lejárt mérföldkő vagy lejárt feladatok.' },
  { id: 'project_milestone_overdue', label: 'Lejárt mérföldkő', description: 'A projekt mérföldkő-határideje elmúlt.' },
  { id: 'project_no_open_tasks', label: 'Projekt feladat nélkül', description: 'Futó projekt, amelyhez egyetlen nyitott feladat sem tartozik.' },
  { id: 'project_review_due', label: 'Esedékes újraértékelés', description: 'Parkoló projekt, amelynek elérkezett az újraértékelési dátuma.' },
  { id: 'project_no_milestone', label: 'Mérföldkő nélküli projekt', description: 'Végrehajtás alatti projekt, amelynek nincs következő mérföldköve.' },
  { id: 'orphan_subproject', label: 'Gazdátlan alprojekt', description: 'Alprojekt, amely nincs projekthez kötve.' },
  { id: 'unmapped_database', label: 'Besorolatlan adatbázis', description: 'Új vagy bizonytalanul besorolt adatbázis — erősítsd meg a szerepét.' },
  { id: 'unmapped_task_fields', label: 'Hiányzó mezőleképezés', description: 'Feladat-adatbázis, amelyben nem található státusz vagy határidő mező.' },
];

const STALE_DAYS = 45;
const BLOCKED_DAYS = 14;
const DECISION_DAYS = 7;
const OVERLOAD_THRESHOLD = 8;
const DUPLICATE_THRESHOLD = 0.86;

function sid(rule: string, ...parts: (string | number | null)[]): string {
  return createHash('sha1').update([rule, ...parts.map((p) => String(p ?? ''))].join('|')).digest('hex').slice(0, 24);
}

function daysSince(iso: string | null, from: DayKey): number | null {
  if (!iso) return null;
  return daysBetween(iso.slice(0, 10), from);
}

const openTasks = (ctx: RuleContext) => ctx.tasks.filter((t) => t.statusGroup !== 'done');

// ── Feladat-szabályok ─────────────────────────────────────────────────────────

const overdueTask: Rule = (ctx) =>
  openTasks(ctx)
    .filter((t) => t.due !== null && (t.dueEnd ?? t.due) < ctx.today)
    .map((t) => {
      const late = daysBetween(t.dueEnd ?? t.due!, ctx.today);
      const severity: Severity = late > 30 ? 'critical' : late > 7 ? 'high' : 'medium';
      const proposed = addDays(ctx.today, late > 30 ? 7 : 1);
      return {
        // A késés napszáma szándékosan nincs az azonosítóban: egy elutasított
        // javaslat ne éledjen újra minden nappal.
        id: sid('overdue_task', t.id),
        rule: 'overdue_task',
        severity,
        title: `${late} napja lejárt: ${truncate(t.title, 70)}`,
        detail: [
          `Határidő: ${formatShort(t.due!)} · Státusz: ${t.status ?? 'nincs'}`,
          t.project ? `Projekt: ${t.project.title}` : 'Nincs projekthez kötve.',
          late > 30
            ? 'Ennyi késés után a határidő már nem információ. Vagy új dátumot érdemel, vagy le kell zárni.'
            : 'Told el a határidőt, vagy zárd le, ha már nem aktuális.',
        ].join('\n'),
        pageId: t.id,
        databaseId: t.databaseId,
        action: {
          type: 'set_field' as const,
          pageId: t.id,
          field: 'due' as const,
          value: proposed,
          describe: `Határidő → ${proposed}`,
        },
      };
    });

const dueTodayNoNextStep: Rule = (ctx) => {
  const horizon = addDays(ctx.today, 1);
  return openTasks(ctx)
    .filter((t) => t.due !== null && t.due >= ctx.today && t.due <= horizon && !t.nextStep)
    .map((t) => ({
      id: sid('due_today_no_next_step', t.id),
      rule: 'due_today_no_next_step',
      severity: 'medium' as Severity,
      title: `Nincs következő lépés: ${truncate(t.title, 70)}`,
      detail: `${t.due === ctx.today ? 'Ma' : 'Holnap'} esedékes, de nincs rögzítve, mi a konkrét cselekvés. Egy mondat most tíz perc keresgélést spórol később.`,
      pageId: t.id,
      databaseId: t.databaseId,
      action: null,
    }));
};

const highPriorityNoDue: Rule = (ctx) =>
  openTasks(ctx)
    .filter((t) => t.due === null && t.priorityRank === 0)
    .map((t) => ({
      id: sid('high_priority_no_due', t.id),
      rule: 'high_priority_no_due',
      severity: 'high' as Severity,
      title: `Magas prioritás, nincs határidő: ${truncate(t.title, 70)}`,
      detail: [
        `Prioritás: ${t.priority ?? 'magas'} · Státusz: ${t.status ?? 'nincs'}`,
        'Dátum nélkül a magas prioritás csak címke. Javasolt: e hét vége.',
      ].join('\n'),
      pageId: t.id,
      databaseId: t.databaseId,
      action: {
        type: 'set_field' as const,
        pageId: t.id,
        field: 'due' as const,
        value: endOfWeek(ctx.today),
        describe: `Határidő → ${endOfWeek(ctx.today)} (a hét vége)`,
      },
    }));

const blockedTooLong: Rule = (ctx) =>
  openTasks(ctx)
    .filter((t) => t.statusGroup === 'blocked')
    .map((t) => ({ t, age: daysSince(t.lastEditedTime, ctx.today) }))
    .filter((x): x is { t: TaskItem; age: number } => x.age !== null && x.age >= BLOCKED_DAYS)
    .map(({ t, age }) => ({
      id: sid('blocked_too_long', t.id),
      rule: 'blocked_too_long',
      severity: (age > 45 ? 'high' : 'medium') as Severity,
      title: `${age} napja blokkolt: ${truncate(t.title, 65)}`,
      detail: [
        `Státusz: ${t.status ?? 'blokkolt'}`,
        t.contacts.length ? `Kire vár: ${t.contacts.map((c) => c.title).join(', ')}` : 'Nincs rögzítve, kire vár.',
        'Ennyi idő után a blokk általában nem magától oldódik meg — vagy sürgetni kell, vagy másképp megkerülni.',
      ].join('\n'),
      pageId: t.id,
      databaseId: t.databaseId,
      action: {
        type: 'comment' as const,
        pageId: t.id,
        text: `A cockpit jelzi: ez a feladat ${age} napja blokkolt státuszban áll. Érdemes sürgetni, vagy más útvonalat keresni.`,
        describe: 'Megjegyzés a Notion-oldalra',
      },
    }));

const staleOpenTask: Rule = (ctx) =>
  openTasks(ctx)
    .filter((t) => t.due === null && t.statusGroup !== 'blocked')
    .map((t) => ({ t, age: daysSince(t.lastEditedTime, ctx.today) }))
    .filter((x): x is { t: TaskItem; age: number } => x.age !== null && x.age >= STALE_DAYS)
    .map(({ t, age }) => ({
      id: sid('stale_open_task', t.id),
      rule: 'stale_open_task',
      severity: 'low' as Severity,
      title: `${age} napja nem mozdult: ${truncate(t.title, 65)}`,
      detail: [
        `Se határidő, se mozgás ${age} napja. Státusz: ${t.status ?? 'nincs'}.`,
        'Ha még számít, adj neki dátumot. Ha nem, a lezárás felszabadítja a figyelmet.',
      ].join('\n'),
      pageId: t.id,
      databaseId: t.databaseId,
      action: null,
    }));

const taskWithoutProject: Rule = (ctx) => {
  // Csak ott jelezzük, ahol az adatbázisnak egyáltalán van projekt-kapcsolata.
  const dbHasProjectField = new Set(
    ctx.databases.filter((d) => d.role === 'task' && d.fields.project).map((d) => d.id),
  );

  return openTasks(ctx)
    .filter((t) => dbHasProjectField.has(t.databaseId) && !t.project && !t.subproject)
    .map((t) => {
      const candidate = guessProject(t, ctx.portfolio.projects);
      return {
        id: sid('task_without_project', t.id),
        rule: 'task_without_project',
        severity: 'low' as Severity,
        title: `Projekt nélkül: ${truncate(t.title, 70)}`,
        detail: candidate
          ? `Nincs projekthez kötve. A címkék és a szervezet alapján ide illik: „${candidate.title}".`
          : 'Nincs projekthez kötve, és nem találtunk hozzá illő projektet. Portfólió-szinten így láthatatlan marad.',
        pageId: t.id,
        databaseId: t.databaseId,
        action: candidate
          ? {
              type: 'set_field' as const,
              pageId: t.id,
              field: 'project' as const,
              value: [candidate.id],
              describe: `Projekt → ${candidate.title}`,
            }
          : null,
      };
    });
};

/**
 * Címke-, szervezet- és névegyezés alapján tippel projektet.
 *
 * Szándékosan óvatos: csak akkor ad vissza jelöltet, ha az egyértelműen jobb a
 * másodiknál. Egy rossz automatikus projektbekötés több kárt okoz, mint egy
 * kihagyott javaslat.
 */
function guessProject(task: TaskItem, projects: ProjectItem[]): ProjectItem | null {
  const scored = projects
    .filter((p) => p.statusGroup !== 'done')
    .map((p) => {
      let score = 0;

      // Ugyanahhoz a szervezethez kötött projekt — a legerősebb jel.
      if (task.organization && p.organizations.some((o) => o.id === task.organization!.id)) score += 3;

      // A szervezet neve megjelenik a projekt címében ("Zenon Clinic — membership modell").
      if (task.organization && containsToken(p.title, task.organization.title)) score += 2;

      for (const tag of task.tags) {
        // A címke önálló szóként szerepel a projekt címében, vagy a két név hasonló.
        if (containsToken(p.title, tag)) score += 2;
        else if (similarity(tag, p.title) > 0.6) score += 2;
      }

      if (similarity(task.title, p.title) > 0.5) score += 1;
      return { p, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score) return null;
  return scored[0].p;
}

/** Igaz, ha a `needle` önálló szóként (vagy szókezdetként) szerepel a `haystack`-ben. */
function containsToken(haystack: string, needle: string): boolean {
  const n = fold(needle);
  if (n.length < 3) return false;
  const h = fold(haystack);
  const index = h.indexOf(n);
  if (index === -1) return false;
  const before = index === 0 ? ' ' : h[index - 1];
  return !/[a-z0-9]/.test(before);
}

const decisionPending: Rule = (ctx) =>
  openTasks(ctx)
    .filter((t) => t.needsDecision)
    .map((t) => ({ t, age: daysSince(t.lastEditedTime, ctx.today) }))
    .filter((x): x is { t: TaskItem; age: number } => x.age !== null && x.age >= DECISION_DAYS)
    .map(({ t, age }) => ({
      id: sid('decision_pending', t.id),
      rule: 'decision_pending',
      severity: 'high' as Severity,
      title: `Döntésre vár ${age} napja: ${truncate(t.title, 60)}`,
      detail: [
        t.background ? truncate(t.background, 220) : 'Nincs rögzített háttér a döntéshez.',
        'A „döntés szükséges" jelölés óta nem történt változás. Ez általában nem információhiány, hanem halogatás.',
      ].join('\n'),
      pageId: t.id,
      databaseId: t.databaseId,
      action: null,
    }));

const possibleDuplicate: Rule = (ctx) => {
  const out: SuggestionDraft[] = [];
  const byDb = new Map<string, TaskItem[]>();
  for (const t of openTasks(ctx)) {
    byDb.set(t.databaseId, [...(byDb.get(t.databaseId) ?? []), t]);
  }

  for (const [databaseId, list] of byDb) {
    // Ábécésorrendben csak a szomszédos néhány elemet hasonlítjuk — a teljes
    // páronkénti összevetés nagy adatbázisnál feleslegesen drága lenne.
    const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title, 'hu'));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < Math.min(i + 5, sorted.length); j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (similarity(a.title, b.title) < DUPLICATE_THRESHOLD) continue;
        const [first, second] = a.id < b.id ? [a, b] : [b, a];
        out.push({
          id: sid('possible_duplicate', first.id, second.id),
          rule: 'possible_duplicate',
          severity: 'low',
          title: `Duplikátum-gyanú: ${truncate(first.title, 55)}`,
          detail: [
            `„${first.title}"`,
            `„${second.title}"`,
            'Két nyitott feladat majdnem azonos címmel. Ha ugyanaz, az egyiket érdemes lezárni.',
          ].join('\n'),
          pageId: first.id,
          databaseId,
          action: null,
        });
      }
    }
  }
  return out;
};

const dayOverloaded: Rule = (ctx) => {
  const horizon = addDays(ctx.today, 21);
  const counts = new Map<DayKey, TaskItem[]>();
  for (const t of openTasks(ctx)) {
    if (!t.due || t.due < ctx.today || t.due > horizon) continue;
    counts.set(t.due, [...(counts.get(t.due) ?? []), t]);
  }

  return [...counts.entries()]
    .filter(([, list]) => list.length >= OVERLOAD_THRESHOLD)
    .map(([day, list]) => ({
      id: sid('day_overloaded', day),
      rule: 'day_overloaded',
      severity: (day === ctx.today ? 'high' : 'medium') as Severity,
      title: `${formatShort(day)}: ${list.length} feladat egy napon`,
      detail: [
        `Ennyi tétel egyetlen napra reálisan nem fér be. Magas prioritású közülük: ${list.filter((t) => t.priorityRank === 0).length}.`,
        'Érdemes néhányat előrehozni vagy elhalasztani, mielőtt a nap magától dönt helyetted.',
      ].join('\n'),
      pageId: null,
      databaseId: null,
      action: null,
    }));
};

// ── Projekt-szabályok ─────────────────────────────────────────────────────────

const allProjects = (ctx: RuleContext): ProjectItem[] => [
  ...ctx.portfolio.projects,
  ...ctx.portfolio.projects.flatMap((p) => p.subprojects),
  ...ctx.portfolio.orphanSubprojects,
];

const projectAtRisk: Rule = (ctx) =>
  ctx.portfolio.projects
    .filter((p) => isAtRisk(p))
    .map((p) => ({
      id: sid('project_at_risk', p.id),
      rule: 'project_at_risk',
      severity: 'critical' as Severity,
      title: `Veszélyben: ${truncate(p.title, 70)}`,
      detail: [
        p.health ? `RAG: ${p.health}` : null,
        p.milestoneDue && p.milestoneDue < ctx.today
          ? `A mérföldkő határideje ${daysBetween(p.milestoneDue, ctx.today)} napja lejárt.`
          : null,
        p.taskStats.overdue > 0 ? `${p.taskStats.overdue} lejárt feladat tartozik hozzá.` : null,
        `Nyitott feladatok: ${p.taskStats.open}, ebből blokkolt: ${p.taskStats.blocked}.`,
      ].filter(Boolean).join('\n'),
      pageId: p.id,
      databaseId: p.databaseId,
      action: null,
    }));

const projectMilestoneOverdue: Rule = (ctx) =>
  allProjects(ctx)
    .filter((p) => p.statusGroup !== 'done' && p.milestoneDue !== null && p.milestoneDue < ctx.today)
    .map((p) => ({
      id: sid('project_milestone_overdue', p.id),
      rule: 'project_milestone_overdue',
      severity: 'high' as Severity,
      title: `Lejárt mérföldkő: ${truncate(p.title, 60)}`,
      detail: [
        p.milestone ? `Mérföldkő: ${p.milestone}` : 'A mérföldkő szövege üres.',
        `Határidő: ${formatShort(p.milestoneDue!)} (${daysBetween(p.milestoneDue!, ctx.today)} napja).`,
        'Vagy teljesült és frissítendő, vagy csúszik és új dátum kell.',
      ].join('\n'),
      pageId: p.id,
      databaseId: p.databaseId,
      action: {
        type: 'set_field' as const,
        pageId: p.id,
        field: 'milestoneDue' as const,
        value: addDays(ctx.today, 14),
        describe: `Mérföldkő határideje → ${addDays(ctx.today, 14)}`,
      },
    }));

const projectNoOpenTasks: Rule = (ctx) =>
  ctx.portfolio.projects
    .filter((p) => p.statusGroup === 'in_progress' && p.taskStats.open === 0)
    .map((p) => ({
      id: sid('project_no_open_tasks', p.id),
      rule: 'project_no_open_tasks',
      severity: 'medium' as Severity,
      title: `Futó projekt feladat nélkül: ${truncate(p.title, 60)}`,
      detail: [
        `Státusz: ${p.status ?? 'végrehajtás'}, de egyetlen nyitott feladat sem tartozik hozzá.`,
        'Vagy elkészült — akkor a státusz elavult —, vagy nincs kiírva a következő lépés.',
      ].join('\n'),
      pageId: p.id,
      databaseId: p.databaseId,
      action: null,
    }));

const projectReviewDue: Rule = (ctx) =>
  allProjects(ctx)
    .filter((p) => p.reviewDate !== null && p.reviewDate <= ctx.today && p.statusGroup !== 'done')
    .map((p) => ({
      id: sid('project_review_due', p.id),
      rule: 'project_review_due',
      severity: 'medium' as Severity,
      title: `Esedékes újraértékelés: ${truncate(p.title, 60)}`,
      detail: `Az újraértékelés dátuma ${formatShort(p.reviewDate!)} volt. Státusz: ${p.status ?? 'ismeretlen'}. Döntés kell: folytatás, lezárás vagy új dátum.`,
      pageId: p.id,
      databaseId: p.databaseId,
      action: null,
    }));

const projectNoMilestone: Rule = (ctx) =>
  ctx.portfolio.projects
    .filter((p) => p.statusGroup === 'in_progress' && !p.milestone && p.taskStats.open > 0)
    .map((p) => ({
      id: sid('project_no_milestone', p.id),
      rule: 'project_no_milestone',
      severity: 'low' as Severity,
      title: `Nincs mérföldkő: ${truncate(p.title, 65)}`,
      detail: `${p.taskStats.open} nyitott feladat fut, de nincs megfogalmazva a következő dátumozott kimenet. Mérföldkő nélkül a projekt nem mérhető, csak érezhető.`,
      pageId: p.id,
      databaseId: p.databaseId,
      action: null,
    }));

const orphanSubproject: Rule = (ctx) =>
  ctx.portfolio.orphanSubprojects.map((s) => ({
    id: sid('orphan_subproject', s.id),
    rule: 'orphan_subproject',
    severity: 'low' as Severity,
    title: `Gazdátlan alprojekt: ${truncate(s.title, 65)}`,
    detail: `Ez az alprojekt nincs projekthez kötve, ezért a portfólió-nézetben nem jelenik meg. ${s.taskStats.open} nyitott feladat tartozik hozzá.`,
    pageId: s.id,
    databaseId: s.databaseId,
    action: null,
  }));

// ── Rendszer-szabályok ────────────────────────────────────────────────────────

const unmappedDatabase: Rule = (ctx) =>
  ctx.unreviewed.map((d) => ({
    id: sid('unmapped_database', d.id, d.role),
    rule: 'unmapped_database',
    severity: 'info' as Severity,
    title: `Megerősítendő besorolás: ${truncate(d.title, 60)}`,
    detail: [
      `A cockpit „${ROLE_LABELS[d.role]}" szerepre tippel, ${Math.round(d.confidence * 100)}% magabiztossággal.`,
      d.reason ? `Indok: ${d.reason}` : null,
      'Amíg nincs megerősítve, ennek az adatbázisnak a tartalma nem feltétlenül a helyén jelenik meg.',
    ].filter(Boolean).join('\n'),
    pageId: null,
    databaseId: d.id,
    action: null,
  }));

const unmappedTaskFields: Rule = (ctx) =>
  ctx.databases
    .filter((d) => d.role === 'task' && d.includeInDashboard && (!d.fields.status || !d.fields.due))
    .map((d) => {
      const missing = [!d.fields.status ? 'státusz' : null, !d.fields.due ? 'határidő' : null].filter(Boolean);
      return {
        id: sid('unmapped_task_fields', d.id, missing.join(',')),
        rule: 'unmapped_task_fields',
        severity: 'info' as Severity,
        title: `Hiányzó mező: ${truncate(d.title, 55)}`,
        detail: [
          `Feladat-adatbázisként van besorolva, de nem találtunk ${missing.join(' és ')} mezőt.`,
          'Emiatt a tartalma hiányosan jelenik meg a napi/heti/havi nézetben. Az Adatbázisok fülön kézzel megadható.',
        ].join('\n'),
        pageId: null,
        databaseId: d.id,
        action: null,
      };
    });

export const RULES: Rule[] = [
  overdueTask,
  dueTodayNoNextStep,
  highPriorityNoDue,
  blockedTooLong,
  staleOpenTask,
  taskWithoutProject,
  decisionPending,
  possibleDuplicate,
  dayOverloaded,
  projectAtRisk,
  projectMilestoneOverdue,
  projectNoOpenTasks,
  projectReviewDue,
  projectNoMilestone,
  orphanSubproject,
  unmappedDatabase,
  unmappedTaskFields,
];

export function runRules(ctx: RuleContext): SuggestionDraft[] {
  const out: SuggestionDraft[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    for (const draft of rule(ctx)) {
      if (seen.has(draft.id)) continue;
      seen.add(draft.id);
      out.push(draft);
    }
  }
  return out;
}

export function defaultContext(): RuleContext {
  // A tényleges összeállítás az engine-ben történik; ez csak a típus-alapérték.
  return {
    today: today(),
    tasks: [],
    portfolio: { projects: [], byArea: [], orphanSubprojects: [], stats: { total: 0, active: 0, blocked: 0, atRisk: 0, withoutOpenTasks: 0 } },
    organizations: [],
    databases: [],
    unreviewed: [],
  };
}
