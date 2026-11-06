CREATE TABLE IF NOT EXISTS wallet_destinations (
  tg_id INTEGER PRIMARY KEY REFERENCES players(tg_id),
  address TEXT NOT NULL,
  asset TEXT NOT NULL CHECK (asset = 'USDT'),
  network TEXT NOT NULL CHECK (network = 'BEP20'),
  chain_id INTEGER NOT NULL CHECK (chain_id = 56),
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (6, datetime('now'));