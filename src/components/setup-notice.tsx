import { Card } from './ui';

/** Amit az első indításkor látni kell — konkrét, sorrendbe tett lépések. */
export function SetupNotice({ configured, hasDatabases }: { configured: boolean; hasDatabases: boolean }) {
  return (
    <Card className="mx-auto max-w-2xl p-6">
      <h1 className="text-lg font-semibold">Első beállítás</h1>
      <ol className="mt-4 space-y-3 text-sm">
        <li className={configured ? 'soft line-through' : ''}>
          <strong>1. Hozz létre Notion-integrációt.</strong>{' '}
          <a className="underline" href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">
            notion.so/profile/integrations
          </a>{' '}
          → <em>New integration</em>. A titkos tokent másold a <code>.env</code> fájl <code>NOTION_TOKEN</code> sorába.
        </li>
        <li className={hasDatabases ? 'soft line-through' : ''}>
          <strong>2. Oszd meg vele a workspace-t.</strong> A Notionben minden teamspace vagy gyökér-oldal
          <em> ••• → Connections → </em> az integráció neve. Egy oldal megosztása az alatta lévő teljes fára érvényes,
          ezért elég a néhány gyökeret megosztani — az új aloldalak és adatbázisok maguktól öröklik.
        </li>
        <li>
          <strong>3. Indíts szinkront.</strong> A fejlécben a <em>Szinkron most</em> gomb, vagy parancssorból{' '}
          <code>npm run sync</code>.
        </li>
      </ol>
      <p className="soft mt-4 text-xs">
        A cockpit ezután minden szinkronnál újra végigfut a workspace adatbázisain, így az újonnan létrehozott
        feladat- és projekt-adatbázisok külön beállítás nélkül bekerülnek.
      </p>
    </Card>
  );
}
