/**
 * Daily Games goals on the home page: games played today out of each target,
 * with the reward shown on that goal's claim button (USD).
 */
export const DAILY_GAME_GOALS = [
  { target: 10, rewardUsd: 0.03 },
  { target: 20, rewardUsd: 0.04 },
] as const;
/** Coins earned for each enemy killed in Battle Arena (shown on the arena card). */
export const COINS_PER_ENEMY = 10;

export function dailyGamesProgress(gamesToday: number, target: number, claimedToday = false) {
  const played = Math.max(0, Math.min(target, Math.floor(Number(gamesToday) || 0)));
  return {
    played,
    target,
    percent: (played / target) * 100,
    claimed: claimedToday,
    canClaim: played >= target && !claimedToday,
  };
}

/** Label for the Home Battle Arena action, based on the server-owned daily free-play flag. */
export function arenaPlayButtonLabel(canPlayFree: boolean, busyLabel = ""): string {
  if (busyLabel) return busyLabel;
  return canPlayFree ? "Play (Daily 1 time)" : "Watch Ads to Play";
}
