import { loadEnv } from './load-env';
loadEnv();

const { fetchAllDatabases, upsertDatabases } = await import('../src/lib/notion/discovery');
const { refreshMappings, listMappedDatabases } = await import('../src/lib/mapping/store');
const { ROLE_LABELS } = await import('../src/lib/mapping/roles');
const { isConfigured } = await import('../src/lib/env');

/**
 * Csak felfedezés és besorolás, oldal-szinkron nélkül.
 * Gyors módja annak, hogy lásd, mit talál a cockpit a workspace-ben.
 */
if (!isConfigured()) {
  console.error('Hiányzik a NOTION_TOKEN.');
  process.exit(1);
}

const discovered = await fetchAllDatabases();
const result = upsertDatabases(discovered);
refreshMappings();

console.log(`\n${result.seen} adatbázis (${result.created.length} új, ${result.removed.length} eltűnt)\n`);

const grouped = new Map<string, string[]>();
for (const d of listMappedDatabases()) {
  const label = `${ROLE_LABELS[d.role]}`;
  const confidence = d.roleSource === 'manual' ? 'kézi' : `${Math.round(d.confidence * 100)}%`;
  grouped.set(label, [...(grouped.get(label) ?? []), `${d.title}  (${confidence})`]);
}

for (const [role, items] of [...grouped.entries()].sort()) {
  console.log(`${role} — ${items.length}`);
  for (const item of items.sort()) console.log(`  · ${item}`);
  console.log('');
}
