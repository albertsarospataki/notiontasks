import { fold } from '@/lib/util/text';
import type { PropertySchema } from './fields';
import { ROLES, type Role } from './roles';

/**
 * Adatbázis-szerep automatikus felismerése.
 *
 * Két jelre támaszkodunk:
 *  1. az adatbázis *neve* (magyar és angol mintázatok),
 *  2. a *séma alakja* — milyen property-k vannak és milyen típusúak.
 *
 * Utána egy második kör a relation-gráfot is figyelembe veszi: ha egy adatbázis
 * biztosan feladat-adatbázis, akkor amelyik hivatkozik rá "Feladatok" néven, az
 * jó eséllyel projekt. Így a névtelen vagy szokatlanul elnevezett adatbázisok is
 * helyes szerepet kapnak.
 */

export interface Classification {
  role: Role;
  confidence: number; // 0..1
  reason: string;
  scores: Partial<Record<Role, number>>;
}

interface TitleRule {
  role: Role;
  strong?: RegExp[];
  weak?: RegExp[];
  veto?: RegExp[];
}

const TITLE_RULES: TitleRule[] = [
  {
    role: 'subproject',
    strong: [/alprojekt/, /subproject/, /workstream/, /munkafolyam/],
  },
  {
    role: 'task',
    strong: [/^feladat/, /feladatok/, /^teendo/, /^tasks?$/, /task list/, /^todo/, /action item/, /^tennivalo/],
    weak: [/feladat/, /task/, /teendo/],
    veto: [/naplo/, /log/, /sablon/, /template/, /tipus/, /figyelo/],
  },
  {
    role: 'project',
    strong: [/^projekt/, /^project/, /projekt-nyilvantartas/, /project (register|tracker|portfolio)/, /portfolio/, /kezdemenyezes/, /^initiativ/],
    weak: [/projekt/, /project/],
    veto: [/alprojekt/, /subproject/, /naplo/, /log/, /sablon/],
  },
  {
    role: 'organization',
    strong: [/^szervezet/, /^cegek?$/, /^compan(y|ies)$/, /^organi[sz]ation/, /^vallalat/, /^partnerek$/, /^ugyfelek$/, /^clients?$/, /^accounts?$/],
    weak: [/szervezet/, /company/, /organi[sz]ation/, /ugyfel/],
  },
  {
    role: 'person',
    strong: [/kapcsolati nyilvantartas/, /^kapcsolatok$/, /^kontaktok$/, /^emberek$/, /^people$/, /^contacts?$/, /^csapat$/, /^team$/, /kulcsemberek/, /^szemelyek$/],
    weak: [/kapcsolat/, /contact/, /people/, /person/],
    veto: [/kommunikacio/, /interakci/, /naplo/],
  },
  {
    role: 'decision',
    strong: [/dontesnaplo/, /^dontesek?$/, /^decisions?$/, /decision log/],
    weak: [/dontes/, /decision/],
  },
  {
    role: 'question',
    strong: [/nyitott kerdes/, /^kerdesek$/, /^questions?$/, /open question/],
    weak: [/kerdes/, /question/],
  },
  {
    role: 'log',
    strong: [/naplo/, /futasnaplo/, /^log$/, /^logs$/, /interakci/, /kommunikacio/, /^esemenyek$/, /^events?$/, /^meetings?$/, /idovonal/, /timeline/, /^tortenet$/, /^history$/],
    weak: [/naplo/, /log/, /event/],
  },
  {
    role: 'note',
    strong: [/tudastar/, /^jegyzetek$/, /^notes?$/, /^wiki$/, /knowledge/, /^dokumentumok$/, /^cikkek$/, /^posztok$/, /allaspont/, /^sablonok?$/, /templates?/, /^forrasok$/],
    weak: [/jegyzet/, /tudas/, /dokument/],
  },
];

interface ShapeSignal {
  role: Role;
  points: number;
  label: string;
  test: (s: ShapeSummary) => boolean;
}

