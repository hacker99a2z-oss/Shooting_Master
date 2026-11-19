import { withdrawalAmountsFromUsd } from "../withdrawal-approval.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { approvalPayoutLimitError, parseAdminTelegramIds, parseWithdrawalApprovalCallback } from "../withdrawal-approval.ts";

test("admin allowlist accepts positive numeric Telegram IDs and removes duplicates", () => {
  assert.deepEqual(parseAdminTelegramIds("123456789, 987654321;123456789 @owner -55"), [123456789, 987654321]);
  assert.deepEqual(parseAdminTelegramIds(undefined), []);
});
test("approval callback tokens accept only actions and UUID IDs", () => {
  assert.deepEqual(parseWithdrawalApprovalCallback("wd:approve:550e8400-e29b-41d4-a716-446655440000"), { action: "approve", withdrawalId: "550e8400-e29b-41d4-a716-446655440000" });
  assert.deepEqual(parseWithdrawalApprovalCallback("wd:reject:550e8400-e29b-41d4-a716-446655440000"), { action: "reject", withdrawalId: "550e8400-e29b-41d4-a716-446655440000" });
  assert.deepEqual(parseWithdrawalApprovalCallback("wd:retry:550e8400-e29b-41d4-a716-446655440000"), { action: "retry", withdrawalId: "550e8400-e29b-41d4-a716-446655440000" });
  assert.equal(parseWithdrawalApprovalCallback("wd:approve:123"), null);
  assert.equal(parseWithdrawalApprovalCallback("wd:refund:550e8400-e29b-41d4-a716-446655440000"), null);
  assert.equal(parseWithdrawalApprovalCallback("x".repeat(65)), null);
});
test("automatic payout caps still apply to an owner approval", () => {
  assert.equal(approvalPayoutLimitError(0.02, 99.98), null);
  assert.match(approvalPayoutLimitError(10.01, 0) ?? "", /outside the automatic payout limit/);
  assert.match(approvalPayoutLimitError(0.01, 0) ?? "", /outside the automatic payout limit/);
  assert.match(approvalPayoutLimitError(0.02, 100) ?? "", /daily automatic payout limit/);
  assert.equal(approvalPayoutLimitError(10, 90), null);
});

test("withdrawal amounts use exact integer cents and 1,000 coins per cent", () => {
  assert.deepEqual(withdrawalAmountsFromUsd(0.02), { usd: 0.02, usdCents: 2, coins: 2000 });
  assert.deepEqual(withdrawalAmountsFromUsd(0.29), { usd: 0.29, usdCents: 29, coins: 29000 });
  assert.equal(withdrawalAmountsFromUsd(0.019), null);
  assert.equal(withdrawalAmountsFromUsd(0.021), null);
  assert.equal(withdrawalAmountsFromUsd("not-a-number"), null);
});
