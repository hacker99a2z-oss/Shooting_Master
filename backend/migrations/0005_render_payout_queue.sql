CREATE TABLE IF NOT EXISTS render_payout_jobs (
  id TEXT PRIMARY KEY,
  withdrawal_id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  lease_until INTEGER,
  owner_token TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_render_payout_jobs_ready
  ON render_payout_jobs(status, available_at, created_at);
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(5, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS render_payout_worker_lock (
  id TEXT PRIMARY KEY,
  owner_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO render_payout_worker_lock(id, owner_token, lease_until)
  VALUES('ton-wallet', NULL, 0);
