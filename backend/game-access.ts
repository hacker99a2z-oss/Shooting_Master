export function dailyFreePlayAvailable(lastPlayDate: unknown, today: string): boolean {
  return typeof lastPlayDate !== "string" || lastPlayDate !== today;
}

export function rewardedAdSessionEligible(status: unknown, expiresAt: unknown, now: number): boolean {
  return status === "rewarded" && Number.isFinite(Number(expiresAt)) && Number(expiresAt) >= now;
}

export function activeAdSession(status: unknown, expiresAt: unknown, now: number): boolean {
  return (status === "created" || status === "awaiting_postback") &&
    Number.isFinite(Number(expiresAt)) && Number(expiresAt) >= now;
}

/** Minimum wait after a completed Battle Arena match before another rewarded ad can start. */
export const AD_COOLDOWN_MS = 150_000;

export function nextAdReadyAt(completedAt: number): number {
  return Math.floor(completedAt) + AD_COOLDOWN_MS;
}
