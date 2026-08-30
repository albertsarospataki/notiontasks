'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { SuggestionRecord } from '@/lib/insights/types';
import { SEVERITY_LABELS } from '@/lib/insights/types';
import { Badge, NotionLink, type Tone } from './ui';

const SEVERITY_TONE: Record<string, Tone> = {
  critical: 'danger', high: 'danger', medium: 'warn', low: 'neutral', info: 'accent',
};

/**
 * Javaslatlista jóváhagyással.
 *
 * Az „Alkalmaz" gomb ténylegesen ír a Notionbe — ezért mindig kiírjuk, pontosan
 * mi fog történni, és a művelet után a visszaírás-napló alapján visszavonható.
 */
export function SuggestionList({ suggestions, ruleLabels }: {
  suggestions: SuggestionRecord[];
  ruleLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [, startTransition] = useTransition();

  const act = async (id: string, action: 'apply' | 'dismiss' | 'reopen') => {
    setBusy(id);
    try {
      const res = await fetch(`/api/suggestions/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      setResults((prev) => ({
        ...prev,
        [id]: { ok: Boolean(data.ok), message: data.message ?? data.error ?? 'Ismeretlen válasz.' },
      }));
      startTransition(() => router.refresh());
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: err instanceof Error ? err.message : 'Hálózati hiba.' },
      }));
    } finally {
      setBusy(null);
    }
  };

  if (suggestions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm"
         style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
        Nincs megjeleníthető javaslat ebben a szűrésben.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {suggestions.map((s) => {
        const result = results[s.id];
        const isBusy = busy === s.id;
        const resolved = s.status !== 'open';

        return (
          <li key={s.id} className="surface rounded-lg p-3" style={resolved ? { opacity: 0.65 } : undefined}>
            <div className="flex flex-wrap items-start gap-2">
              <Badge tone={SEVERITY_TONE[s.severity] ?? 'neutral'}>{SEVERITY_LABELS[s.severity]}</Badge>
              <Badge>{ruleLabels[s.rule] ?? s.rule}</Badge>
              {s.status === 'applied' && <Badge tone="good">végrehajtva</Badge>}
              {s.status === 'dismissed' && <Badge>elutasítva</Badge>}
              {s.status === 'stale' && <Badge tone="good">megoldódott</Badge>}

              <div className="ml-auto flex items-center gap-2">
                {s.page?.url && (
                  <NotionLink url={s.page.url} className="soft text-xs">
                    Notion ↗
                  </NotionLink>
                )}
              </div>
            </div>

            <p className="mt-1.5 text-sm font-medium">{s.title}</p>
            <p className="soft mt-0.5 text-xs whitespace-pre-line">{s.detail}</p>

            {s.action && (
              <p className="mt-2 rounded px-2 py-1 text-xs" style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>
                Visszaírás a Notionbe: <strong>{s.action.describe}</strong>
              </p>
            )}

            {result && (
              <p className="mt-2 text-xs" style={{ color: result.ok ? 'var(--color-good)' : 'var(--color-danger)' }}>
                {result.message}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {s.status === 'open' && s.action && (
                <button
                  type="button"
                  onClick={() => void act(s.id, 'apply')}
                  disabled={isBusy}
                  className="rounded px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                  style={{ background: 'var(--color-accent)', color: '#fff' }}
                >
                  {isBusy ? 'Írás…' : 'Alkalmaz és írd vissza'}
                </button>
              )}

              {s.status === 'open' && (
                <button
                  type="button"
                  onClick={() => void act(s.id, 'dismiss')}
                  disabled={isBusy}
                  className="rounded px-2.5 py-1 text-xs disabled:opacity-50"
                  style={{ background: 'var(--color-muted-soft)', color: 'var(--text-soft)' }}
                >
                  Elutasít
                </button>
              )}

              {(s.status === 'dismissed' || s.status === 'stale') && (
                <button
                  type="button"
                  onClick={() => void act(s.id, 'reopen')}
                  disabled={isBusy}
                  className="rounded px-2.5 py-1 text-xs disabled:opacity-50"
                  style={{ background: 'var(--color-muted-soft)', color: 'var(--text-soft)' }}
                >
                  Újranyit
                </button>
              )}

              {!s.action && s.status === 'open' && (
                <span className="soft text-[11px]">Ehhez emberi döntés kell — nincs automatikus művelet.</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
