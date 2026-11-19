import { COINS_PER_USD } from "./rules";

// The wallet page always shows the latest 5 withdrawals.
export const HISTORY_LIMIT = 5;

/** Whole USD cents required for a withdrawal; accepts only cent-precision values. */
export function withdrawalCentsForUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const cents = Math.round(usd * 100);
  return Math.abs(usd - cents / 100) <= 1e-8 ? cents : 0;
}

/** Coins required alongside withdraw balance: 1,000 coins per cent ($0.02 = 2,000). */
export function coinsForWithdrawUsd(usd: number): number {
  return withdrawalCentsForUsd(usd) * (COINS_PER_USD / 100);
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
    case "paid": return "View";
    case "rejected": return "Rejected";
    default: return "Pending";
  }
}
