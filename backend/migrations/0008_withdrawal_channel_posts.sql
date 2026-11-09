ALTER TABLE withdrawals ADD COLUMN channel_post_url TEXT;
ALTER TABLE withdrawals ADD COLUMN channel_posted_at TEXT;
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(8,CURRENT_TIMESTAMP);
