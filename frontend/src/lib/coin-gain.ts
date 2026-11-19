/**
 * Coins won in a match count up on the home profile card: the number rolls
 * from the old balance to the new one. Pure so the timing stays unit-tested.
 */
import { COINS_PER_ENEMY } from "@/lib/home-rules";

export type CoinGain = { from: number; to: number; gained: number };
/** Query-cache key the finished match leaves the gain under for the home page. */
export const COIN_GAIN_KEY = ["coin-gain"] as const;
/** How long the count-up runs, after a short pause so the card is on screen. */
export const COIN_COUNT_MS = 1400;
export const COIN_COUNT_DELAY_MS = 350;

/** Coins a match pays: COINS_PER_ENEMY for each enemy killed. */
export function matchCoins(kills: number) {
  return Math.max(0, Math.floor(kills)) * COINS_PER_ENEMY;
}

/** Balance shown `elapsed` ms into the count-up (eases out, whole coins, never past `to`). */
export function countUpValue(from: number, to: number, elapsed: number, duration = COIN_COUNT_MS) {
  if (elapsed <= 0) return from;
  if (elapsed >= duration) return to;
  const t = elapsed / duration;
  const eased = 1 - (1 - t) ** 3;
  const v = Math.round(from + (to - from) * eased);
  return to >= from ? Math.min(to, v) : Math.max(to, v);
}
