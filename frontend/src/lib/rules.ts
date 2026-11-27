// Business rules shared by client and server.
export const COINS_PER_USD = 100_000;
export const REFERRAL_REWARD = 100;
export const REFERRAL_GAMES_NEEDED = 10;

// Each round has 9–12 enemies (server-issued). Every enemy killed pays 10 coins.
export const COINS_PER_KILL = 10;
export const MIN_ENEMIES = 9;
export const MAX_ENEMIES = 12;
export function rewardForKills(kills: number): number {
  const k = Math.max(0, Math.min(MAX_ENEMIES, Math.floor(kills)));
  return k * COINS_PER_KILL;
}
// After every ad-unlocked game the next ad unlocks in 3 minutes. The daily free game sets no timer.
export const AD_COOLDOWN_MS = 3 * 60 * 1000;

export const LEADERBOARD_MIN_COINS = 500;
export const LEADERBOARD_SHOWN = 50;
export const PRIZE_WINNERS = 30;
export const PRIZE_POOL_USD = 10;
export const SEASON_MS = 2 * 24 * 60 * 60 * 1000;
export const MIN_WITHDRAW_USD = 0.02;
export const MAX_PENDING_AD_PLAYS = 3;

// Linear prize curve: rank 1 starts at $0.50 and the top 30 share exactly $10.
// Whole-cent amounts use largest remainders so credited prizes total $10.00.
const TOP_PRIZE = 0.5;
const STEP = (PRIZE_WINNERS * TOP_PRIZE - PRIZE_POOL_USD) / ((PRIZE_WINNERS * (PRIZE_WINNERS - 1)) / 2);
const exactPrizeCents = Array.from({ length: PRIZE_WINNERS }, (_, index) =>
  (TOP_PRIZE - index * STEP) * 100,
);
const prizeCents = exactPrizeCents.map((amount) => Math.floor(amount + Number.EPSILON));
const remainingPrizeCents = PRIZE_POOL_USD * 100 - prizeCents.reduce((sum, amount) => sum + amount, 0);
const centPriority = exactPrizeCents
  .map((amount, index) => ({ index, remainder: amount - prizeCents[index] }))
  .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
for (const { index } of centPriority.slice(0, remainingPrizeCents)) {
  prizeCents[index] += 1;
}

export function prizeForRankCents(rank: number): number {
  if (!Number.isInteger(rank) || rank < 1 || rank > PRIZE_WINNERS) return 0;
  return prizeCents[rank - 1];
}

export function prizeForRank(rank: number): number {
  return prizeForRankCents(rank) / 100;
}

export function coinsToUsd(coins: number): number {
  return coins / COINS_PER_USD;
}

export function seasonEndsAt(now = Date.now()): number {
  return (Math.floor(now / SEASON_MS) + 1) * SEASON_MS;
}
