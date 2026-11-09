import { describe, expect, it } from "vitest";
import { MIN_WITHDRAW_USD } from "@/lib/rules";
import { HISTORY_LIMIT, coinsForWithdrawUsd, isPendingWithdrawal } from "@/lib/withdraw-rules";
import { isPhoneDevice } from "@/lib/trust-connect";

describe("withdraw rules", () => {
  it("minimum withdrawal is $0.02", () => expect(MIN_WITHDRAW_USD).toBe(0.02));
  it("$0.02 costs 2,000 coins", () => expect(coinsForWithdrawUsd(0.02)).toBe(2000));
  it("coins scale with the amount", () => expect(coinsForWithdrawUsd(0.5)).toBe(50000));
  it("history shows the last 5 withdrawals", () => expect(HISTORY_LIMIT).toBe(5));
  it("stays pending until paid", () => {
    expect(isPendingWithdrawal("pending_review")).toBe(true);
    expect(isPendingWithdrawal("processing")).toBe(true);
    expect(isPendingWithdrawal("paid")).toBe(false);
  });
});

describe("Trust Wallet device routing", () => {
  it("Telegram on Android/iOS goes to the Trust Wallet app", () => {
    expect(isPhoneDevice("android", "")).toBe(true);
    expect(isPhoneDevice("ios", "")).toBe(true);
  });
  it("Telegram Desktop goes to the Trust Wallet extension", () => expect(isPhoneDevice("tdesktop", "Mozilla/5.0 (Windows NT 10.0)")).toBe(false));
  it("a phone browser outside Telegram goes to the app", () => expect(isPhoneDevice(undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(true));
});

describe("coins shown under the amount", () => {
  it("$1 needs 100,000 coins", () => expect(coinsForWithdrawUsd(1)).toBe(100000));
  it("$0.05 needs 5,000 coins", () => expect(coinsForWithdrawUsd(0.05)).toBe(5000));
  it("an empty amount needs 0 coins", () => expect(coinsForWithdrawUsd(Number(""))).toBe(0));
});
