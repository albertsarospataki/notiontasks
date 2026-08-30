import { fold } from '@/lib/util/text';
import { CANONICAL_FIELDS, ROLE_FIELDS, type CanonicalField, type Role } from './roles';

/**
 * Kanonikus mező → Notion property automatikus felismerése.
 *
 * Minden mezőhöz megadjuk, milyen néven szokott szerepelni (magyarul és
 * angolul), és milyen property-típus fogadható el. A jelölteket pontozzuk, majd
 * *mohó* módon, globálisan a legjobb pontszámtól haladva osztjuk ki — így egy
 * property legfeljebb egy kanonikus mezőt kap, és a specifikus találat
 * ("Mérföldkő határidő") megelőzi az általánosat ("Határidő").
 */

export type PropertySchema = Record<string, { id?: string; type?: string; name?: string }>;
export type FieldMap = Partial<Record<CanonicalField, string>>;

interface FieldHint {
  /** Erős minták: a mezőnév lényegében ezt jelenti. */
  strong: RegExp[];
  /** Gyenge minták: tartalmazza a kulcsszót, de lehet más is. */
  weak?: RegExp[];
  /** Kizáró minták: ha illeszkedik, ez a property biztosan nem ez a mező. */
  exclude?: RegExp[];
  /** Elfogadható Notion property típusok, preferencia-sorrendben. */
  types: string[];
  /** Ha egyetlen ilyen típusú property van, név nélkül is elfogadjuk. */
  typeOnly?: boolean;
}