interface ShapeSummary {
  types: Record<string, number>;
  names: string[];
  has: (re: RegExp) => boolean;
  hasTyped: (re: RegExp, type: string) => boolean;
  count: (type: string) => number;
}

const SHAPE_SIGNALS: ShapeSignal[] = [
  {
    role: 'task',
    points: 30,
    label: 'státusz + határidő mezőpáros',
    test: (s) => (s.count('status') > 0 || s.hasTyped(/statusz|status|allapot/, 'select')) && s.count('date') > 0,
  },
  { role: 'task', points: 12, label: 'prioritás mező', test: (s) => s.has(/prioritas|priority/) },
  { role: 'task', points: 10, label: '„következő lépés" mező', test: (s) => s.has(/kovetkezo lepes|next step/) },
  {
    role: 'project',
    points: 25,
    label: 'feladat-kapcsolat',
    test: (s) => s.hasTyped(/feladat|task/, 'relation'),
  },
  { role: 'project', points: 20, label: 'mérföldkő mező', test: (s) => s.has(/merfoldko|milestone/) },
  { role: 'project', points: 15, label: 'RAG / egészség jelző', test: (s) => s.has(/^rag$|egeszseg|health/) },
  { role: 'project', points: 10, label: 'terület-besorolás', test: (s) => s.has(/terulet|area/) },
  {
    role: 'subproject',
    points: 18,
    label: 'projekt- és feladat-kapcsolat együtt',
    test: (s) => s.hasTyped(/projekt|project/, 'relation') && s.hasTyped(/feladat|task/, 'relation'),
  },
  { role: 'person', points: 22, label: 'e-mail mező', test: (s) => s.count('email') > 0 },
  { role: 'person', points: 18, label: 'kulcsember jelölő', test: (s) => s.has(/kulcsember|key person/) },
  { role: 'person', points: 10, label: 'telefonszám mező', test: (s) => s.count('phone_number') > 0 },
  { role: 'organization', points: 12, label: 'weboldal mező', test: (s) => s.count('url') > 0 },
  { role: 'decision', points: 15, label: 'döntés-specifikus mezők', test: (s) => s.has(/dontes|decision/) },
  { role: 'log', points: 12, label: 'időbélyeg státusz nélkül', test: (s) => s.count('date') > 0 && s.count('status') === 0 },
];

function summarize(schema: PropertySchema): ShapeSummary {
  const types: Record<string, number> = {};
  const names: string[] = [];
  const folded: { name: string; type: string }[] = [];

  for (const [name, p] of Object.entries(schema)) {
    const type = p.type ?? 'unknown';
    types[type] = (types[type] ?? 0) + 1;
    names.push(name);
    folded.push({ name: fold(name), type });
  }

  return {
    types,
    names,
    has: (re) => folded.some((f) => re.test(f.name)),
    hasTyped: (re, type) => folded.some((f) => f.type === type && re.test(f.name)),
    count: (type) => types[type] ?? 0,
  };
}

export function classifyDatabase(title: string, schema: PropertySchema): Classification {
  const t = fold(title);
  const shape = summarize(schema);
  const scores: Partial<Record<Role, number>> = {};
  const reasons: string[] = [];

  const add = (role: Role, points: number) => {
    scores[role] = (scores[role] ?? 0) + points;
  };

  for (const rule of TITLE_RULES) {
    if (rule.veto?.some((re) => re.test(t))) continue;
    if (rule.strong?.some((re) => re.test(t))) {
      add(rule.role, 70);
      reasons.push(`a név „${title}" egyértelműen ${rule.role}-jellegű`);
    } else if (rule.weak?.some((re) => re.test(t))) {
      add(rule.role, 30);
      reasons.push(`a név utal rá: ${rule.role}`);
    }
  }

  for (const sig of SHAPE_SIGNALS) {
    if (sig.test(shape)) {
      add(sig.role, sig.points);
      reasons.push(sig.label);
    }
  }

  return finish(scores, reasons);
}

