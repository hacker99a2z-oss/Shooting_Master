import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  battleSeedFromGameId,
  createBattle,
  emptyInput,
  stepBattle,
} from "../../frontend/src/lib/battle-rules.ts";
import { verifyBattleReplay, REPLAY_FRAME_BYTES } from "../game-replay.ts";

function encodeFrames(frames) {
  const raw = Buffer.alloc(frames.length * REPLAY_FRAME_BYTES);
  frames.forEach((frame, index) => {
    const offset = index * REPLAY_FRAME_BYTES;
    raw.writeDoubleLE(frame.dt, offset);
    raw.writeDoubleLE(frame.input.moveX, offset + 8);
    raw.writeDoubleLE(frame.input.moveZ, offset + 16);
    raw.writeDoubleLE(frame.input.pointerX, offset + 24);
    raw.writeDoubleLE(frame.input.pointerZ, offset + 32);
    raw.writeDoubleLE(frame.input.shieldDirX, offset + 40);
    raw.writeDoubleLE(frame.input.shieldDirZ, offset + 48);
    const flags = (frame.input.pointerHeld ? 1 : 0) |
      (frame.input.released ? 2 : 0) |
      (frame.input.shieldHeld ? 4 : 0);
    raw.writeUInt8(flags, offset + 56);
  });
  return { version: 1, frameCount: frames.length, gzipBase64: gzipSync(raw).toString("base64") };
}

function buildDefeatReplay() {
  for (const seed of [0x12345678, 0x87654321, 0x0badcafe, 0x31415926, 0xdeadbeef, 0x76543210, 0xa5a5a5a5, 0xc001d00d]) {
    const gameId = "r2_" + seed.toString(16).padStart(8, "0") + "-1234-4234-8234-123456789abc";
    const battle = createBattle(battleSeedFromGameId(gameId), 9);
    const frames = [];
    for (let i = 0; i < 6_000 && !battle.over; i++) {
      const input = emptyInput();
      frames.push({ dt: 0.05, input });
      stepBattle(battle, input, 0.05);
      battle.events.length = 0;
    }
    if (battle.over) {
      return {
        gameId,
        frames,
        kills: battle.kills,
        score: battle.coins,
        simulatedSeconds: battle.time,
      };
    }
  }
  return null;
}

test("accepts a real deterministic defeat replay and verifies its exact reward", async () => {
  const fixture = buildDefeatReplay();
  assert.ok(fixture, "at least one seeded match should reach a real defeat");
  const replay = encodeFrames(fixture.frames);
  const createdAt = 1_000_000;
  const result = await verifyBattleReplay({
    gameId: fixture.gameId,
    enemyTotal: 9,
    createdAt,
    now: createdAt + fixture.simulatedSeconds * 1_000 + 2_000,
    kills: fixture.kills,
    score: fixture.score,
    replay,
  });
  assert.equal(result.valid, true);
  assert.equal(result.kills, fixture.kills);
  assert.equal(result.score, fixture.score);
});

test("rejects a client-edited kill or coin total", async () => {
  const fixture = buildDefeatReplay();
  assert.ok(fixture);
  await assert.rejects(
    verifyBattleReplay({
      gameId: fixture.gameId,
      enemyTotal: 9,
      createdAt: 1_000_000,
      now: 1_000_000 + fixture.simulatedSeconds * 1_000 + 2_000,
      kills: fixture.kills + 1,
      score: (fixture.kills + 1) * 10,
      replay: encodeFrames(fixture.frames),
    }),
    /reported kills or coins do not match the reward rules|server simulation does not match the submitted result/,
  );
});

test("rejects frame deltas above the actual game's 50 ms cap", async () => {
  const gameId = "r2_12345678-1234-4234-8234-123456789abc";
  const invalid = encodeFrames([{ dt: 0.051, input: emptyInput() }]);
  await assert.rejects(
    verifyBattleReplay({
      gameId, enemyTotal: 9, createdAt: 1_000_000, now: 1_010_000,
      kills: 0, score: 0, replay: invalid,
    }),
    /invalid frame input or delta time/,
  );
});

test("rejects replay data that never reaches a real end state", async () => {
  const gameId = "r2_12345678-1234-4234-8234-123456789abc";
  const incomplete = encodeFrames(Array.from({ length: 20 }, () => ({ dt: 0.05, input: emptyInput() })));
  await assert.rejects(
    verifyBattleReplay({
      gameId, enemyTotal: 9, createdAt: 1_000_000, now: 1_010_000,
      kills: 0, score: 0, replay: incomplete,
    }),
    /does not reach a real victory or defeat/,
  );
});

test("rejects an excessive frame count before decompressing", async () => {
  await assert.rejects(
    verifyBattleReplay({
      gameId: "r2_12345678-1234-4234-8234-123456789abc",
      enemyTotal: 9, createdAt: 1_000_000, now: 1_010_000, kills: 0, score: 0,
      replay: { version: 1, frameCount: 100_001, gzipBase64: "H4sIAAAAAAAA" },
    }),
    /unsupported replay version or frame count/,
  );
});
