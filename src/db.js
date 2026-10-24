const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'calendar.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',      -- admin | editor | viewer
  ics_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',      -- mirakl | manual
  color TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT,
  shop_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sync_promotions INTEGER NOT NULL DEFAULT 1,
  sync_discounts INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_sync_status TEXT,                    -- ok | error | partial
  last_sync_message TEXT,
  sort INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  type TEXT NOT NULL,                       -- promotion | retailer_event | discount | newsletter | sale | deadline | note
  title TEXT NOT NULL,
  description TEXT,
  start_date TEXT NOT NULL,                 -- YYYY-MM-DD (inclusive)
  end_date TEXT NOT NULL,                   -- YYYY-MM-DD (inclusive)
  participation TEXT,                       -- invited | considering | joined | declined | not_joined
  discount_label TEXT,
  promo_code TEXT,
  link TEXT,
  owner TEXT,
  newsletter_status TEXT,                   -- idea | draft | scheduled | sent
  source TEXT NOT NULL DEFAULT 'manual',    -- manual | mirakl | mirakl_discount
  external_id TEXT,
  external_state TEXT,
  raw TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS events_external ON events(source, channel_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_dates ON events(start_date, end_date);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT,
  message TEXT
);
`);

const DEFAULT_CHANNELS = [
  { id: 'nordstrom', name: 'Nordstrom', kind: 'mirakl', color: '#1F2937', env: 'NORDSTROM', sort: 1 },
  { id: 'macys', name: "Macy's", kind: 'mirakl', color: '#D61F26', env: 'MACYS', sort: 2 },
  { id: 'kohls', name: "Kohl's", kind: 'mirakl', color: '#7C3AED', env: 'KOHLS', sort: 3 },
  { id: 'jcpenney', name: 'JCPenney', kind: 'mirakl', color: '#2563EB', env: 'JCPENNEY', sort: 4 },
  { id: 'debenhams', name: 'Debenhams', kind: 'mirakl', color: '#0D9488', env: 'DEBENHAMS', sort: 5 },
  { id: 'target', name: 'Target Plus', kind: 'manual', color: '#EA580C', sort: 6 },
  { id: 'shopify', name: 'Shopify (DTC)', kind: 'manual', color: '#16A34A', sort: 7 },
  { id: 'newsletter', name: 'Menina Newsletter', kind: 'manual', color: '#DB2777', sort: 8 },
  { id: 'store', name: 'Kendall Store', kind: 'manual', color: '#CA8A04', sort: 9 }
];

function seedChannels() {
  const insert = db.prepare(`INSERT OR IGNORE INTO channels (id, name, kind, color, base_url, api_key, shop_id, sort)
    VALUES (@id, @name, @kind, @color, @base_url, @api_key, @shop_id, @sort)`);
  const fill = db.prepare(`UPDATE channels SET
      base_url = COALESCE(NULLIF(base_url, ''), @base_url),
      api_key  = COALESCE(NULLIF(api_key, ''), @api_key),
      shop_id  = COALESCE(NULLIF(shop_id, ''), @shop_id)
    WHERE id = @id`);
  for (const c of DEFAULT_CHANNELS) {
    const row = {
      ...c,
      base_url: c.env ? process.env[`MIRAKL_${c.env}_URL`] || null : null,
      api_key: c.env ? process.env[`MIRAKL_${c.env}_KEY`] || null : null,
      shop_id: c.env ? process.env[`MIRAKL_${c.env}_SHOP_ID`] || null : null
    };
    insert.run(row);
    if (c.env) fill.run(row);
  }
}

module.exports = { db, seedChannels, DEFAULT_CHANNELS };