function finish(scores: Partial<Record<Role, number>>, reasons: string[]): Classification {
  const ranked = ROLES.map((r) => [r, scores[r] ?? 0] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return {
      role: 'other',
      confidence: 0,
      reason: 'Nem találtunk egyértelmű jelet — kérlek állítsd be kézzel.',
      scores,
    };
  }

  const [topRole, topScore] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;

  // A magabiztosság két dologtól függ: mennyire erős a legjobb jel abszolút
  // értékben, és mennyivel veri a másodikat.
  const strength = Math.min(1, topScore / 90);
  const margin = topScore === 0 ? 0 : (topScore - second) / topScore;
  const confidence = Math.round(Math.min(1, 0.55 * strength + 0.45 * margin) * 100) / 100;

  return {
    role: topRole,
    confidence,
    reason: reasons.slice(0, 3).join('; ') || 'alapértelmezett besorolás',
    scores,
  };
}

/** Egy relation property célja: melyik adatbázisra mutat. */
export function relationTargets(schema: PropertySchema): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, p] of Object.entries(schema)) {
    if (p.type !== 'relation') continue;
    const target = (p as unknown as { relation?: { database_id?: string } }).relation?.database_id;
    if (target) out[name] = target.replace(/-/g, '');
  }
  return out;
}

export interface GraphInput {
  id: string;
  title: string;
  schema: PropertySchema;
  classification: Classification;
}

/**
 * Második kör: a relation-gráf alapján finomítjuk a besorolást.
 *
 * Ha egy adatbázis „Feladatok" néven hivatkozik egy magabiztosan feladat-
 * szerepű adatbázisra, akkor ő maga projekt vagy alprojekt. És fordítva: ha egy
 * feladat-adatbázis „Projekt" néven hivatkozik valamire, az projekt.
 */
export function refineWithGraph(inputs: GraphInput[]): Map<string, Classification> {
  const byId = new Map(inputs.map((i) => [i.id.replace(/-/g, ''), i]));
  const result = new Map<string, Classification>(inputs.map((i) => [i.id, { ...i.classification }]));

  const confidentTaskDbs = new Set(
    inputs.filter((i) => i.classification.role === 'task' && i.classification.confidence >= 0.5).map((i) => i.id.replace(/-/g, '')),
  );

  for (const input of inputs) {
    const current = result.get(input.id)!;
    if (current.confidence >= 0.75) continue; // már elég biztos

    const targets = relationTargets(input.schema);
    const boosts: Partial<Record<Role, number>> = {};
    const notes: string[] = [];

    for (const [propName, targetId] of Object.entries(targets)) {
      const n = fold(propName);
      const target = byId.get(targetId);

      if (confidentTaskDbs.has(targetId) && /feladat|task|teendo/.test(n)) {
        const role: Role = /alprojekt|subproject/.test(fold(input.title)) ? 'subproject' : 'project';
        boosts[role] = (boosts[role] ?? 0) + 35;
        notes.push('feladat-adatbázisra hivatkozik');
      }

      if (target?.classification.role === 'project' && /projekt|project/.test(n) && !/alprojekt/.test(n)) {
        boosts.task = (boosts.task ?? 0) + 20;
        notes.push('projekt-adatbázisra hivatkozik');
      }

      if (target?.classification.role === 'person' && /felelos|assignee|owner/.test(n)) {
        boosts.task = (boosts.task ?? 0) + 15;
        notes.push('felelős-kapcsolattal rendelkezik');
      }
    }

    if (Object.keys(boosts).length === 0) continue;

    const merged: Partial<Record<Role, number>> = { ...current.scores };
    for (const [role, pts] of Object.entries(boosts)) {
      merged[role as Role] = (merged[role as Role] ?? 0) + (pts ?? 0);
    }

    const refined = finish(merged, [current.reason, ...notes.slice(0, 2)].filter(Boolean));
    result.set(input.id, refined);
  }

  return result;
}
