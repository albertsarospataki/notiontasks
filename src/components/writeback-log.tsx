'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Entry {
  id: number;
  pageTitle: string | null;
  describe: string;
  before: string | null;
  after: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  undoable: boolean;
}

/** Mit írtunk vissza a Notionbe, és mi vonható vissza. */
export function WritebackLog() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const load = async () => {
    const res = await fetch('/api/writeback?limit=40', { cache: 'no-store' });
    if (res.ok) setEntries(((await res.json()) as { entries: Entry[] }).entries);
  };

  useEffect(() => {
    void load();
  }, []);

  const undo = async (id: number) => {
    setBusy(id);
    try {
      await fetch(`/api/writeback/${id}`, { method: 'POST' });
      await load();
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  };

  if (entries.length === 0) {
    return <p className="soft text-xs">Még nem történt visszaírás.</p>;
  }

  return (
    <ul className="space-y-1">
      {entries.map((e) => (
        <li key={e.id} className="surface flex flex-wrap items-center gap-2 rounded-md px-2.5 py-1.5 text-xs">
          <span className="soft tabular shrink-0">
            {new Date(e.createdAt).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
          <span className="font-medium">{e.pageTitle ?? '(ismeretlen oldal)'}</span>
          <span className="soft">{e.describe}</span>
          {e.status === 'dry_run' && <span style={{ color: 'var(--color-warn)' }}>próbaüzem</span>}
          {e.status === 'undone' && <span className="soft">visszavonva</span>}
          {e.status === 'error' && <span style={{ color: 'var(--color-danger)' }}>{e.error}</span>}
          {e.undoable && (
            <button
              type="button"
              onClick={() => void undo(e.id)}
              disabled={busy === e.id}
              className="ml-auto rounded px-2 py-0.5 disabled:opacity-50"
              style={{ background: 'var(--color-muted-soft)', color: 'var(--text-soft)' }}
            >
              {busy === e.id ? 'Visszavonás…' : 'Visszavon'}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
