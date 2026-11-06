import { describe, expect, it } from "vitest";
import { COINS_PER_KILL, MAX_ENEMIES, MIN_ENEMIES, rewardForKills, targetLifetimeMs, targetSpeed, targetZigzags } from "@/lib/rules";

describe("archery targets", () => {
  it("each match has 9–12 targets", () => { expect(MIN_ENEMIES).toBe(9); expect(MAX_ENEMIES).toBe(12); });
  it.each([9, 10, 11, 12])("with %i targets the first stays 4 s and the last 1 s", (total) => {
    expect(targetLifetimeMs(0, total)).toBe(4000);
    expect(targetLifetimeMs(total - 1, total)).toBe(1000);
  });
  it("every next target stays up for less time", () => {
    for (let i = 1; i < 12; i++) expect(targetLifetimeMs(i, 12)).toBeLessThan(targetLifetimeMs(i - 1, 12));
  });
  it("first targets stand still, later ones move faster and faster", () => {
    expect(targetSpeed(0, 10)).toBe(0);
    expect(targetSpeed(2, 10)).toBe(0);
    expect(targetSpeed(3, 10)).toBeGreaterThan(0);
    for (let i = 4; i < 10; i++) expect(targetSpeed(i, 10)).toBeGreaterThan(targetSpeed(i - 1, 10));
    expect(targetZigzags(0, 10)).toBe(false);
    expect(targetZigzags(9, 10)).toBe(true);
  });
  it("each target hit pays 10 coins", () => {
    expect(COINS_PER_KILL).toBe(10);
    expect(rewardForKills(7)).toBe(70);
  });
});
