import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimális .env betöltő a parancssori szkriptekhez.
 * (A Next.js szerver magától olvassa a .env fájlokat — ez csak a CLI-nek kell.)
 */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;

    for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // A már beállított környezeti változó erősebb, mint a fájl.
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
