import { env, isConfigured } from '@/lib/env';
import { runSync } from './engine';

/**
 * Háttér-szinkron.
 *
 * A Next.js szerver folyamatában él egyetlen időzítő. A globálison tartjuk,
 * hogy a fejlesztői módban történő modul-újratöltés ne indítson másodikat.
 * Éles, több példányos üzemre inkább külső cron ajánlott a `/api/sync`
 * végpontra — a `SYNC_INTERVAL_MINUTES=0` kikapcsolja a beépített ütemezőt.
 */

const globalRef = globalThis as unknown as {
  __notionCockpitScheduler?: { timer: NodeJS.Timeout; intervalMinutes: number };
};

export function startScheduler(): void {
  if (!isConfigured()) return;

  const minutes = env.syncIntervalMinutes;
  const existing = globalRef.__notionCockpitScheduler;

  if (existing) {
    if (existing.intervalMinutes === minutes) return;
    clearInterval(existing.timer);
    delete globalRef.__notionCockpitScheduler;
  }

  if (minutes <= 0) return;

  const tick = () => {
    void runSync().catch((err) => {
      console.error('[cockpit] háttér-szinkron hiba:', err);
    });
  };

  const timer = setInterval(tick, minutes * 60_000);
  // A Node ne maradjon életben pusztán az időzítő miatt.
  timer.unref?.();
  globalRef.__notionCockpitScheduler = { timer, intervalMinutes: minutes };

  // Indulás után rövid késleltetéssel egy kör, hogy a felület ne üresen fogadjon.
  setTimeout(tick, 3_000).unref?.();
}

export function stopScheduler(): void {
  const existing = globalRef.__notionCockpitScheduler;
  if (!existing) return;
  clearInterval(existing.timer);
  delete globalRef.__notionCockpitScheduler;
}
