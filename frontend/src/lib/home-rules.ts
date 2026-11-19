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

/** Format a remaining server-supplied cooldown as mm:ss. */
export function formatAdCooldown(remainingSeconds: number): string {
  const total = Math.max(0, Math.ceil(Number(remainingSeconds) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Home Battle Arena action label, based on server-owned free-play and ad cooldown state. */
export function arenaPlayButtonLabel(canPlayFree: boolean, cooldownSeconds = 0): string {
  if (canPlayFree) return "Play (Daily 1 time)";
  const remaining = Math.max(0, Math.ceil(Number(cooldownSeconds) || 0));
  return remaining > 0 ? `Watch Ads to Play (${formatAdCooldown(remaining)})` : "Watch Ads to Play";
}
