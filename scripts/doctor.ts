import { loadEnv } from './load-env';
loadEnv();

import { existsSync, accessSync, constants, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Beállítás-ellenőrző.
 *
 * Az első indítás két helyen szokott némán elromlani: nincs token, vagy van
 * token, de az integrációval nincs megosztva semmi — ilyenkor a felület üres,
 * és semmi nem árulja el, miért. Ez a parancs sorra veszi a lépéseket, és
 * megmondja, pontosan mi hiányzik.
 *
 *   npm run doctor
 */

const OK = '  ✓';
const WARN = '  ! ';
const BAD = '  ✗';

let problems = 0;
const note = (s: string) => console.log(s);
const fail = (s: string) => {
  problems += 1;
  console.log(`${BAD} ${s}`);
};

console.log('\nNotion Cockpit — beállítás ellenőrzése\n');

// ── 1. Node verzió ────────────────────────────────────────────────────────────
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) note(`${OK} Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} — 20-as vagy újabb kell. Telepíts frissebbet: https://nodejs.org`);

// ── 2. .env fájl ──────────────────────────────────────────────────────────────
if (existsSync(resolve(process.cwd(), '.env'))) {
  note(`${OK} .env fájl megvan`);
} else {
  fail('Nincs .env fájl. Készítsd el:  cp .env.example .env');
}

// ── 3. Token ──────────────────────────────────────────────────────────────────
const { env } = await import('../src/lib/env');

if (!env.notionToken) {
  fail('Nincs NOTION_TOKEN a .env fájlban.');
  note('    Hozz létre integrációt: https://www.notion.so/profile/integrations');
} else if (!/^(ntn_|secret_)/.test(env.notionToken)) {
  fail('A NOTION_TOKEN nem úgy néz ki, mint egy Notion-token (ntn_… vagy secret_… kezdetű).');
} else {
  note(`${OK} NOTION_TOKEN beállítva (${env.notionToken.slice(0, 7)}…)`);
}

// ── 4. Adatkönyvtár írható-e ──────────────────────────────────────────────────
const dataDir = resolve(env.dataDir);
try {
  mkdirSync(dataDir, { recursive: true });
  accessSync(dataDir, constants.W_OK);
  note(`${OK} Adatkönyvtár írható: ${dataDir}`);
} catch {
  fail(`Az adatkönyvtár nem írható: ${dataDir}`);
}

// ── 5. Tulajdonos ─────────────────────────────────────────────────────────────
if (env.ownerNames.length === 0 && env.ownerEmails.length === 0) {
  note(`${WARN}Nincs OWNER_NAMES és OWNER_EMAIL — a „Csak az enyémek" szűrő üres lesz.`);
} else {
  note(`${OK} Tulajdonos: ${[...env.ownerNames, ...env.ownerEmails].join(', ')}`);
}

// ── 6. Élő kapcsolat és láthatóság ────────────────────────────────────────────
if (env.notionToken) {
  const { notion, schedule, describeError } = await import('../src/lib/notion/client');

  try {
    const me = await schedule(() => notion().users.me({}));
    const name = (me as { name?: string; bot?: { workspace_name?: string } }).name ?? 'ismeretlen';
    const workspace = (me as { bot?: { workspace_name?: string } }).bot?.workspace_name;
    note(`${OK} A token él. Integráció: „${name}"${workspace ? ` · workspace: ${workspace}` : ''}`);
  } catch (err) {
    fail(describeError(err));
    console.log(`\n${problems} probléma. Javítsd a fentieket, és futtasd újra: npm run doctor\n`);
    process.exit(1);
  }

  const { fetchAllDatabases } = await import('../src/lib/notion/discovery');
  let databases: Awaited<ReturnType<typeof fetchAllDatabases>> = [];
  try {
    databases = await fetchAllDatabases();
  } catch (err) {
    fail(`Az adatbázisok lekérése nem sikerült: ${describeError(err)}`);
  }

  if (databases.length === 0) {
    fail('Az integráció EGYETLEN adatbázist sem lát.');
    note('');
    note('    Ez majdnem mindig azt jelenti, hogy még nem osztottad meg vele a tartalmat.');
    note('    A Notionben minden teamspace-nél vagy gyökér-oldalnál:');
    note('      ••• (jobb felül)  →  Connections  →  válaszd ki az integrációd nevét');
    note('    A megosztás az alatta lévő teljes oldalfára érvényes, tehát elég');
    note('    a néhány gyökeret megosztani. Utána futtasd újra: npm run doctor');
  } else {
    note(`${OK} Az integráció ${databases.length} adatbázist lát.`);

    // Besorolás száraz futtatása: mit ismerne fel a cockpit?
    const { classifyDatabase } = await import('../src/lib/mapping/classify');
    const { ROLE_LABELS } = await import('../src/lib/mapping/roles');

    const byRole = new Map<string, string[]>();
    for (const d of databases) {
      const role = classifyDatabase(d.title, d.properties).role;
      byRole.set(role, [...(byRole.get(role) ?? []), d.title]);
    }

    const taskCount = (byRole.get('task') ?? []).length;
    const projectCount = (byRole.get('project') ?? []).length;

    note('');
    note('    Amit felismer:');
    for (const [role, titles] of [...byRole.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const label = ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role;
      note(`      ${String(titles.length).padStart(3)} × ${label}${titles.length <= 4 ? `  (${titles.join(', ')})` : ''}`);
    }
    note('');

    if (taskCount === 0) {
      note(`${WARN}Nem talált feladat-adatbázist. A napi/heti/havi nézet üres lesz.`);
      note('    Szinkron után az Adatbázisok fülön kézzel beállítható, melyik az.');
    }
    if (projectCount === 0) {
      note(`${WARN}Nem talált projekt-adatbázist. A Projektek nézet üres lesz.`);
    }
  }
}

// ── Összegzés ─────────────────────────────────────────────────────────────────
console.log('');
if (problems === 0) {
  console.log('Minden rendben. Következő lépés:\n');
  console.log('  npm run sync     — az első szinkron (a workspace méretétől függően pár perc)');
  console.log('  npm run dev      — a felület a http://localhost:3000 címen\n');
} else {
  console.log(`${problems} probléma. Javítsd a fentieket, és futtasd újra: npm run doctor\n`);
  process.exit(1);
}
