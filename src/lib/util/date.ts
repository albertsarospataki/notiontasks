/**
 * Dátumkezelés. Minden nap-alapú kulcs `YYYY-MM-DD` string, helyi (TZ) naptár
 * szerint — így a "ma", "ezen a héten", "ebben a hónapban" kérdés
 * egyértelmű, és nem csúszik el UTC-átfordulásnál.
 */

export type DayKey = string; // YYYY-MM-DD

const HU_WEEK_START = 1; // hétfő

export function toDayKey(input: Date | string | null | undefined): DayKey | null {
  if (!input) return null;
  if (typeof input === 'string') {
    // A Notion date property vagy "2026-08-30", vagy teljes ISO időbélyeg.
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(input);
    if (m && input.length === 10) return m[1];
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return m ? m[1] : null;
    return localDayKey(d);
  }
  return localDayKey(input);
}

function localDayKey(d: Date): DayKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(now: Date = new Date()): DayKey {
  return localDayKey(now);
}

export function parseDayKey(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(key: DayKey, days: number): DayKey {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + days);
  return localDayKey(d);
}

/** A `key` napot tartalmazó hét hétfője. */
export function startOfWeek(key: DayKey): DayKey {
  const d = parseDayKey(key);
  const dow = d.getDay(); // 0 = vasárnap
  const diff = (dow - HU_WEEK_START + 7) % 7;
  d.setDate(d.getDate() - diff);
  return localDayKey(d);
}

export function endOfWeek(key: DayKey): DayKey {
  return addDays(startOfWeek(key), 6);
}

export function startOfMonth(key: DayKey): DayKey {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: DayKey): DayKey {
  const d = parseDayKey(startOfMonth(key));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return localDayKey(d);
}

export function addMonths(key: DayKey, months: number): DayKey {
  const d = parseDayKey(startOfMonth(key));
  d.setMonth(d.getMonth() + months);
  return localDayKey(d);
}

export function daysBetween(a: DayKey, b: DayKey): number {
  const ms = parseDayKey(b).getTime() - parseDayKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function eachDay(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  let cur = from;
  // Védőkorlát: egy naptárnézet sem hosszabb egy évnél.
  for (let i = 0; i <= 400 && cur <= to; i++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

const HU_DAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
const HU_DAYS_SHORT = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];
const HU_MONTHS = [
  'január', 'február', 'március', 'április', 'május', 'június',
  'július', 'augusztus', 'szeptember', 'október', 'november', 'december',
];

export function dayName(key: DayKey, short = false): string {
  const d = parseDayKey(key).getDay();
  return short ? HU_DAYS_SHORT[d] : HU_DAYS[d];
}

export function monthName(key: DayKey): string {
  return HU_MONTHS[parseDayKey(key).getMonth()];
}

/** "2026. augusztus 30., vasárnap" */
export function formatLong(key: DayKey): string {
  const d = parseDayKey(key);
  return `${d.getFullYear()}. ${monthName(key)} ${d.getDate()}., ${dayName(key)}`;
}

/** "aug. 30." */
export function formatShort(key: DayKey): string {
  const d = parseDayKey(key);
  return `${monthName(key).slice(0, 3)}. ${d.getDate()}.`;
}

/** ISO-8601 hetes sorszám (a heti nézet fejlécéhez). */
export function isoWeek(key: DayKey): number {
  const d = parseDayKey(key);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

/** Emberi relatív megfogalmazás: "ma", "holnap", "3 napja lejárt". */
export function relativeLabel(key: DayKey, from: DayKey = today()): string {
  const diff = daysBetween(from, key);
  if (diff === 0) return 'ma';
  if (diff === 1) return 'holnap';
  if (diff === -1) return 'tegnap';
  if (diff < 0) return `${-diff} napja lejárt`;
  if (diff <= 7) return `${diff} nap múlva`;
  return formatShort(key);
}
