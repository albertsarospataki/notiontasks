/**
 * Notion property értékek olvasása és írása.
 *
 * A Notion minden mezőt saját alakban ad vissza; itt egyszerű JS értékké
 * alakítjuk (olvasás), illetve kanonikus értékből Notion-payloadot építünk
 * (visszaírás). Az ismeretlen típusokat nem dobjuk el: `raw` alatt megmaradnak.
 */

export type NotionProperty = Record<string, unknown> & { type?: string; id?: string };
export type NotionProperties = Record<string, NotionProperty>;

export interface DateValue {
  start: string | null;
  end: string | null;
  isDateTime: boolean;
}

export interface PersonRef {
  id: string;
  name: string | null;
  email: string | null;
}

// ── Olvasás ───────────────────────────────────────────────────────────────────

function richTextToPlain(arr: unknown): string {
  if (!Array.isArray(arr)) return '';
  return arr
    .map((t) => (t as { plain_text?: string })?.plain_text ?? '')
    .join('')
    .trim();
}

/** Egy property emberi szöveges alakja (kereséshez, megjelenítéshez). */
export function plainText(prop: NotionProperty | undefined): string {
  if (!prop) return '';
  const t = prop.type as string | undefined;
  switch (t) {
    case 'title':
    case 'rich_text':
      return richTextToPlain(prop[t]);
    case 'number':
      return prop.number === null || prop.number === undefined ? '' : String(prop.number);
    case 'select':
      return (prop.select as { name?: string } | null)?.name ?? '';
    case 'status':
      return (prop.status as { name?: string } | null)?.name ?? '';
    case 'multi_select':
      return ((prop.multi_select as { name?: string }[] | null) ?? []).map((o) => o.name ?? '').join(', ');
    case 'date': {
      const d = prop.date as { start?: string; end?: string } | null;
      if (!d?.start) return '';
      return d.end ? `${d.start} → ${d.end}` : d.start;
    }
    case 'people':
      return ((prop.people as { name?: string }[] | null) ?? []).map((p) => p.name ?? '').join(', ');
    case 'checkbox':
      return prop.checkbox ? 'igen' : 'nem';
    case 'url':
      return (prop.url as string | null) ?? '';
    case 'email':
      return (prop.email as string | null) ?? '';
    case 'phone_number':
      return (prop.phone_number as string | null) ?? '';
    case 'created_time':
      return (prop.created_time as string | null) ?? '';
    case 'last_edited_time':
      return (prop.last_edited_time as string | null) ?? '';
    case 'unique_id': {
      const u = prop.unique_id as { prefix?: string | null; number?: number } | null;
      if (!u) return '';
      return u.prefix ? `${u.prefix}-${u.number}` : String(u.number ?? '');
    }
    case 'formula':
      return plainFormula(prop.formula);
    case 'rollup':
      return plainRollup(prop.rollup);
    case 'relation':
      return `${((prop.relation as unknown[] | null) ?? []).length} kapcsolat`;
    default:
      return '';
  }
}

function plainFormula(f: unknown): string {
  const v = f as { type?: string; string?: string; number?: number; boolean?: boolean; date?: { start?: string } } | null;
  if (!v) return '';
  switch (v.type) {
    case 'string':
      return v.string ?? '';
    case 'number':
      return v.number === undefined || v.number === null ? '' : String(v.number);
    case 'boolean':
      return v.boolean ? 'igen' : 'nem';
    case 'date':
      return v.date?.start ?? '';
    default:
      return '';
  }
}

function plainRollup(r: unknown): string {
  const v = r as { type?: string; number?: number; date?: { start?: string }; array?: unknown[] } | null;
  if (!v) return '';
  if (v.type === 'number') return v.number === undefined || v.number === null ? '' : String(v.number);
  if (v.type === 'date') return v.date?.start ?? '';
  if (v.type === 'array') return (v.array ?? []).map((x) => plainText(x as NotionProperty)).filter(Boolean).join(', ');
  return '';
}

