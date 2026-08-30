import type { Metadata } from 'next';
import './globals.css';
import { AppHeader } from '@/components/app-header';
import { startScheduler } from '@/lib/sync/scheduler';

export const metadata: Metadata = {
  title: 'Notion Cockpit',
  description: 'Napi, heti és havi áttekintés a teljes Notion-workspace feladatairól és projektjeiről.',
  robots: { index: false, follow: false },
};

// A háttér-szinkron a szerver indulásakor kel életre.
startScheduler();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>
        <div className="min-h-screen">
          <AppHeader />
          <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
