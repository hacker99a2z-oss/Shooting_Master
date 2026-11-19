import { COINS_PER_USD } from "./rules";

// The wallet page always shows the latest 5 withdrawals.
export const HISTORY_LIMIT = 5;

/** Coins taken for a dollar amount: $0.02 = 2,000 coins. Mirrors the server (cents are floored). */
export function coinsForWithdrawUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round((Math.floor(usd * 100) / 100) * COINS_PER_USD);
}

/** Any request not paid or rejected stays in the live history poll. */
export function isPendingWithdrawal(status: string): boolean {
  return status !== "paid" && status !== "rejected";
}

/** Human-readable status shown in withdrawal history. */
export function withdrawalStatusLabel(status: string): string {
  switch (status) {
    case "pending_approval": return "Waiting for Approval";
    case "pending_auto":
    case "processing": return "Processing";
    case "pending_review":
    case "payout_failed_review": return "Manual Review";
    case "paid": return "Sent";
    case "rejected": return "Rejected";
    default: return "Pending";
  }
}
