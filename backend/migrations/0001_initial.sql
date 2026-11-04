CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players (
 tg_id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, username TEXT, photo_url TEXT,
 coins INTEGER NOT NULL DEFAULT 0 CHECK(coins>=0), season_coins INTEGER NOT NULL DEFAULT 0 CHECK(season_coins>=0),
 season_id INTEGER NOT NULL DEFAULT 0, games_played INTEGER NOT NULL DEFAULT 0, best_score INTEGER NOT NULL DEFAULT 0,
 last_play_date TEXT, extra_plays INTEGER NOT NULL DEFAULT 0 CHECK(extra_plays BETWEEN 0 AND 3), ad_ready_at INTEGER,
 daily_games INTEGER NOT NULL DEFAULT 0, daily_games_date TEXT, bonus_claimed_date TEXT,
 referred_by INTEGER, referral_count INTEGER NOT NULL DEFAULT 0, referral_paid INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, FOREIGN KEY(referred_by) REFERENCES players(tg_id)
);
CREATE TABLE IF NOT EXISTS game_sessions (
 id TEXT PRIMARY KEY, tg_id INTEGER NOT NULL, enemy_total INTEGER NOT NULL CHECK(enemy_total BETWEEN 9 AND 12),
 uses_extra_play INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 consumed_at INTEGER, FOREIGN KEY(tg_id) REFERENCES players(tg_id)
);
CREATE TABLE IF NOT EXISTS ad_sessions (
 id TEXT PRIMARY KEY, tg_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'created',
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, rewarded_at INTEGER,
 FOREIGN KEY(tg_id) REFERENCES players(tg_id)
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id TEXT PRIMARY KEY, tg_id INTEGER NOT NULL, coins INTEGER NOT NULL, usd REAL NOT NULL,
 wallet TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
 FOREIGN KEY(tg_id) REFERENCES players(tg_id)
);
CREATE TABLE IF NOT EXISTS referral_rewards (
 referred_tg_id INTEGER PRIMARY KEY, referrer_tg_id INTEGER NOT NULL, reward INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payout_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, withdrawal_id TEXT NOT NULL, event_type TEXT NOT NULL,
 payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(withdrawal_id,event_type),
 FOREIGN KEY(withdrawal_id) REFERENCES withdrawals(id)
);
CREATE INDEX IF NOT EXISTS idx_players_leaderboard ON players(season_id,season_coins DESC,created_at ASC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_active ON game_sessions(tg_id,expires_at,consumed_at);
CREATE INDEX IF NOT EXISTS idx_ad_sessions_active ON ad_sessions(tg_id,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_player ON withdrawals(tg_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status,created_at);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,CURRENT_TIMESTAMP);
