ALTER TABLE players ADD COLUMN withdraw_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(withdraw_balance_cents>=0);
ALTER TABLE withdrawals ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(balance_cents>=0);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(10,CURRENT_TIMESTAMP);
