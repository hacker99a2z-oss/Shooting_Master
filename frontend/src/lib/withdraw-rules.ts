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

export type WithdrawalEligibilityReason =
  | "below_minimum"
  | "invalid_amount"
  | "invalid_precision"
  | "insufficient_balance"
  | "insufficient_coins"
  | "wallet_not_connected"
  | "ready";

/** A saved desktop-extension connection has no injected provider inside Telegram's WebView. */
export function isWalletConnectionReady(input: {
  connected: boolean;
  walletProviderAvailable: boolean;
  externalWalletVerified: boolean;
  walletAddress: string;
}): boolean {
  return input.connected &&
    (input.walletProviderAvailable || input.externalWalletVerified) &&
    Boolean(input.walletAddress);
}

export type WithdrawalEligibility = {
  canWithdraw: boolean;
  reason: WithdrawalEligibilityReason;
  message: string;
  requiredCents: number;
  requiredCoins: number;
};

/** Check the requested amount in order: minimum, Coins, withdraw balance, then wallet. */
export function checkWithdrawalEligibility(input: {
  usd: number;
  minimumUsd: number;
  withdrawBalanceCents: number;
  coins: number;
  walletConnected: boolean;
}): WithdrawalEligibility {
  const { usd, minimumUsd, withdrawBalanceCents, coins, walletConnected } = input;
  const requiredCents = withdrawalCentsForUsd(usd);
  const requiredCoins = coinsForWithdrawUsd(usd);

  let reason: WithdrawalEligibilityReason = "ready";
  let message = "";

  if (!Number.isFinite(usd) || usd <= 0) {
    reason = "invalid_amount";
    message = "Enter a valid withdrawal amount.";
  } else if (usd < minimumUsd) {
    reason = "below_minimum";
    message = `Minimum withdrawal is $${minimumUsd.toFixed(2)}.`;
  } else if (requiredCents < 1) {
    reason = "invalid_precision";
    message = "Enter an amount using up to 2 decimal places.";
  } else if (requiredCoins > coins) {
    reason = "insufficient_coins";
    message = `Need ${(requiredCoins - coins).toLocaleString()} more coins.`;
  } else if (requiredCents > withdrawBalanceCents) {
    reason = "insufficient_balance";
    message = `Need $${((requiredCents - withdrawBalanceCents) / 100).toFixed(2)} more withdraw balance.`;
  } else if (!walletConnected) {
    reason = "wallet_not_connected";
    message = "Connect Trust Wallet to continue.";
  }

  return {
    canWithdraw: reason === "ready",
    reason,
    message,
    requiredCents,
    requiredCoins,
  };
}
