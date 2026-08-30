# Notion Cockpit

Egyetlen felület a **teljes Notion-workspace** feladataira, projektjeire és
szervezeteire — napi, heti és havi bontásban, javaslatokkal, amelyeket
jóváhagyás után visszaír a Notionbe.

A cockpit **nem** ismer előre egyetlen adatbázist sem. Minden szinkronnál
végigfut a workspace-en, felfedezi az adatbázisokat, kitalálja a szerepüket
(feladat / projekt / alprojekt / szervezet / személy / döntés / …), és leképezi
a mezőiket. Ezért egy holnap létrehozott feladat-adatbázis holnapután már a napi
nézetben van, kódmódosítás nélkül.

---

## Mit tud

| Nézet | Mit mutat |
|---|---|
| **Ma** | Lejárt, mai határidős, folyamatban lévő, döntésre váró és dátum nélküli sürgős feladatok; a nap legfontosabb javaslatai. |
| **Hét** | Hétfőtől vasárnapig napi oszlopok, a hét elé csúszott lejárt tételekkel és a dátum nélküli hátralékkal. |
| **Hónap** | Naptárrács, napi terheléssel; a túlterhelt napok kiemelve. |
| **Projektek** | Portfólió területenként (Üzleti / Társadalmi / Privát), alprojektekkel, RAG-jelzéssel, mérföldkövekkel és a hozzájuk tartozó feladat-statisztikával. |
| **Szervezetek** | Cégek a hozzájuk kötött projektekkel, emberekkel és feladat-terheléssel. |
| **Javaslatok** | Amit a rendszer eltérésként talált — jóváhagyással visszaírható a Notionbe, visszavonási naplóval. |
| **Adatbázisok** | A felfedezett adatbázisok, automatikus besorolásuk és a mezőleképezés kézi felülírása. |

Minden nézetnek van **„Csak az enyémek"** szűrője: azok a feladatok, ahol a
tulajdonos a felelős — akár people-mező, akár a kapcsolati nyilvántartásra
mutató relation, akár a `Saját` címke jelöli.

---

## Beállítás

### 1. Notion-integráció

