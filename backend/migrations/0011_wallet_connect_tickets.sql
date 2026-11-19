CREATE TABLE IF NOT EXISTS wallet_connect_tickets (
  ticket_hash TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL REFERENCES players(tg_id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wallet_connect_tickets_player ON wallet_connect_tickets(tg_id, created_at);
INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (11, datetime('now'));
