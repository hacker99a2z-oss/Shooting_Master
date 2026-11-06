import { describe, expect, it } from "vitest";
import {
  AD_COOLDOWN_MS, MIN_WITHDRAW_USD, DAILY_GAMES_GOAL, coinsToUsd, prizeForRank, randomBonusCoins,
  rewardForKills, seasonEndsAt,
} from "@/lib/rules";

describe("game rewards & difficulty", () => {
  it("each target hit pays 10 coins", () => {
    expect(rewardForKills(1)).toBe(10);
    expect(rewardForKills(7)).toBe(70);
  });
  it("can't earn for more than 12 kills", () => expect(rewardForKills(50)).toBe(120));
  it("ad timer is 3 minutes", () => expect(AD_COOLDOWN_MS).toBe(180_000));
  it("daily bonus needs 100 games and pays $0.01-$0.05", () => {
    expect(DAILY_GAMES_GOAL).toBe(100);
    expect(coinsToUsd(randomBonusCoins(() => 0))).toBe(0.01);
    expect(coinsToUsd(randomBonusCoins(() => 0.9999))).toBe(0.05);
  });
  it("minimum withdraw is $0.02", () => expect(MIN_WITHDRAW_USD).toBe(0.02));
});

describe("rules", () => {
  it("30 winners share exactly $10", () => {
    let sum = 0;
    for (let r = 1; r <= 30; r++) sum += prizeForRank(r);
    expect(sum).toBeCloseTo(10, 6);
  });
  it("ranks 31-50 get nothing", () => {
    expect(prizeForRank(31)).toBe(0);
    expect(prizeForRank(50)).toBe(0);
  });
  it("neighbouring prizes stay close (under 2 cents apart)", () => {
    for (let r = 1; r < 30; r++) expect(prizeForRank(r) - prizeForRank(r + 1)).toBeLessThan(0.02);
  });
  it("100000 coins = $1", () => {
    expect(coinsToUsd(100_000)).toBe(1);
    expect(coinsToUsd(250_000)).toBe(2.5);
  });
  it("season resets every 2 days", () => {
    const t = Date.UTC(2026, 10, 3, 12);
    const end = seasonEndsAt(t);
    expect(end - seasonEndsAt(end - 1)).toBe(0);
    expect(seasonEndsAt(end) - end).toBe(2 * 24 * 3600 * 1000);
  });
});
