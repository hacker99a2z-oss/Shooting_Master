/** Daily Games card on the home page: games played today out of this target. */
export const DAILY_GAMES_TARGET = 20;
/** Reward shown on the Daily Games claim button, in USD. */
export const DAILY_GAMES_REWARD_USD = 0.03;
/** Coins earned for each enemy killed in Battle Arena (shown on the arena card). */
export const COINS_PER_ENEMY = 10;

export function dailyGamesProgress(gamesToday: number) {
  const played = Math.max(0, Math.min(DAILY_GAMES_TARGET, Math.floor(Number(gamesToday) || 0)));
  return {
    played,
    target: DAILY_GAMES_TARGET,
    percent: (played / DAILY_GAMES_TARGET) * 100,
    canClaim: played >= DAILY_GAMES_TARGET,
  };
}
