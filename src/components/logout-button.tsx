'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void logout()}
      disabled={busy}
      className="rounded px-2 py-0.5 disabled:opacity-50"
      style={{ background: 'var(--color-muted-soft)', color: 'var(--text-soft)' }}
      title="Kilépés ebből a böngészőből"
    >
      {busy ? 'Kilépés…' : 'Kilépés'}
    </button>
  );
}
