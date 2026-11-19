-- Daily Games goal claims: which goal targets (comma list) were claimed on claimed_goals_date (UTC day).
ALTER TABLE players ADD COLUMN claimed_goals TEXT NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN claimed_goals_date TEXT;
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(9,CURRENT_TIMESTAMP);
