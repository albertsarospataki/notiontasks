import { loadEnv } from './load-env';
loadEnv();

const { runSync } = await import('../src/lib/sync/engine');
const { isConfigured } = await import('../src/lib/env');

/**
 * Egyszeri szinkron parancssorból. Cronból is használható:
 *   0 * * * * cd /path/to/notiontasks && npm run sync -- --full
 */
if (!isConfigured()) {
  console.error('Hiányzik a NOTION_TOKEN. Másold a .env.example fájlt .env néven, és töltsd ki.');
  process.exit(1);
}

const full = process.argv.includes('--full');
const summary = await runSync({ mode: full ? 'full' : undefined });

console.log(`\nSzinkron (${summary.mode}) — ${summary.status === 'ok' ? 'kész' : 'HIBA'}`);
console.log(`  adatbázis:   ${summary.databasesSeen} (${summary.databasesNew} új)`);
console.log(`  oldal:       ${summary.pagesUpserted} frissítve, ${summary.pagesRemoved} eltávolítva`);
console.log(`  javaslat:    ${summary.suggestionsNew} új`);
for (const line of summary.log) console.log(`  · ${line}`);
if (summary.errors.length) {
  console.error('\nHibák:');
  for (const e of summary.errors) console.error(`  ! ${e}`);
}

process.exit(summary.status === 'ok' ? 0 : 1);
