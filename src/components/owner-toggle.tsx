'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * „Csak az én feladataim" kapcsoló. A választás a query stringben él, így
 * megosztható és frissítés után is megmarad.
 */
export function OwnerToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ownerOnly = params.get('owner') === '1';

  const toggle = () => {
    const next = new URLSearchParams(params.toString());
    if (ownerOnly) next.delete('owner');
    else next.set('owner', '1');
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded px-2 py-1 text-xs font-medium"
      style={
        ownerOnly
          ? { background: 'var(--color-good-soft)', color: 'var(--color-good)' }
          : { background: 'var(--color-muted-soft)', color: 'var(--text-soft)' }
      }
      title="Csak azok a feladatok, ahol Albert a felelős"
    >
      {ownerOnly ? '✓ Csak az enyémek' : 'Csak az enyémek'}
    </button>
  );
}
