import { describe, expect, it } from "vitest";
import { MIN_WITHDRAW_USD } from "@/lib/rules";
import { HISTORY_LIMIT, coinsForWithdrawUsd, withdrawalCentsForUsd, checkWithdrawalEligibility, isPendingWithdrawal, isWalletConnectionReady, withdrawalStatusLabel } from "@/lib/withdraw-rules";
import { isPhoneDevice } from "@/lib/trust-connect";
import { shortenWalletAddress } from "@/lib/wallet-rules";

describe("withdraw rules", () => {
  it("accepts a verified desktop extension bridge without an injected provider in Telegram", () => {
    expect(isWalletConnectionReady({
      connected: true,
      walletProviderAvailable: false,
      externalWalletVerified: true,
      walletAddress: "0xCAa719Ad000000000000000000000000C772C50Ef1",
      lastWalletAddress: "0xcaa719ad000000000000000000000000c772c50ef1",
    })).toBe(true);
  });

  it("does not accept a displayed saved address alone until a wallet path is verified", () => {
    expect(isWalletConnectionReady({
      connected: true,
      walletProviderAvailable: false,
      externalWalletVerified: false,
      walletAddress: "0xCAa719Ad000000000000000000000000C772C50Ef1",
      lastWalletAddress: "0xCAa719Ad000000000000000000000000C772C50Ef1",
    })).toBe(false);
  });

  it("rejects a wallet address that differs from the saved address", () => {
    expect(isWalletConnectionReady({
      connected: true,
      walletProviderAvailable: true,
      externalWalletVerified: false,
      walletAddress: "0x1111111111111111111111111111111111111111",
      lastWalletAddress: "0x2222222222222222222222222222222222222222",
    })).toBe(false);
  });

  it("minimum withdrawal is $0.02", () => expect(MIN_WITHDRAW_USD).toBe(0.02));
  it("$0.02 costs 2,000 coins and requires two cents balance", () => {
    expect(coinsForWithdrawUsd(0.02)).toBe(2000);
    expect(withdrawalCentsForUsd(0.02)).toBe(2);
  });
  it("uses exact cents for decimal amounts", () => {
    expect(withdrawalCentsForUsd(0.29)).toBe(29);
    expect(coinsForWithdrawUsd(0.29)).toBe(29000);
    expect(withdrawalCentsForUsd(0.021)).toBe(0);
  });
  it("coins scale with the amount", () => expect(coinsForWithdrawUsd(0.5)).toBe(50000));

  it("checks minimum amount before either available balance", () => {
    const result = checkWithdrawalEligibility({
      usd: 0.01, minimumUsd: 0.02, withdrawBalanceCents: 100, coins: 100000, walletConnected: true,
    });
    expect(result.canWithdraw).toBe(false);
    expect(result.reason).toBe("below_minimum");
    expect(result.message).toBe("Minimum withdrawal is $0.02.");
  });

  it("checks required Coins before withdraw balance", () => {
    const result = checkWithdrawalEligibility({
      usd: 0.02, minimumUsd: 0.02, withdrawBalanceCents: 2, coins: 1000, walletConnected: true,
    });
    expect(result.reason).toBe("insufficient_coins");
    expect(result.message).toBe("Need 1,000 more coins.");
    expect(result.canWithdraw).toBe(false);
  });

  it("checks withdraw balance after Coins are sufficient", () => {
    const result = checkWithdrawalEligibility({
      usd: 0.02, minimumUsd: 0.02, withdrawBalanceCents: 1, coins: 100000, walletConnected: true,
    });
    expect(result.reason).toBe("insufficient_balance");
    expect(result.message).toBe("Need $0.01 more withdraw balance.");
    expect(result.canWithdraw).toBe(false);
  });

  it("shows only the missing Coins for a $0.05 withdrawal", () => {
    const result = checkWithdrawalEligibility({
      usd: 0.05, minimumUsd: 0.02, withdrawBalanceCents: 5, coins: 4000, walletConnected: true,
    });
    expect(result.reason).toBe("insufficient_coins");
    expect(result.message).toBe("Need 1,000 more coins.");
    expect(result.requiredCoins).toBe(5000);
  });

  it("shows only the missing withdraw balance when the requested amount exceeds the cash balance", () => {
    const result = checkWithdrawalEligibility({
      usd: 0.10, minimumUsd: 0.02, withdrawBalanceCents: 5, coins: 10000, walletConnected: true,
    });
    expect(result.reason).toBe("insufficient_balance");
    expect(result.message).toBe("Need $0.05 more withdraw balance.");
  });

  it("shows $0.02 more when $0.07 is requested but only $0.05 withdraw balance exists", () => {
    const result = checkWithdrawalEligibility({
      usd: 0.07, minimumUsd: 0.02, withdrawBalanceCents: 5, coins: 7000, walletConnected: true,
    });
    expect(result.reason).toBe("insufficient_balance");
    expect(result.message).toBe("Need $0.02 more withdraw balance.");
  });


  it("enables Withdraw only when minimum, balance, Coins and wallet all pass", () => {
    const result = checkWithdrawalEligibility({
      usd: 0.02, minimumUsd: 0.02, withdrawBalanceCents: 2, coins: 2000, walletConnected: true,
    });
    expect(result.canWithdraw).toBe(true);
    expect(result.reason).toBe("ready");
    expect(result.message).toBe("");
  });

  it("requires a connected wallet after amount and balances pass", () => {
    const result = checkWithdrawalEligibility({
      usd: 0.02, minimumUsd: 0.02, withdrawBalanceCents: 2, coins: 2000, walletConnected: false,
    });
    expect(result.reason).toBe("wallet_not_connected");
  });

  it("history shows the last 5 withdrawals", () => expect(HISTORY_LIMIT).toBe(5));
  it("stays pending until paid", () => {
    expect(isPendingWithdrawal("pending_review")).toBe(true);
    expect(isPendingWithdrawal("processing")).toBe(true);
    expect(isPendingWithdrawal("paid")).toBe(false);
  });
  it("shows the approval and payout stages clearly", () => {
    expect(withdrawalStatusLabel("pending_approval")).toBe("Waiting for Approval");
    expect(withdrawalStatusLabel("pending_auto")).toBe("Processing");
    expect(withdrawalStatusLabel("processing")).toBe("Processing");
    expect(withdrawalStatusLabel("pending_review")).toBe("Manual Review");
    expect(withdrawalStatusLabel("payout_failed_review")).toBe("Manual Review");
    expect(withdrawalStatusLabel("paid")).toBe("View");
    expect(withdrawalStatusLabel("rejected")).toBe("Rejected");
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

describe("wallet address shown beside the amount", () => {
  it("keeps the first 6 and last 4 characters with dots between them", () => {
    expect(shortenWalletAddress("0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a01")).toBe("0x1a2b...9a01");
  });
  it("leaves a short value untouched", () => expect(shortenWalletAddress("0x1a2b3c")).toBe("0x1a2b3c"));
  it("has nothing to show before a wallet is connected", () => expect(shortenWalletAddress("")).toBe(""));
});
