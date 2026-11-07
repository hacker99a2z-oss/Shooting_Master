-- Energy, daily energy bonus and gold mining. Gold values are integer milli-gold (1 = 0.001 gold).
ALTER TABLE players ADD COLUMN energy INTEGER NOT NULL DEFAULT 0 CHECK(energy>=0);
ALTER TABLE players ADD COLUMN energy_bonus_date TEXT;
ALTER TABLE players ADD COLUMN mine_energy INTEGER NOT NULL DEFAULT 0 CHECK(mine_energy BETWEEN 0 AND 1000);
ALTER TABLE players ADD COLUMN mine_updated_at INTEGER;
ALTER TABLE players ADD COLUMN gold_pending INTEGER NOT NULL DEFAULT 0 CHECK(gold_pending>=0);
ALTER TABLE players ADD COLUMN gold INTEGER NOT NULL DEFAULT 0 CHECK(gold>=0);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(7,CURRENT_TIMESTAMP);
