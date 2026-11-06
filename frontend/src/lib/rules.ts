// Business rules shared by client and server.
export const COINS_PER_USD = 100_000;
export const REFERRAL_REWARD = 100;
export const REFERRAL_GAMES_NEEDED = 10;

// Each match has a random total of 9–12 enemies. Every kill pays 10 coins.
// The match ends once all of them are down (or the hero dies).
export const COINS_PER_KILL = 10;
export const MIN_ENEMIES = 9;
export const MAX_ENEMIES = 12;
export function rewardForKills(kills: number): number {
  const k = Math.max(0, Math.min(MAX_ENEMIES, Math.floor(kills)));
  return k * COINS_PER_KILL;
}
export function randomEnemyTotal(rand = Math.random): number {
  return MIN_ENEMIES + Math.floor(rand() * (MAX_ENEMIES - MIN_ENEMIES + 1));
}
// Waves: 1, then 1, then 2 together, then 3, then 4; after that random 2–4. Last wave is trimmed to the total.
export function wavePlan(total: number, rand = Math.random): number[] {
  const start = [1, 1, 2, 3, 4];
  const waves: number[] = [];
  let left = total;
  for (let i = 0; left > 0; i++) {
    const want = i < start.length ? start[i]! : 2 + Math.floor(rand() * 3);
    const n = Math.min(want, left);
    waves.push(n);
    left -= n;
  }
  return waves;
}

// Archery: the server's 9–12 total is the number of targets. One target is shown at a time.
// The first stays up for 4 s, the last for 1 s, evenly shorter in between.
// The first targets stand still; after that they move, faster and less predictably each time.
export const FIRST_TARGET_MS = 4000;
export const LAST_TARGET_MS = 1000;
export const STATIC_TARGETS = 3;
export const MAX_TARGET_SPEED = 0.6; // field widths per second for the very last target
export function targetLifetimeMs(index: number, total: number): number {
  if (total <= 1) return FIRST_TARGET_MS;
  const t = Math.max(0, Math.min(1, index / (total - 1)));
  return Math.round(FIRST_TARGET_MS - (FIRST_TARGET_MS - LAST_TARGET_MS) * t);
}
export function targetSpeed(index: number, total: number): number {
  if (index < STATIC_TARGETS) return 0;
  const span = Math.max(1, total - 1 - STATIC_TARGETS);
  const t = Math.max(0, Math.min(1, (index - STATIC_TARGETS) / span));
  return Math.round((0.15 + (MAX_TARGET_SPEED - 0.15) * t) * 100) / 100;
}
// Fast targets also dodge up/down and change direction at random.
export const targetZigzags = (index: number, total: number) => targetSpeed(index, total) >= 0.35;

// After every ad-unlocked game the next ad unlocks in 3 minutes. The daily free game sets no timer.
export const AD_COOLDOWN_MS = 3 * 60 * 1000;

// Daily challenge: play 100 games in one day, then claim a random $0.01–$0.05 bonus.
export const DAILY_GAMES_GOAL = 100;
export const BONUS_MIN_COINS = 1_000; // $0.01
export const BONUS_MAX_COINS = 5_000; // $0.05
export function randomBonusCoins(rand = Math.random): number {
  const steps = (BONUS_MAX_COINS - BONUS_MIN_COINS) / 100;
  return BONUS_MIN_COINS + Math.floor(rand() * (steps + 1)) * 100;
}

export const LEADERBOARD_MIN_COINS = 500;
export const LEADERBOARD_SHOWN = 50;
export const PRIZE_WINNERS = 30;
export const PRIZE_POOL_USD = 10;
export const SEASON_MS = 2 * 24 * 60 * 60 * 1000;
export const MIN_WITHDRAW_USD = 0.02;
export const MAX_PENDING_AD_PLAYS = 3;

// Linear prize curve: rank 1 gets $0.50, each rank drops by the same small step,
// so neighbouring winners differ by ~1 cent and the 30 prizes sum to $10.
const TOP_PRIZE = 0.5;
const STEP = (PRIZE_WINNERS * TOP_PRIZE - PRIZE_POOL_USD) / ((PRIZE_WINNERS * (PRIZE_WINNERS - 1)) / 2);

export function prizeForRank(rank: number): number {
  if (rank < 1 || rank > PRIZE_WINNERS) return 0;
  return TOP_PRIZE - (rank - 1) * STEP;
}

export function coinsToUsd(coins: number): number {
  return coins / COINS_PER_USD;
}

export function seasonEndsAt(now = Date.now()): number {
  return (Math.floor(now / SEASON_MS) + 1) * SEASON_MS;
}
