/**
 * A helyi tükör sémája. Egyetlen SQLite fájl, amely a teljes Notion-workspace
 * olvasható másolatát tartja: adatbázisok, azok leképezése, minden oldal
 * kanonikus mezőkkel, a relation-élek gráfja, a szinkron állapota, a
 * javaslatok és a visszaírás-napló.
 *
 * A DDL idempotens — minden indításkor lefut.
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Felfedezett Notion adatbázisok ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notion_database (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  url               TEXT,
  icon              TEXT,
  parent_type       TEXT,
  parent_id         TEXT,
  is_inline         INTEGER NOT NULL DEFAULT 0,
  archived          INTEGER NOT NULL DEFAULT 0,
  schema_json       TEXT NOT NULL DEFAULT '{}',
  schema_hash       TEXT,
  created_time      TEXT,
  last_edited_time  TEXT,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  removed_at        TEXT
);

-- ── Szerep- és mezőleképezés ──────────────────────────────────────────────────
-- role: task | project | subproject | organization | person | decision |
--       question | log | note | other | ignored
CREATE TABLE IF NOT EXISTS database_mapping (
  database_id          TEXT PRIMARY KEY REFERENCES notion_database(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL DEFAULT 'other',
  role_source          TEXT NOT NULL DEFAULT 'auto',   -- auto | manual
  role_confidence      REAL NOT NULL DEFAULT 0,
  role_reason          TEXT,
  fields_json          TEXT NOT NULL DEFAULT '{}',     -- kanonikus mező -> Notion property név
  fields_source        TEXT NOT NULL DEFAULT 'auto',
  include_in_dashboard INTEGER NOT NULL DEFAULT 1,
  reviewed             INTEGER NOT NULL DEFAULT 0,     -- a felhasználó rábólintott-e
  updated_at           TEXT NOT NULL
);

-- ── Tükrözött oldalak ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS page (
  id                TEXT PRIMARY KEY,
  database_id       TEXT NOT NULL REFERENCES notion_database(id) ON DELETE CASCADE,
  title             TEXT NOT NULL DEFAULT '',
  url               TEXT,
  icon              TEXT,
  archived          INTEGER NOT NULL DEFAULT 0,
  in_trash          INTEGER NOT NULL DEFAULT 0,
  created_time      TEXT,
  last_edited_time  TEXT,
  properties_json   TEXT NOT NULL DEFAULT '{}',
  -- kanonikus oszlopok (a leképezés tölti ki; NULL = nincs ilyen mező)
  c_status          TEXT,
  c_status_group    TEXT,      -- todo | in_progress | blocked | done | unknown
  c_start           TEXT,      -- YYYY-MM-DD
  c_due             TEXT,      -- YYYY-MM-DD
  c_due_end         TEXT,      -- YYYY-MM-DD (tartomány vége)
  c_due_is_time     INTEGER NOT NULL DEFAULT 0,
  c_priority        TEXT,
  c_priority_rank   INTEGER,   -- 0 = legmagasabb
  c_area            TEXT,      -- Üzleti | Társadalmi | Privát
  c_category        TEXT,
  c_health          TEXT,      -- RAG
  c_next_step       TEXT,
  c_background      TEXT,
  c_tags            TEXT,      -- JSON tömb
  c_is_owner        INTEGER NOT NULL DEFAULT 0,
  c_needs_decision  INTEGER NOT NULL DEFAULT 0,
  synced_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_db          ON page(database_id);
CREATE INDEX IF NOT EXISTS idx_page_due         ON page(c_due);
CREATE INDEX IF NOT EXISTS idx_page_statusgroup ON page(c_status_group);
CREATE INDEX IF NOT EXISTS idx_page_owner       ON page(c_is_owner);
CREATE INDEX IF NOT EXISTS idx_page_edited      ON page(last_edited_time);
CREATE INDEX IF NOT EXISTS idx_page_archived    ON page(archived);

-- ── Relation-élek (a struktúra gráfja) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS page_relation (
  from_page_id     TEXT NOT NULL,
  from_database_id TEXT NOT NULL,
  property         TEXT NOT NULL,
  canonical        TEXT,        -- project | subproject | organization | person | assignee | ...
  to_page_id       TEXT NOT NULL,
  PRIMARY KEY (from_page_id, property, to_page_id)
);

CREATE INDEX IF NOT EXISTS idx_rel_to        ON page_relation(to_page_id);
CREATE INDEX IF NOT EXISTS idx_rel_from      ON page_relation(from_page_id);
CREATE INDEX IF NOT EXISTS idx_rel_canonical ON page_relation(canonical, to_page_id);

-- ── Szinkron ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_state (
  database_id        TEXT PRIMARY KEY REFERENCES notion_database(id) ON DELETE CASCADE,
  last_synced_at     TEXT,
  last_edited_cursor TEXT,   -- a legkésőbbi látott last_edited_time
  last_full_sync_at  TEXT,
  page_count         INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT
);

CREATE TABLE IF NOT EXISTS sync_run (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mode            TEXT NOT NULL,        -- full | incremental | discovery
  status          TEXT NOT NULL,        -- running | ok | error
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  databases_seen  INTEGER NOT NULL DEFAULT 0,
  databases_new   INTEGER NOT NULL DEFAULT 0,
  pages_upserted  INTEGER NOT NULL DEFAULT 0,
  pages_removed   INTEGER NOT NULL DEFAULT 0,
  suggestions_new INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  log             TEXT
);

CREATE INDEX IF NOT EXISTS idx_syncrun_started ON sync_run(started_at DESC);

-- ── Javaslatok ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suggestion (
  id             TEXT PRIMARY KEY,      -- determinisztikus: szabály + célpont
  rule           TEXT NOT NULL,
  severity       TEXT NOT NULL,         -- critical | high | medium | low | info
  title          TEXT NOT NULL,
  detail         TEXT,
  page_id        TEXT,
  database_id    TEXT,
  action_json    TEXT,                  -- a visszaírandó változás leírása (vagy NULL)
  status         TEXT NOT NULL DEFAULT 'open',  -- open | applied | dismissed | stale
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  resolved_at    TEXT,
  dismiss_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_sugg_status ON suggestion(status, severity);
CREATE INDEX IF NOT EXISTS idx_sugg_page   ON suggestion(page_id);
CREATE INDEX IF NOT EXISTS idx_sugg_rule   ON suggestion(rule);

-- ── Visszaírás napló (undo-hoz) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS writeback_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id TEXT,
  page_id       TEXT NOT NULL,
  page_title    TEXT,
  action_json   TEXT NOT NULL,
  before_json   TEXT,
  after_json    TEXT,
  status        TEXT NOT NULL,   -- ok | error | dry_run | undone
  error         TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wb_created ON writeback_log(created_at DESC);

-- ── Beállítások ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
