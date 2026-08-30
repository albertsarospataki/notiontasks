import type { CanonicalField } from '@/lib/mapping/roles';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Kritikus',
  high: 'Sürgős',
  medium: 'Fontos',
  low: 'Ráér',
  info: 'Információ',
};

/**
 * Egy javaslathoz tartozó visszaírási művelet.
 *
 * `set_field`: egy kanonikus mező új értéke — a leképezés fordítja Notion
 *   property-vé, így nem kell property-neveket a szabályokba égetni.
 * `comment`: megjegyzés az oldalra — ott, ahol a döntés emberé, de a jelzésnek
 *   a Notionben a helye.
 */
export type WritebackAction =
  | {
      type: 'set_field';
      pageId: string;
      field: CanonicalField;
      value: unknown;
      /** Emberi leírás: „Határidő → 2026-09-02" */
      describe: string;
    }
  | {
      type: 'comment';
      pageId: string;
      text: string;
      describe: string;
    };

export interface SuggestionDraft {
  /** Determinisztikus azonosító — ugyanaz a probléma ugyanazt az id-t kapja. */
  id: string;
  rule: string;
  severity: Severity;
  title: string;
  detail: string;
  pageId: string | null;
  databaseId: string | null;
  action: WritebackAction | null;
}

export interface SuggestionRecord extends SuggestionDraft {
  status: 'open' | 'applied' | 'dismissed' | 'stale';
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  dismissReason: string | null;
  /** A hivatkozott oldal aktuális adatai a megjelenítéshez. */
  page: { id: string; title: string; url: string | null; databaseTitle: string } | null;
}

export interface RuleMeta {
  id: string;
  label: string;
  description: string;
}
