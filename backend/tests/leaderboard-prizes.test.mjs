import test from "node:test";
import assert from "node:assert/strict";
import { PRIZE_WINNERS, prizeForRankCents } from "../../frontend/src/lib/rules.ts";

test("top 30 leaderboard prizes are payable in cents and total exactly $10", () => {
  const prizes = Array.from({ length: PRIZE_WINNERS }, (_, index) => prizeForRankCents(index + 1));
  assert.ok(prizes.every((amount) => amount > 0));
  assert.equal(prizes.reduce((sum, amount) => sum + amount, 0), 1_000);
});

test("ranks outside the winner range receive no prize", () => {
  assert.equal(prizeForRankCents(0), 0);
  assert.equal(prizeForRankCents(31), 0);
});
