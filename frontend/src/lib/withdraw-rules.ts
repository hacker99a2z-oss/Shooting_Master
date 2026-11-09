import { COINS_PER_USD } from "./rules";

// The wallet page always shows the latest 5 withdrawals.
export const HISTORY_LIMIT = 5;

/** Coins taken for a dollar amount: $0.02 = 2,000 coins. Mirrors the server (cents are floored). */
export function coinsForWithdrawUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round((Math.floor(usd * 100) / 100) * COINS_PER_USD);
}

/** Every withdrawal shows "Pending" until the payout is paid (then "View") or rejected. */
export function isPendingWithdrawal(status: string): boolean {
  return status !== "paid" && status !== "rejected";
}
