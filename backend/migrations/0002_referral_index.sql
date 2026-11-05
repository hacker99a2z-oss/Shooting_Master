-- Speed up correlated referral-count lookups as the player table grows.
CREATE INDEX IF NOT EXISTS idx_players_referred_by ON players(referred_by);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,CURRENT_TIMESTAMP);
