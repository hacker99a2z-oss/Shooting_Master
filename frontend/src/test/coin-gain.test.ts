import { describe, expect, it } from "vitest";
import { COIN_COUNT_MS, countUpValue, matchCoins } from "@/lib/coin-gain";

describe("match coins", () => {
  it("pays 10 coins for every enemy killed", () => {
    expect(matchCoins(0)).toBe(0);
    expect(matchCoins(9)).toBe(90);
    expect(matchCoins(12)).toBe(120);
  });
});

describe("profile coin count-up", () => {
  it("starts at the old balance and ends exactly at the new one", () => {
    expect(countUpValue(500, 620, 0)).toBe(500);
    expect(countUpValue(500, 620, COIN_COUNT_MS)).toBe(620);
    expect(countUpValue(500, 620, COIN_COUNT_MS * 5)).toBe(620);
  });

  it("rolls upward in between without ever passing the new balance", () => {
    let last = 500;
    for (let ms = 0; ms <= COIN_COUNT_MS; ms += 50) {
      const v = countUpValue(500, 620, ms);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(620);
      last = v;
    }
    const mid = countUpValue(500, 620, COIN_COUNT_MS / 2);
    expect(mid).toBeGreaterThan(500);
    expect(mid).toBeLessThan(620);
  });
});
