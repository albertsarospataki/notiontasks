'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** Bejelentkezési űrlap. A jelszó soha nem kerül a címsorba, csak a kérés törzsébe. */
/**
 * A belépés utáni visszairányítás csak saját útvonalra mehet.
 *
 * A puszta „perjellel kezdődik" ellenőrzés kevés: a `//evil.com` és a
 * `/\evil.com` alakot a böngészők protokoll-relatív címként értelmezik, azaz
 * idegen kiszolgálóra vinnék a felhasználót. Ezért a címet feloldjuk a saját
 * origin ellenében, és csak akkor fogadjuk el, ha tényleg ott maradt.
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  try {
    const resolved = new URL(raw, window.location.origin);
    if (resolved.origin !== window.location.origin) return '/';
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return '/';
  }
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Nem sikerült belépni.');
        setPassword('');
        return;
      }
      router.replace(safeNext(params.get('next')));
      router.refresh();
    } catch {
      setError('Hálózati hiba. Próbáld újra.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="soft text-xs">Jelszó</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
          required
          className="rounded border px-3 py-2 text-sm"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
      </label>

      {error && (
        <p className="rounded px-2.5 py-1.5 text-xs" style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || password.length === 0}
        className="rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
        style={{ background: 'var(--color-accent)', color: '#fff' }}
      >
        {busy ? 'Belépés…' : 'Belépés'}
      </button>
    </form>
  );
}
