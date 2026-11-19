export type WithdrawalApprovalAction = "approve" | "reject" | "retry";

export function parseAdminTelegramIds(value: string | undefined): number[] {
  const ids = (value ?? "").split(/[\s,;]+/).map((part) => part.trim())
    .filter((part) => /^\d{1,16}$/.test(part)).map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)];
}

export function parseWithdrawalApprovalCallback(value: unknown): { action: WithdrawalApprovalAction; withdrawalId: string } | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const match = /^wd:(approve|reject|retry):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(value);
  return match ? { action: match[1].toLowerCase() as WithdrawalApprovalAction, withdrawalId: match[2].toLowerCase() } : null;
}

export function approvalPayoutLimitError(usd: number, alreadyCommittedTodayUsd: number): string | null {
  if (!Number.isFinite(usd) || usd < 0.02 || usd > 10) return "This withdrawal is outside the automatic payout limit ($0.02–$10).";
  if (!Number.isFinite(alreadyCommittedTodayUsd) || alreadyCommittedTodayUsd < 0) return "The daily payout total could not be verified.";
  if (Math.round(usd * 100) + Math.round(alreadyCommittedTodayUsd * 100) > 10_000) return "The $100 daily automatic payout limit has been reached.";
  return null;
}

export function withdrawalAmountsFromUsd(value: unknown): { usd: number; usdCents: number; coins: number } | null {
  const rawUsd = Number(value);
  if (!Number.isFinite(rawUsd)) return null;
  const usdCents = Math.round(rawUsd * 100);
  if (!Number.isSafeInteger(usdCents) || usdCents < 2 || Math.abs(rawUsd - usdCents / 100) > 1e-8) return null;
  return { usd: usdCents / 100, usdCents, coins: usdCents * 1_000 };
}
