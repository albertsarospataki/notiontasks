import { plainText, readChoice, readDate, type NotionProperties } from '@/lib/notion/properties';
import type { MappedDatabase } from '@/lib/mapping/store';
import type { CanonicalField } from '@/lib/mapping/roles';
import { toDayKey } from '@/lib/util/date';

/**
 * Kanonikus mező kiolvasása egy oldal nyers property-jeiből.
 *
 * A gyakran szűrt mezők (státusz, határidő, prioritás…) saját oszlopot kaptak a
 * `page` táblában. A ritkábbakat — mérföldkő, újraértékelés dátuma, leírás —
 * nem duplikáljuk oszlopba: itt olvassuk ki a tárolt nyers JSON-ból.
 */

export function parseProperties(json: string): NotionProperties {
  try {
    return JSON.parse(json) as NotionProperties;
  } catch {
    return {};
  }
}

export function readText(props: NotionProperties, mapped: MappedDatabase, field: CanonicalField): string | null {
  const name = mapped.fields[field];
  if (!name) return null;
  const value = plainText(props[name]);
  return value || null;
}

export function readChoiceField(props: NotionProperties, mapped: MappedDatabase, field: CanonicalField): string | null {
  const name = mapped.fields[field];
  if (!name) return null;
  return readChoice(props[name]);
}

export function readDayField(props: NotionProperties, mapped: MappedDatabase, field: CanonicalField): string | null {
  const name = mapped.fields[field];
  if (!name) return null;
  const d = readDate(props[name]);
  return d ? toDayKey(d.start) : null;
}
