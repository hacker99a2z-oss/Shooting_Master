import { describe, expect, it } from "vitest";
import { COINS_PER_ENEMY, DAILY_GAMES_REWARD_USD, DAILY_GAMES_TARGET, dailyGamesProgress } from "@/lib/home-rules";

describe("home Daily Games card", () => {
  it("daily target is 20 games", () => expect(DAILY_GAMES_TARGET).toBe(20));
  it("claim button pays $0.03", () => expect(DAILY_GAMES_REWARD_USD).toBe(0.03));
  it("each enemy killed is worth 10 coins", () => expect(COINS_PER_ENEMY).toBe(10));
  it("13 games today shows 13/20 and cannot claim yet", () => {
    const p = dailyGamesProgress(13);
    expect([p.played, p.target, p.canClaim]).toEqual([13, 20, false]);
  });
  it("20 games today unlocks claim", () => expect(dailyGamesProgress(20).canClaim).toBe(true));
  it("progress never goes past 20/20", () => expect(dailyGamesProgress(57).played).toBe(20));
});