export function readDate(prop: NotionProperty | undefined): DateValue | null {
  if (!prop) return null;
  let d: { start?: string; end?: string } | null = null;
  if (prop.type === 'date') d = prop.date as typeof d;
  else if (prop.type === 'formula') {
    const f = prop.formula as { type?: string; date?: { start?: string; end?: string } } | null;
    if (f?.type === 'date') d = f.date ?? null;
  } else if (prop.type === 'rollup') {
    const r = prop.rollup as { type?: string; date?: { start?: string; end?: string } } | null;
    if (r?.type === 'date') d = r.date ?? null;
  } else if (prop.type === 'created_time') {
    d = { start: prop.created_time as string };
  } else if (prop.type === 'last_edited_time') {
    d = { start: prop.last_edited_time as string };
  }
  if (!d?.start) return null;
  return { start: d.start, end: d.end ?? null, isDateTime: d.start.length > 10 };
}

/** Select / status / formula-string egységes név-értéke. */
export function readChoice(prop: NotionProperty | undefined): string | null {
  if (!prop) return null;
  if (prop.type === 'select') return (prop.select as { name?: string } | null)?.name ?? null;
  if (prop.type === 'status') return (prop.status as { name?: string } | null)?.name ?? null;
  if (prop.type === 'formula') {
    const s = plainFormula(prop.formula);
    return s || null;
  }
  if (prop.type === 'checkbox') return prop.checkbox ? 'igen' : null;
  if (prop.type === 'rich_text' || prop.type === 'title') {
    const s = richTextToPlain(prop[prop.type as string]);
    return s || null;
  }
  return null;
}

export function readMultiChoice(prop: NotionProperty | undefined): string[] {
  if (!prop) return [];
  if (prop.type === 'multi_select') {
    return ((prop.multi_select as { name?: string }[] | null) ?? []).map((o) => o.name ?? '').filter(Boolean);
  }
  if (prop.type === 'select') {
    const n = (prop.select as { name?: string } | null)?.name;
    return n ? [n] : [];
  }
  return [];
}

export function readCheckbox(prop: NotionProperty | undefined): boolean {
  if (!prop) return false;
  if (prop.type === 'checkbox') return Boolean(prop.checkbox);
  if (prop.type === 'formula') {
    const f = prop.formula as { type?: string; boolean?: boolean } | null;
    return f?.type === 'boolean' ? Boolean(f.boolean) : false;
  }
  if (prop.type === 'rollup') {
    const r = prop.rollup as { type?: string; number?: number } | null;
    if (r?.type === 'number') return (r.number ?? 0) > 0;
  }
  return false;
}

export function readRelationIds(prop: NotionProperty | undefined): string[] {
  if (!prop || prop.type !== 'relation') return [];
  return ((prop.relation as { id?: string }[] | null) ?? []).map((r) => r.id ?? '').filter(Boolean);
}

export function readPeople(prop: NotionProperty | undefined): PersonRef[] {
  if (!prop || prop.type !== 'people') return [];
  return ((prop.people as Record<string, unknown>[] | null) ?? []).map((p) => ({
    id: String(p.id ?? ''),
    name: (p.name as string | undefined) ?? null,
    email: ((p.person as { email?: string } | undefined)?.email as string | undefined) ?? null,
  }));
}

/** A státusz-csoport, amiből a nézetek dolgoznak. */
export type StatusGroup = 'todo' | 'in_progress' | 'blocked' | 'done' | 'unknown';

const DONE_WORDS = ['done', 'kész', 'kesz', 'befejez', 'lezár', 'lezar', 'complete', 'archivált', 'archivalt', 'elvégez'];
const BLOCKED_WORDS = ['blokk', 'block', 'waiting', 'on hold', 'vár valakire', 'varakoz', 'várakoz', 'függő', 'fuggo', 'felfüggeszt', 'parkol'];
const PROGRESS_WORDS = ['progress', 'folyamat', 'végrehajt', 'vegrehajt', 'doing', 'aktív', 'aktiv', 'elkötelez', 'értékel'];
const TODO_WORDS = ['not started', 'nincs', 'új', 'uj', 'todo', 'to do', 'backlog', 'intake', 'tervez', 'nyitott', 'open'];

