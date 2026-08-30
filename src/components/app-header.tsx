'use client';

import { usePathname } from 'next/navigation';
import { Nav } from './nav';
import { SyncBar } from './sync-bar';

/**
 * A fejléc. A bejelentkezési oldalon nincs helye: ott még nincs munkamenet,
 * a szinkron-sáv hívása 401-et kapna, a navigáció pedig sehova nem vezetne.
 */
export function AppHeader() {
  const pathname = usePathname();
  if (pathname === '/login') return null;

  return (
    <header className="sticky top-0 z-20 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold tracking-tight">Notion Cockpit</span>
          <span className="soft hidden text-xs sm:inline">a teljes workspace egy felületen</span>
        </div>
        <Nav />
      </div>
      <SyncBar />
    </header>
  );
}
