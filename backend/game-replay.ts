import {
  battleSeedFromGameId,
  createBattle,
  stepBattle,
  type BattleInput,
} from "../frontend/src/lib/battle-rules.ts";

export const REPLAY_FRAME_BYTES = 57;
export const MAX_REPLAY_FRAMES = 100_000;
const MAX_COMPRESSED_BYTES = 3 * 1024 * 1024;
const MAX_RAW_BYTES = MAX_REPLAY_FRAMES * REPLAY_FRAME_BYTES;

export type GameReplayPayload = {
  version: 1;
  frameCount: number;
  gzipBase64: string;
};

function fail(message: string): never {
  throw new Error("Game replay rejected: " + message);
}

async function decodeReplay(payload: unknown): Promise<Uint8Array> {
  if (!payload || typeof payload !== "object") fail("missing replay data");
  const replay = payload as Partial<GameReplayPayload>;
  if (replay.version !== 1 || !Number.isInteger(replay.frameCount) ||
      (replay.frameCount as number) < 1 || (replay.frameCount as number) > MAX_REPLAY_FRAMES) {
    fail("unsupported replay version or frame count");
  }
  if (typeof replay.gzipBase64 !== "string" || replay.gzipBase64.length > Math.ceil(MAX_COMPRESSED_BYTES * 4 / 3) + 8 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(replay.gzipBase64)) {
    fail("invalid compressed replay");
  }

  let compressed: Uint8Array;
  try {
    const binary = atob(replay.gzipBase64);
    if (!binary.length || binary.length > MAX_COMPRESSED_BYTES) fail("compressed replay exceeds limit");
    compressed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) compressed[i] = binary.charCodeAt(i);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Game replay rejected:")) throw error;
    fail("invalid base64 replay");
  }

  if (typeof DecompressionStream === "undefined") fail("server replay decompression is unavailable");
  const expectedBytes = (replay.frameCount as number) * REPLAY_FRAME_BYTES;
  const buffer = compressed!.slice().buffer as ArrayBuffer;
  const reader = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > expectedBytes || total > MAX_RAW_BYTES) {
        await reader.cancel();
        fail("decompressed replay exceeds the declared size");
      }
      chunks.push(new Uint8Array(item.value));
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Game replay rejected:")) throw error;
    fail("could not decompress replay");
  }
  if (total !== expectedBytes) fail("replay frame data is incomplete");
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

export async function verifyBattleReplay(input: {
  gameId: string;
  enemyTotal: number;
  createdAt: number;
  now: number;
  kills: number;
  score: number;
  replay: unknown;
}) {
  const { gameId, enemyTotal, createdAt, now, kills, score } = input;
  if (!Number.isSafeInteger(kills) || kills < 0 || kills > enemyTotal ||
      !Number.isSafeInteger(score) || score !== kills * 10) {
    fail("reported kills or coins do not match the reward rules");
  }

  const raw = await decodeReplay(input.replay);
  const battle = createBattle(battleSeedFromGameId(gameId), enemyTotal);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let simulatedSeconds = 0;
  const frameCount = raw.byteLength / REPLAY_FRAME_BYTES;

  for (let frame = 0; frame < frameCount; frame++) {
    const offset = frame * REPLAY_FRAME_BYTES;
    const dt = view.getFloat64(offset, true);
    const moveX = view.getFloat64(offset + 8, true);
    const moveZ = view.getFloat64(offset + 16, true);
    const pointerX = view.getFloat64(offset + 24, true);
    const pointerZ = view.getFloat64(offset + 32, true);
    const shieldDirX = view.getFloat64(offset + 40, true);
    const shieldDirZ = view.getFloat64(offset + 48, true);
    const flags = raw[offset + 56]!;
    const values = [dt, moveX, moveZ, pointerX, pointerZ, shieldDirX, shieldDirZ];
    if (values.some((value) => !Number.isFinite(value)) || dt < 0 || dt > 0.050001 ||
        Math.abs(moveX) > 2.001 || Math.abs(moveZ) > 2.001 ||
        Math.abs(pointerX) > 1_000 || Math.abs(pointerZ) > 1_000 ||
        Math.abs(shieldDirX) > 1.001 || Math.abs(shieldDirZ) > 1.001 ||
        (flags & 0xf8) !== 0) {
      fail("invalid frame input or delta time");
    }

    const controls: BattleInput = {
      moveX, moveZ, pointerX, pointerZ, shieldDirX, shieldDirZ,
      pointerHeld: (flags & 1) !== 0,
      released: (flags & 2) !== 0,
      shieldHeld: (flags & 4) !== 0,
    };
    simulatedSeconds += dt;
    stepBattle(battle, controls, dt);
    battle.events.length = 0;
  }

  if (!battle.over) fail("replay does not reach a real victory or defeat");
  if (battle.kills !== kills || battle.coins !== score) fail("server simulation does not match the submitted result");

  const elapsedMs = now - createdAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || simulatedSeconds * 1_000 > elapsedMs + 1_500) {
    fail("simulated time is faster than the real match duration");
  }
  return { valid: true, kills: battle.kills, score: battle.coins, simulatedSeconds };
}
