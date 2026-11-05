ALTER TABLE game_sessions ADD COLUMN ad_session_id TEXT;
ALTER TABLE game_sessions ADD COLUMN pending_score INTEGER;
ALTER TABLE game_sessions ADD COLUMN pending_kills INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_sessions_ad_session
 ON game_sessions(ad_session_id) WHERE ad_session_id IS NOT NULL;
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,CURRENT_TIMESTAMP);
