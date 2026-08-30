import { loadEnv } from './load-env';
loadEnv();

/**
 * Demó-adatok betöltése a helyi tükörbe.
 *
 * Notion-hozzáférés nélkül is végignézhetővé teszi a felületet: felépít egy
 * élethű, de kitalált workspace-t (projektek, alprojektek, szervezet, feladatok),
 * lefuttatja a besorolást és a javaslat-motort.
 *
 *   npm run demo && npm run dev
 *
 * Figyelem: ugyanabba az adatfájlba ír, mint az éles szinkron. Ha éles adatot
 * tartasz benne, előbb állíts külön DATA_DIR-t:
 *   DATA_DIR=./data-demo npm run demo
 */

// A demó tulajdonosa Albert — enélkül a „saját feladatok" szűrő üres lenne.
process.env.OWNER_NAMES ??= 'Albert Sárospataki';
process.env.OWNER_EMAIL ??= 'albert@sarospataki.hu';

const { seedDatabases, seedPages } = await import('../test/seed');
const { resolveOwnerFlags } = await import('../src/lib/sync/engine');
const { generateSuggestions } = await import('../src/lib/insights/engine');
const { env } = await import('../src/lib/env');

const databases = seedDatabases();
const result = seedPages();
const owners = resolveOwnerFlags();
const suggestions = generateSuggestions();

console.log(`\nDemó-adatok betöltve ide: ${env.dataDir}`);
console.log(`  adatbázis: ${databases.length}`);
console.log(`  feladat:   ${result.taskCount}`);
console.log(`  saját:     ${owners} feladat felelős-kapcsolat alapján`);
console.log(`  javaslat:  ${suggestions.open} nyitott\n`);
console.log('Indítsd a felületet:  npm run dev\n');
