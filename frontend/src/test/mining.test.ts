import { describe, expect, it } from "vitest";
import { giveToMine, mineRemainingMs, settleMine, formatGold } from "../../../backend/mining";

const MIN = 60_000;
const T = 1_800_000_000_000;

describe("gold mining rules", () => {
  it("each 10 energy mines 0.001 gold after 2 minutes", () => {
    const s = settleMine({ energy: 10, updatedAt: T, pending: 0 }, T + 2 * MIN);
    expect(s.energy).toBe(0);
    expect(formatGold(s.pending)).toBe("0.001");
  });

  it("does not mine before the 2 minutes are complete", () => {
    expect(settleMine({ energy: 10, updatedAt: T, pending: 0 }, T + 2 * MIN - 1).pending).toBe(0);
  });

  it("never mines more gold than the stored energy pays for", () => {
    expect(settleMine({ energy: 30, updatedAt: T, pending: 0 }, T + 60 * MIN).pending).toBe(3);
  });

  it("a give adds 10 energy and the miner holds at most 1000", () => {
    expect(giveToMine({ energy: 990, updatedAt: T, pending: 0 }, 10, T).energy).toBe(1000);
    expect(() => giveToMine({ energy: 1000, updatedAt: T, pending: 0 }, 10, T)).toThrow(/full/);
  });

  it("a give needs at least 10 player energy", () => {
    expect(() => giveToMine({ energy: 0, updatedAt: T, pending: 0 }, 9, T)).toThrow(/Not enough energy/);
  });

  it("a full 1000-energy miner runs for 200 minutes", () => {
    expect(mineRemainingMs({ energy: 1000, updatedAt: T, pending: 0 }, T)).toBe(200 * MIN);
  });
});
