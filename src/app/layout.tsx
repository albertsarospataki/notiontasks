import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';
import { SyncBar } from '@/components/sync-bar';
import { startScheduler } from '@/lib/sync/scheduler';

export const metadata: Metadata = {
  title: 'Notion Cockpit',
  description: 'Napi, heti és havi áttekintés a teljes Notion-workspace feladatairól és projektjeiről.',
};

// A háttér-szinkron a szerver indulásakor kel életre.
startScheduler();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>
        <div className="min-h-screen">
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
          <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