/**
 * Státusznév → csoport.
 *
 * A „blokkolt" nem külön csoport a Notionben: egy ilyen opció rendszerint az
 * `in_progress` csoportban ül (a valódi workspace „Blokkolt - vár valakire"
 * státusza is ott van). A cockpit viszont külön kezeli, mert más beavatkozást
 * kíván — ezért a *név* itt erősebb jel, mint a Notion csoportja. Minden más
 * esetben a Notion csoportja a hiteles forrás, és csak annak hiányában esünk
 * vissza szöveges mintázatra, magyarul és angolul.
 */
export function statusGroup(name: string | null, notionGroup?: string | null): StatusGroup {
  const n = name?.toLowerCase() ?? '';

  if (n && BLOCKED_WORDS.some((w) => n.includes(w))) return 'blocked';

  if (notionGroup) {
    if (notionGroup === 'complete') return 'done';
    if (notionGroup === 'in_progress') return 'in_progress';
    if (notionGroup === 'to_do') return 'todo';
  }

  if (!n) return 'unknown';
  if (DONE_WORDS.some((w) => n.includes(w))) return 'done';
  if (PROGRESS_WORDS.some((w) => n.includes(w))) return 'in_progress';
  if (TODO_WORDS.some((w) => n.includes(w))) return 'todo';
  return 'unknown';
}

const HIGH = ['magas', 'high', 'sürgős', 'surgos', 'urgent', 'p0', 'p1', '🔴', 'kritikus', 'critical'];
const MEDIUM = ['közepes', 'kozepes', 'medium', 'normal', 'p2', '🟡'];
const LOW = ['alacsony', 'low', 'p3', 'p4', '🟢', 'ráér', 'raer'];

/** 0 = legmagasabb. A nézetek eszerint rendeznek. */
export function priorityRank(name: string | null): number {
  if (!name) return 2;
  const n = name.toLowerCase();
  if (HIGH.some((w) => n.includes(w))) return 0;
  if (MEDIUM.some((w) => n.includes(w))) return 1;
  if (LOW.some((w) => n.includes(w))) return 3;
  return 2;
}

// ── Írás (visszaírás a Notionbe) ──────────────────────────────────────────────

/** Notion property payload egy adott típushoz és értékhez. */
export function buildPropertyValue(
  type: string,
  value: unknown,
): Record<string, unknown> | null {
  switch (type) {
    case 'title':
      return { title: [{ type: 'text', text: { content: String(value ?? '') } }] };
    case 'rich_text':
      return { rich_text: value === null || value === '' ? [] : [{ type: 'text', text: { content: String(value) } }] };
    case 'select':
      return { select: value ? { name: String(value) } : null };
    case 'status':
      return { status: value ? { name: String(value) } : null };
    case 'multi_select': {
      const arr = Array.isArray(value) ? value : value ? [value] : [];
      return { multi_select: arr.map((v) => ({ name: String(v) })) };
    }
    case 'checkbox':
      return { checkbox: Boolean(value) };
    case 'number': {
      if (value === null || value === '') return { number: null };
      const n = Number(value);
      return Number.isFinite(n) ? { number: n } : null;
    }
    case 'url':
      return { url: value ? String(value) : null };
    case 'email':
      return { email: value ? String(value) : null };
    case 'phone_number':
      return { phone_number: value ? String(value) : null };
    case 'date': {
      if (!value) return { date: null };
      if (typeof value === 'string') return { date: { start: value } };
      const d = value as { start?: string | null; end?: string | null };
      if (!d.start) return { date: null };
      return { date: { start: d.start, end: d.end ?? null } };
    }
    case 'relation': {
      const arr = Array.isArray(value) ? value : value ? [value] : [];
      return { relation: arr.map((id) => ({ id: String(id) })) };
    }
    case 'people': {
      const arr = Array.isArray(value) ? value : value ? [value] : [];
      return { people: arr.map((id) => ({ object: 'user', id: String(id) })) };
    }
    default:
      // formula, rollup, created_time, last_edited_time, unique_id: nem írható
      return null;
  }
}

/** Írható-e ez a property típus? A rendszer-mezőket sosem próbáljuk frissíteni. */
export function isWritable(type: string): boolean {
  return ![
    'formula',
    'rollup',
    'created_time',
    'created_by',
    'last_edited_time',
    'last_edited_by',
    'unique_id',
    'verification',
  ].includes(type);
}
