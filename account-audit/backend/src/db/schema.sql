-- Esquema de la app de auditoría de cuentas de MercadoLibre.
-- Diseñado para guardar histórico diario: el diagnóstico compara "hoy vs.
-- hace 30 días", no solo el estado actual.

CREATE TABLE IF NOT EXISTS sellers (
  seller_id       TEXT PRIMARY KEY,
  nickname        TEXT NOT NULL,
  site_id         TEXT NOT NULL DEFAULT 'MLC',
  reputation_tier TEXT,
  connected_at    TEXT NOT NULL DEFAULT (datetime('now')),
  is_demo         INTEGER NOT NULL DEFAULT 0,
  access_token    TEXT,             -- token real de MercadoLibre (cuentas no-demo)
  refresh_token   TEXT,
  token_expires_at TEXT,
  last_synced_at  TEXT
);

CREATE TABLE IF NOT EXISTS items (
  item_id      TEXT PRIMARY KEY,
  seller_id    TEXT NOT NULL REFERENCES sellers(seller_id),
  title        TEXT NOT NULL,
  category     TEXT,
  price        REAL NOT NULL,
  base_cost    REAL,               -- costo de producto (para margen/ROAS objetivo)
  status       TEXT DEFAULT 'active',
  has_full     INTEGER DEFAULT 0,
  free_shipping INTEGER DEFAULT 0,
  photos_count INTEGER DEFAULT 0,
  catalog      INTEGER DEFAULT 0,
  permalink    TEXT,                 -- URL pública de la publicación en MercadoLibre
  variations_count INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL REFERENCES items(item_id),
  date         TEXT NOT NULL,      -- YYYY-MM-DD
  units        INTEGER NOT NULL,
  revenue      REAL NOT NULL,
  orders       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_item_date ON sales(item_id, date);

CREATE TABLE IF NOT EXISTS visits (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id  TEXT NOT NULL REFERENCES items(item_id),
  date     TEXT NOT NULL,
  visits   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visits_item_date ON visits(item_id, date);

CREATE TABLE IF NOT EXISTS ads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL REFERENCES items(item_id),
  date         TEXT NOT NULL,
  investment   REAL NOT NULL DEFAULT 0,
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  ad_sales     REAL NOT NULL DEFAULT 0,   -- facturación atribuida a publicidad
  ad_units     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ads_item_date ON ads(item_id, date);

CREATE TABLE IF NOT EXISTS inventory (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id  TEXT NOT NULL REFERENCES items(item_id),
  date     TEXT NOT NULL,
  stock    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_item_date ON inventory(item_id, date);

CREATE TABLE IF NOT EXISTS reputation (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id     TEXT NOT NULL REFERENCES sellers(seller_id),
  date          TEXT NOT NULL,
  claims        INTEGER NOT NULL DEFAULT 0,
  cancellations INTEGER NOT NULL DEFAULT 0,
  delays        INTEGER NOT NULL DEFAULT 0,
  returns       INTEGER NOT NULL DEFAULT 0,
  return_reason_mismatch INTEGER NOT NULL DEFAULT 0, -- "producto distinto a expectativa"
  return_reason_size      INTEGER NOT NULL DEFAULT 0,
  return_reason_quality    INTEGER NOT NULL DEFAULT 0,
  reputation_score INTEGER,
  claims_rate        REAL,  -- % ya calculado por MercadoLibre (metrics.claims.rate), no recalculado
  cancellations_rate REAL,
  delays_rate        REAL,
  transactions_total     INTEGER,  -- seller_reputation.transactions (histórico de la cuenta)
  transactions_completed INTEGER,
  transactions_canceled  INTEGER,
  ratings_positive_pct REAL,       -- seller_reputation.transactions.ratings, ya en %
  ratings_negative_pct REAL,
  ratings_neutral_pct  REAL,
  sales_completed_60d  INTEGER     -- seller_reputation.metrics.sales.completed
);
CREATE INDEX IF NOT EXISTS idx_reputation_seller_date ON reputation(seller_id, date);

-- Reclamos por publicación (API de post-venta de MercadoLibre), para
-- "Productos con más problemas". Se recalcula completo en cada sync.
CREATE TABLE IF NOT EXISTS item_claims (
  item_id      TEXT PRIMARY KEY REFERENCES items(item_id),
  claims_count INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     TEXT NOT NULL REFERENCES items(item_id),
  competitor_price REAL NOT NULL,
  has_full    INTEGER DEFAULT 0,
  free_shipping INTEGER DEFAULT 0,
  reputation  INTEGER,
  sold_qty    INTEGER,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recommendations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id    TEXT NOT NULL REFERENCES sellers(seller_id),
  item_id      TEXT REFERENCES items(item_id),
  category     TEXT NOT NULL,      -- ventas, conversion, publicidad, stock, reputacion, etc.
  problem      TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  impact       INTEGER NOT NULL,   -- 1-10
  urgency      INTEGER NOT NULL,   -- 1-10
  ease         INTEGER NOT NULL,   -- 1-10
  priority_score REAL NOT NULL,
  priority_band  TEXT NOT NULL,    -- alta / media / baja
  horizon        TEXT NOT NULL,    -- 24-48h / 7d / 30d
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recommendations_seller ON recommendations(seller_id);
