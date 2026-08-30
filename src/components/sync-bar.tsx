'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Status {
  configured: boolean;
  running: boolean;
  databaseCount: number;
  pageCount: number;
  openSuggestions: number;
  lastRun: {
    mode: string;
    status: string;
    finishedAt: string | null;
    databasesNew: number;
    pagesUpserted: number;
    error: string | null;
  } | null;
  errorsByDatabase: { title: string; error: string }[];
}

/** Fejléc-sáv: mikor volt utoljára szinkron, és mi történt. */
export function SyncBar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sync', { cache: 'no-store' });
      if (res.ok) setStatus((await res.json()) as Status);
    } catch {
      /* a sáv nem kritikus — csendben elhallgat */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const sync = async (mode: 'incremental' | 'full') => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json()) as { status?: string; pagesUpserted?: number; databasesNew?: number; errors?: string[] };
      if (!res.ok || data.status === 'error') {
        setMessage(data.errors?.[0] ?? 'A szinkron hibára futott.');
      } else {
        const parts = [`${data.pagesUpserted ?? 0} oldal frissítve`];
        if (data.databasesNew) parts.push(`${data.databasesNew} új adatbázis`);
        if (data.errors?.length) parts.push(`${data.errors.length} adatbázis hibázott`);
        setMessage(parts.join(' · '));
      }
      await load();
      startTransition(() => router.refresh());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Hálózati hiba.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  if (!status.configured) {
    return (
      <div className="px-4 py-2 text-xs" style={{ background: 'var(--color-warn-soft)', color: 'var(--color-warn)' }}>
        Nincs beállítva a <code>NOTION_TOKEN</code>. Másold a <code>.env.example</code> fájlt <code>.env</code> néven, és add meg az integráció tokenjét.
      </div>
    );
  }

  const last = status.lastRun;
  const failed = last?.status === 'error';

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-1.5 text-xs"
      style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}
    >
      <span className="tabular">
        {status.databaseCount} adatbázis · {status.pageCount} oldal · {status.openSuggestions} javaslat
      </span>

      <span aria-hidden>·</span>

      <span style={failed ? { color: 'var(--color-danger)' } : undefined}>
        {status.running
          ? 'Szinkron fut…'
          : last?.finishedAt
            ? `Utolsó szinkron: ${formatWhen(last.finishedAt)}${failed ? ' — hibával' : ''}`
            : 'Még nem futott szinkron'}
      </span>

      <span className="ml-auto flex items-center gap-2">
        {message && <span>{message}</span>}
        <button
          type="button"
          onClick={() => void sync('incremental')}
          disabled={busy || status.running}
          className="rounded px-2 py-0.5 font-medium disabled:opacity-50"
          style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
        >
          {busy ? 'Szinkron…' : 'Szinkron most'}
        </button>
        <button
          type="button"
          onClick={() => void sync('full')}
          disabled={busy || status.running}
          className="rounded px-2 py-0.5 disabled:opacity-50"
          style={{ background: 'var(--color-muted-soft)' }}
          title="Mindent újraolvas, és kitakarítja a Notionből törölt sorokat."
        >
          Teljes
        </button>
      </span>

      {status.errorsByDatabase.length > 0 && (
        <details className="w-full">
          <summary style={{ color: 'var(--color-danger)' }} className="cursor-pointer">
            {status.errorsByDatabase.length} adatbázis nem érhető el
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {status.errorsByDatabase.map((e) => (
              <li key={e.title}>
                <strong>{e.title}</strong>: {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return 'az imént';
  if (diffMin < 60) return `${diffMin} perce`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h} órája`;
  return new Date(iso).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' });
}
