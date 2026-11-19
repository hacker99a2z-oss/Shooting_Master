import { describe, expect, it } from "vitest";
import { arenaPlayButtonLabel, formatAdCooldown, COINS_PER_ENEMY, DAILY_GAME_GOALS, dailyGamesProgress } from "@/lib/home-rules";

describe("home Daily Games goals", () => {
  it("first goal is 10 games and pays $0.03", () => expect(DAILY_GAME_GOALS[0]).toEqual({ target: 10, rewardUsd: 0.03 }));
  it("second goal is 20 games and pays $0.04", () => expect(DAILY_GAME_GOALS[1]).toEqual({ target: 20, rewardUsd: 0.04 }));
  it("each enemy killed is worth 10 coins", () => expect(COINS_PER_ENEMY).toBe(10));
  it("4 games today shows 4/10 and cannot claim yet", () => {
    const p = dailyGamesProgress(4, 10);
    expect([p.played, p.target, p.canClaim]).toEqual([4, 10, false]);
  });
  it("10 games today unlocks the first goal but not the second", () => {
    expect(dailyGamesProgress(10, 10).canClaim).toBe(true);
    expect(dailyGamesProgress(10, 20).canClaim).toBe(false);
  });
  it("20 games today unlocks the second goal", () => expect(dailyGamesProgress(20, 20).canClaim).toBe(true));
  it("progress never goes past the target", () => {
    expect(dailyGamesProgress(57, 10).played).toBe(10);
    expect(dailyGamesProgress(57, 20).played).toBe(20);
  });
});

describe("daily goal claims", () => {
  it("can claim once the target is reached and not yet claimed today", () => {
    expect(dailyGamesProgress(10, 10, false).canClaim).toBe(true);
  });
  it("cannot claim the same goal twice in a day", () => {
    expect(dailyGamesProgress(12, 10, true).canClaim).toBe(false);
  });
});

describe("Battle Arena play button", () => {
  it("shows the daily free play label before the first game", () => {
    expect(arenaPlayButtonLabel(true)).toBe("Play (Daily 1 time)");
  });
  it("requires a rewarded ad after the daily free game is used", () => {
    expect(arenaPlayButtonLabel(false)).toBe("Watch Ads to Play");
  });
  it("shows the server cooldown on the button after a completed game", () => {
    expect(arenaPlayButtonLabel(false, 150)).toBe("Watch Ads to Play (02:30)");
    expect(arenaPlayButtonLabel(false, 9)).toBe("Watch Ads to Play (00:09)");
  });
  it("removes the timer when the server deadline has passed", () => {
    expect(arenaPlayButtonLabel(false, 0)).toBe("Watch Ads to Play");
  });
  it("formats remaining cooldown without going below zero", () => {
    expect(formatAdCooldown(150)).toBe("02:30");
    expect(formatAdCooldown(61.2)).toBe("01:02");
    expect(formatAdCooldown(-1)).toBe("00:00");
  });
});