1. [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **New integration**.
2. Másold a titkos tokent (`ntn_…`).
3. **Oszd meg vele a workspace-t.** A Notionben minden teamspace vagy gyökér-oldal
   *••• → Connections →* az integráció neve. Egy oldal megosztása a teljes
   alatta lévő fára érvényes, tehát elég néhány gyökeret megosztani — az új
   aloldalak és adatbázisok maguktól öröklik a hozzáférést.

> Ez a lépés dönti el, mit jelent az „egész Notion". Amit nem osztasz meg, azt
> az integráció nem látja, és a cockpit sem.

### 2. Konfiguráció

```bash
cp .env.example .env
# töltsd ki legalább a NOTION_TOKEN és az OWNER_NAMES sort
```

| Változó | Mire való |
|---|---|
| `NOTION_TOKEN` | A belső integráció tokenje. |
| `OWNER_EMAIL`, `OWNER_NAMES` | Kitől számít „saját" egy feladat. Vesszővel több érték is megadható. |
| `DATA_DIR` | Hova kerüljön a helyi SQLite tükör (alap: `./data`). |
| `SYNC_INTERVAL_MINUTES` | Beépített háttér-szinkron periódusa. `0` = kikapcsolva (külső cronnal). |
| `FULL_SYNC_INTERVAL_HOURS` | Milyen gyakran fusson teljes újraolvasás. Csak ez veszi észre a Notionből **törölt** sorokat. |
| `SYNC_SECRET` | Ha megadod, az írási végpontokhoz `Authorization: Bearer <secret>` kell. |
| `WRITEBACK_DRY_RUN` | `true` esetén a jóváhagyott javaslatok nem íródnak ki, csak naplózódnak. Élesítés előtt érdemes. |

### 3. Indítás

```bash
npm install
npm run sync      # első teljes szinkron (pár perc, a workspace méretétől függően)
npm run dev       # http://localhost:3000
```

---

## Parancsok

| Parancs | Mit csinál |
|---|---|
| `npm run dev` / `build` / `start` | A webfelület. |
| `npm run sync` | Egyszeri szinkron. `npm run sync -- --full` teljes újraolvasás. |
| `npm run discover` | Csak felfedezés és besorolás — kiírja, mit talált és milyen magabiztossággal. |
| `npm run insights` | Javaslatok újraszámolása a helyi tükörből, Notion-hívás nélkül. |
| `npm run demo` | Élethű, kitalált adatokkal tölti fel a felületet — Notion nélkül is végignézhető. |
| `npm test` | Önteszt: felfedezés → besorolás → mezőleképezés → nézetek → javaslatok. |
| `npm run typecheck` | TypeScript ellenőrzés. |

A demót érdemes külön adatfájlba tenni, hogy ne keveredjen az élessel:

```bash
DATA_DIR=./data-demo npm run demo
DATA_DIR=./data-demo npm run dev
```

---

## Hogyan működik

```
Notion API ──▶ felfedezés ──▶ besorolás ──▶ szinkron ──▶ SQLite tükör
                                                              │
                          ┌───────────────────────────────────┤
                          ▼                                   ▼
                    nézetek (nap/hét/hónap,           javaslat-motor
                    portfólió, szervezetek)                   │
                                                              ▼
                                                   jóváhagyás ──▶ visszaírás
                                                                  a Notionbe
```

### Felfedezés

A Notion `search` végpontja visszaadja az összes adatbázist, amit az integráció
lát. Ezt **minden** szinkronnál újrafuttatjuk. Az eltűnt adatbázisokat nem
töröljük, csak megjelöljük — így egy visszaállított megosztás után a történet
megmarad.

### Besorolás

Két jelből dolgozik, majd egy harmadikkal finomít:

1. **Név** — magyar és angol mintázatok (`feladatok`, `action items`,
   `projekt-nyilvántartás`, `kapcsolati nyilvántartás`, …).
2. **Séma-alak** — például státusz + határidő mezőpáros → feladat; „mérföldkő" és
   RAG mező → projekt; e-mail és „kulcsember" mező → személy.
3. **Relation-gráf** — ha egy adatbázis „Feladatok" néven hivatkozik egy biztosan
   feladat-szerepű adatbázisra, akkor ő maga projekt. Ettől a **névtelen** és a
   szokatlanul elnevezett adatbázisok is helyükre kerülnek.

A találgatás mellé magabiztosság-érték is jár. Ami 60% alatt marad, az az
**Adatbázisok** fülön „megerősítést kér" listába kerül. A kézi felülírás tartós:
a következő szinkron nem írja felül.

### Mezőleképezés

Szerepenként megadott *kanonikus mezőket* (cím, státusz, határidő, prioritás,
felelős, projekt, terület, mérföldkő, …) keresünk a séma property-jei között,
név- és típusegyezés alapján pontozva. A kiosztás mohó és globális, ezért a
specifikus találat (`Mérföldkő határidő`) megelőzi az általánosat (`Határidő`).
Bármelyik leképezés kézzel felülírható, és a felülírás túléli a séma változását.

### Szinkron

- **Inkrementális** (alapértelmezett): adatbázisonként csak a legutóbbi kör óta
  módosult oldalak, `last_edited_time` szűrővel. Néhány másodperc.
- **Teljes**: minden oldal újraolvasása, és a helyi tükörből azoknak a soroknak a
  kitakarítása, amelyeket a Notion már nem ad vissza. **Csak ez veszi észre a
  törléseket**, ezért fut naponta magától (`FULL_SYNC_INTERVAL_HOURS`).

Minden hívás egyetlen soron, másodpercenként legfeljebb ~3 kéréssel megy ki, a
429 és 5xx válaszokat exponenciálisan növekvő várakozással újrapróbálja. Ha egy
adatbázis hibázik, a szinkron a többivel folytatódik, és a hiba a fejlécben
megjelenik.

### Javaslatok és visszaírás

A szabályok determinisztikusak: ugyanaz az állapot ugyanazokat a javaslatokat
adja, ugyanazzal az azonosítóval. Ezért egy **elutasított javaslat nem éled
újra**, és amit megoldottál, az magától „megoldódott" állapotba kerül.

Ahol egyértelmű a teendő, a javaslat konkrét visszaírási műveletet hoz magával
(például *Határidő → 2026-09-06*). A gomb megnyomása előtt mindig látszik,
pontosan mi fog történni. A művelet a `writeback_log`-ba kerül a **korábbi
értékkel együtt**, így egy kattintással visszavonható.

Ahol a döntés emberé — duplikátum-gyanú, elakadt döntés, feladat nélküli
projekt —, ott a javaslat szándékosan nem kínál automatikus műveletet.

Jelenlegi szabályok:

*Feladatok:* lejárt határidő · ma esedékes következő lépés nélkül · magas
prioritás dátum nélkül · két hete blokkolt · 45 napja nem mozdult · projekt
nélküli feladat (projekt-tippel) · elakadt döntés · duplikátum-gyanú ·
túlterhelt nap.

*Projektek:* veszélyeztetett projekt (piros RAG / lejárt mérföldkő / lejárt
feladatok) · lejárt mérföldkő · futó projekt nyitott feladat nélkül · esedékes
újraértékelés · mérföldkő nélküli projekt · gazdátlan alprojekt.

*Rendszer:* bizonytalanul besorolt adatbázis · feladat-adatbázis hiányzó státusz-
vagy határidő-mezővel.

---

## Üzemeltetés

### Külső cron

Ha nem a beépített ütemezőt használod (`SYNC_INTERVAL_MINUTES=0`):

```cron
*/10 * * * * cd /path/to/notiontasks && /usr/bin/npm run sync >> sync.log 2>&1
0 4 * * *    cd /path/to/notiontasks && /usr/bin/npm run sync -- --full >> sync.log 2>&1
```

Vagy HTTP-n keresztül:

```bash
curl -X POST http://localhost:3000/api/sync \
  -H 'authorization: Bearer <SYNC_SECRET>' \
  -H 'content-type: application/json' \
  -d '{"mode":"incremental"}'
```

### API

| Végpont | Metódus | Mit csinál |
|---|---|---|
| `/api/sync` | `GET` | Szinkron-állapot. |
| `/api/sync` | `POST` | Szinkron indítása (`{"mode":"full"\|"incremental"}`). |
| `/api/suggestions` | `GET` | Javaslatok listája és összesítés. |
| `/api/suggestions` | `POST` | Javaslatok újraszámolása. |
| `/api/suggestions/{id}` | `POST` | `{"action":"apply"\|"dismiss"\|"reopen"}`. |
| `/api/databases/{id}` | `PATCH` | Szerep és mezőleképezés felülírása. |
| `/api/writeback` | `GET` | Visszaírás-napló. |
| `/api/writeback/{id}` | `POST` | Egy visszaírás visszavonása. |

Az írási végpontokat a `SYNC_SECRET` védi, ha be van állítva.

### Adattárolás

Minden a `DATA_DIR/cockpit.sqlite` fájlban van. Nincs külső adatbázis. A fájl
bármikor törölhető: a következő teljes szinkron újraépíti — a kézi
mezőleképezések és a javaslat-döntések viszont elvesznek vele, ezért érdemes
menteni.

---

## Korlátok

- Az integráció **csak a vele megosztott** oldalfákat látja. Ha valami hiányzik a
  cockpitból, szinte mindig ez az ok — a fejléc kiírja, melyik adatbázis nem
  elérhető.
- A törölt sorok csak **teljes** szinkronnál tűnnek el a tükörből.
- A cockpit az adatbázis-sorok *property*-jeit tükrözi, az oldalak *törzsszövegét*
  nem. A hivatkozás mindig egy kattintás a Notionre.
- A Notion klasszikus (2022-06-28) API-verzióját használja. Több adatforrású
  (multi-source) adatbázisnál az elsődleges forrás látszik.
