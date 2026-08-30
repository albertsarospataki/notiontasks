'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Előre/vissza léptetés a heti és havi nézetben. */
export function PeriodNav({ prev, next, current, label }: { prev: string; next: string; current: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (day: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (day) q.set('d', day);
    else q.delete('d');
    const qs = q.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const btn = 'rounded px-2 py-1 text-xs';
  const style = { background: 'var(--color-muted-soft)', color: 'var(--text-soft)' };

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => go(prev)} className={btn} style={style} aria-label="Előző">
        ←
      </button>
      <span className="text-sm font-medium">{label}</span>
      <button type="button" onClick={() => go(next)} className={btn} style={style} aria-label="Következő">
        →
      </button>
      <button type="button" onClick={() => go(null)} className={btn} style={style} title={`Vissza ${current}-re`}>
        Ma
      </button>
    </div>
  );
}