const HINTS: Record<CanonicalField, FieldHint> = {
  title: { strong: [/.*/], types: ['title'], typeOnly: true },

  status: {
    strong: [/^statusz$/, /^status$/, /^allapot$/, /^projekt statusz$/, /^feladat statusz$/, /^fazis$/, /^phase$/],
    weak: [/statusz/, /status/, /allapot/, /fazis/],
    exclude: [/korabbi/, /previous/, /regi /],
    types: ['status', 'select'],
  },

  due: {
    strong: [/^hatarido$/, /^due$/, /^due date$/, /^deadline$/, /^esedekesseg$/, /^esedekes$/, /^vallalt hatarido$/],
    weak: [/hatarido/, /deadline/, /due/, /esedekes/, /^datum$/, /^date$/, /^mikor$/],
    exclude: [/merfoldko/, /milestone/, /ujraertekel/, /review/, /letrehoz/, /created/, /modosit/],
    types: ['date', 'formula'],
  },

  start: {
    strong: [/^kezdes$/, /^kezdet$/, /^start$/, /^start date$/, /^indulas$/, /^idopont$/],
    weak: [/kezdes/, /kezdet/, /^start/, /indul/],
    types: ['date'],
  },

  priority: {
    strong: [/^prioritas$/, /^priority$/, /^fontossag$/, /^prio$/],
    weak: [/prioritas/, /priority/, /fontossag/, /urgenc/, /sulyoz/],
    types: ['select', 'status', 'number', 'multi_select'],
  },

  assignee: {
    strong: [/^felelos$/, /^assignee$/, /^owner$/, /^gazda$/, /^tulajdonos$/, /^felelos \(/],
    weak: [/felelos/, /assignee/, /owner/, /responsible/],
    types: ['people', 'relation', 'select', 'rich_text'],
  },

  people: {
    strong: [/^tagok$/, /^resztvevok$/, /^kulcsemberek$/, /^csapat$/, /^members$/, /^participants$/],
    weak: [/tagok/, /resztvev/, /kulcsember/, /csapat/, /members/, /people/],
    types: ['relation', 'people'],
  },

  project: {
    strong: [/^projekt$/, /^project$/, /^fo projekt$/, /^szuloprojekt$/, /^parent project$/],
    weak: [/^projekt /, /projekt$/, /project/],
    exclude: [/alprojekt/, /subproject/, /naplo/, /log$/, /statusz/, /tagok/, /link/],
    types: ['relation'],
  },

  subproject: {
    strong: [/^alprojekt$/, /^subproject$/, /^workstream$/, /^munkafolyam$/],
    weak: [/alprojekt/, /subproject/, /workstream/],
    types: ['relation'],
  },

  organization: {
    strong: [/^szervezet$/, /^ceg$/, /^cegek$/, /^company$/, /^organization$/, /^organisation$/, /^vallalat$/, /^ugyfel$/, /^client$/, /^partner$/],
    weak: [/szervezet/, /^ceg/, /company/, /organi[sz]ation/, /ugyfel/, /client/],
    types: ['relation', 'select', 'multi_select'],
  },

  contact: {
    strong: [/^kapcsolat$/, /^kapcsolatok$/, /^contact$/, /^contacts$/, /^szemely$/, /^person$/],
    weak: [/^kapcsolat/, /contact/],
    exclude: [/kommunikacio/, /naplo/, /interakci/],
    types: ['relation'],
  },

  tasks: {
    strong: [/^feladatok$/, /^feladat$/, /^tasks$/, /^teendok$/, /^todos$/, /^action items$/],
    weak: [/feladat/, /task/, /teendo/],
    types: ['relation'],
  },

  subprojects: {
    strong: [/^alprojektek$/, /^subprojects$/, /^workstreams$/],
    weak: [/alprojekt/, /subproject/],
    types: ['relation'],
  },

  tags: {
    strong: [/^cimkek$/, /^cimke$/, /^tags$/, /^tag$/, /^temak$/, /^labels$/],
    weak: [/cimke/, /^tags?$/, /label/, /^temak?$/],
    types: ['multi_select'],
  },

  area: {
    strong: [/^terulet$/, /^area$/, /^szfera$/, /^domain$/, /^besorolas$/],
    weak: [/terulet/, /^area/, /domain/],
    types: ['select', 'multi_select'],
  },

  category: {
    strong: [/^kategoria$/, /^kategoriak$/, /^category$/, /^tipus$/, /^type$/, /^fajta$/],
    weak: [/kategoria/, /category/, /tipus/, /^type/],
    types: ['select', 'multi_select'],
  },

  health: {
    strong: [/^rag$/, /^egeszseg$/, /^health$/, /^rag statusz$/, /^jelzolampa$/],
    weak: [/^rag/, /egeszseg/, /health/],
    types: ['select', 'status'],
  },

  nextStep: {
    strong: [/^kovetkezo lepes$/, /^next step$/, /^next action$/, /^kovetkezo lepesek$/],
    weak: [/kovetkezo lepes/, /next step/, /next action/],
    exclude: [/merfoldko/, /milestone/],
    types: ['rich_text'],
  },

  background: {
    strong: [/^rovid hatter$/, /^hatter$/, /^background$/, /^kontextus$/, /^context$/],
    weak: [/hatter/, /background/, /kontextus/],
    types: ['rich_text'],
  },

  needsDecision: {
    strong: [/^dontes szukseges$/, /^dontendo$/, /^needs decision$/, /^decision needed$/],
    weak: [/dontes/, /decision/],
    types: ['checkbox'],
  },

  source: {
    strong: [/^forras$/, /^source$/, /^csatorna$/, /^channel$/, /^origin$/],
    weak: [/forras/, /source/, /csatorna/],
    types: ['select'],
  },

  milestone: {
    strong: [/^kovetkezo merfoldko$/, /^merfoldko$/, /^milestone$/, /^next milestone$/],
    weak: [/merfoldko/, /milestone/],
    exclude: [/hatarido/, /due/, /date/, /datum/],
    types: ['rich_text'],
  },

  milestoneDue: {
    strong: [/^merfoldko hatarido$/, /^merfoldko hatarideje$/, /^milestone due$/, /^milestone date$/],
    weak: [/merfoldko.*hatarido/, /milestone.*due/, /milestone.*date/],
    types: ['date'],
  },

  reviewDate: {
    strong: [/^ujraertekeles datuma$/, /^ujraertekeles$/, /^review date$/, /^felulvizsgalat$/, /^revisit$/],
    weak: [/ujraertekel/, /review date/, /felulvizsgal/, /revisit/],
    types: ['date'],
  },

  description: {
    strong: [/^leiras$/, /^rovid leiras$/, /^description$/, /^osszefoglalo$/, /^summary$/, /^jegyzet$/, /^notes$/],
    weak: [/leiras/, /description/, /summary/, /osszefoglal/],
    exclude: [/hatter/, /background/, /kovetkezo/],
    types: ['rich_text'],
  },

  isKey: {
    strong: [/^kulcsember$/, /^kulcs$/, /^key person$/, /^vip$/, /^fontos$/],
    weak: [/kulcsember/, /key person/],
    types: ['checkbox'],
  },

  email: {
    strong: [/^email$/, /^e-mail$/, /^e mail$/],
    weak: [/email/],
    types: ['email', 'rich_text'],
    typeOnly: true,
  },

  link: {
    strong: [/^link$/, /^url$/, /^weboldal$/, /^website$/, /^honlap$/],
    weak: [/link/, /^url/, /website/, /honlap/],
    types: ['url'],
    typeOnly: true,
  },
};

interface Candidate {
  field: CanonicalField;
  property: string;
  score: number;
}

/**
 * Automatikus mezőleképezés egy adatbázis sémájára, a megadott szerep alapján.
 * Csak a szerephez tartozó kanonikus mezőket keresi.
 */
export function detectFields(schema: PropertySchema, role: Role): FieldMap {
  const wanted = ROLE_FIELDS[role] ?? ROLE_FIELDS.other;
  const entries = Object.entries(schema).map(([name, p]) => ({
    name,
    type: p.type ?? 'unknown',
    folded: fold(name),
  }));

  const candidates: Candidate[] = [];

  for (const field of wanted) {
    const hint = HINTS[field];
    if (!hint) continue;

    const typedProps = entries.filter((e) => hint.types.includes(e.type));

    for (const prop of typedProps) {
      if (hint.exclude?.some((re) => re.test(prop.folded))) continue;

      // Típus-preferencia: az első engedélyezett típus ér a legtöbbet.
      const typeBonus = Math.max(0, hint.types.length - hint.types.indexOf(prop.type)) * 2;

      let score = 0;
      if (hint.strong.some((re) => re.test(prop.folded))) score = 100;
      else if (hint.weak?.some((re) => re.test(prop.folded))) score = 55;
      else if (hint.typeOnly && typedProps.length === 1) score = 25;

      if (score > 0) candidates.push({ field, property: prop.name, score: score + typeBonus });
    }
  }

  // Mohó, globálisan legjobb pontszámtól: egy property egy mezőt kap.
  candidates.sort((a, b) => b.score - a.score || a.field.localeCompare(b.field));

  const map: FieldMap = {};
  const usedProps = new Set<string>();
  for (const c of candidates) {
    if (map[c.field] !== undefined) continue;
    if (usedProps.has(c.property)) continue;
    map[c.field] = c.property;
    usedProps.add(c.property);
  }

  // A cím mindig a title típusú property — ez nem tárgya a versenynek.
  const titleProp = entries.find((e) => e.type === 'title');
  if (titleProp) map.title = titleProp.name;

  return map;
}

/** Kézi felülírás összefésülése az automatikus találgatással. */
export function mergeFieldMaps(auto: FieldMap, manual: FieldMap): FieldMap {
  const out: FieldMap = { ...auto };
  for (const key of CANONICAL_FIELDS) {
    const v = manual[key];
    if (v === undefined) continue;
    // Üres string = a felhasználó szándékosan letiltotta a mezőt.
    if (v === '') delete out[key];
    else out[key] = v;
  }
  return out;
}
