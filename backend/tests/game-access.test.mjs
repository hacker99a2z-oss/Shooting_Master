import test from "node:test";
import assert from "node:assert/strict";
import { activeAdSession, dailyFreePlayAvailable, rewardedAdSessionEligible } from "../game-access.ts";

test("one free game is available only when the last free play was not today", () => {
  assert.equal(dailyFreePlayAvailable(null, "2026-11-19"), true);
  assert.equal(dailyFreePlayAvailable("2026-11-18", "2026-11-19"), true);
  assert.equal(dailyFreePlayAvailable("2026-11-19", "2026-11-19"), false);
});

test("an ad-unlocked game requires a non-expired AdsGram server-rewarded session", () => {
  assert.equal(rewardedAdSessionEligible("rewarded", 20_000, 10_000), true);
  assert.equal(rewardedAdSessionEligible("awaiting_postback", 20_000, 10_000), false);
  assert.equal(rewardedAdSessionEligible("cancelled", 20_000, 10_000), false);
  assert.equal(rewardedAdSessionEligible("rewarded", 9_999, 10_000), false);
});

test("only created or awaiting-postback sessions remain active", () => {
  assert.equal(activeAdSession("created", 20_000, 10_000), true);
  assert.equal(activeAdSession("awaiting_postback", 20_000, 10_000), true);
  assert.equal(activeAdSession("cancelled", 20_000, 10_000), false);
  assert.equal(activeAdSession("rewarded", 20_000, 10_000), false);
});
