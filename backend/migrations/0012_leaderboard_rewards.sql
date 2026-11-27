CREATE TABLE IF NOT EXISTS leaderboard_season_settlements (
  season_id INTEGER PRIMARY KEY,
  settled_at TEXT NOT NULL,
  winner_count INTEGER NOT NULL DEFAULT 0 CHECK(winner_count BETWEEN 0 AND 30),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents BETWEEN 0 AND 1000)
);

CREATE TABLE IF NOT EXISTS leaderboard_season_rewards (
  season_id INTEGER NOT NULL,
  tg_id INTEGER NOT NULL,
  final_rank INTEGER NOT NULL CHECK(final_rank BETWEEN 1 AND 30),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(season_id, tg_id),
  UNIQUE(season_id, final_rank),
  FOREIGN KEY(season_id) REFERENCES leaderboard_season_settlements(season_id),
  FOREIGN KEY(tg_id) REFERENCES players(tg_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_season_rewards_player
  ON leaderboard_season_rewards(tg_id, season_id DESC);

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES(12, CURRENT_TIMESTAMP);
