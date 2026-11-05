ALTER TABLE withdrawals ADD COLUMN payout_asset TEXT;
ALTER TABLE withdrawals ADD COLUMN payout_network TEXT;
ALTER TABLE withdrawals ADD COLUMN payout_tx_hash TEXT;
ALTER TABLE withdrawals ADD COLUMN payout_raw_tx TEXT;
ALTER TABLE withdrawals ADD COLUMN payout_nonce INTEGER;
ALTER TABLE withdrawals ADD COLUMN payout_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE withdrawals ADD COLUMN payout_error TEXT;
ALTER TABLE withdrawals ADD COLUMN payout_updated_at TEXT;
ALTER TABLE withdrawals ADD COLUMN payout_paid_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_payout_tx_hash
 ON withdrawals(payout_tx_hash) WHERE payout_tx_hash IS NOT NULL;
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(3,CURRENT_TIMESTAMP);
