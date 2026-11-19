import type { BattleInput } from "./battle-rules";

export type BattleReplay = { version: 1; frameCount: number; gzipBase64: string };
export type BattleReplayRecorder = { buffer: Uint8Array; frameCount: number; overflow: boolean; sealed: boolean };

export const REPLAY_FRAME_BYTES = 57;
export const MAX_REPLAY_FRAMES = 100_000;
const MAX_COMPRESSED_BYTES = 3 * 1024 * 1024;

export function createBattleReplayRecorder(): BattleReplayRecorder {
  return { buffer: new Uint8Array(REPLAY_FRAME_BYTES * 512), frameCount: 0, overflow: false, sealed: false };
}

/** Records the exact inputs and delta-time passed to stepBattle without changing them. */
export function recordBattleFrame(recorder: BattleReplayRecorder, input: BattleInput, dt: number) {
  if (recorder.overflow || recorder.sealed) return;
  if (recorder.frameCount >= MAX_REPLAY_FRAMES) {
    recorder.overflow = true;
    return;
  }

  const offset = recorder.frameCount * REPLAY_FRAME_BYTES;
  const needed = offset + REPLAY_FRAME_BYTES;
  if (needed > recorder.buffer.byteLength) {
    const next = new Uint8Array(Math.min(REPLAY_FRAME_BYTES * MAX_REPLAY_FRAMES, Math.max(needed, recorder.buffer.byteLength * 2)));
    next.set(recorder.buffer);
    recorder.buffer = next;
  }

  const view = new DataView(recorder.buffer.buffer);
  view.setFloat64(offset, dt, true);
  view.setFloat64(offset + 8, input.moveX, true);
  view.setFloat64(offset + 16, input.moveZ, true);
  view.setFloat64(offset + 24, input.pointerX, true);
  view.setFloat64(offset + 32, input.pointerZ, true);
  view.setFloat64(offset + 40, input.shieldDirX, true);
  view.setFloat64(offset + 48, input.shieldDirZ, true);
  recorder.buffer[offset + 56] = (input.pointerHeld ? 1 : 0) | (input.released ? 2 : 0) | (input.shieldHeld ? 4 : 0);
  recorder.frameCount += 1;
}

export function sealBattleReplayRecorder(recorder: BattleReplayRecorder) {
  recorder.sealed = true;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export async function encodeBattleReplay(recorder: BattleReplayRecorder): Promise<BattleReplay> {
  if (recorder.overflow) throw new Error("This match exceeded the verification limit. Please restart the game.");
  if (recorder.frameCount < 1) throw new Error("The match could not be verified. Please restart the game.");
  const rawLength = recorder.frameCount * REPLAY_FRAME_BYTES;
  const raw = new Uint8Array(rawLength);
  raw.set(recorder.buffer.subarray(0, rawLength));
  if (typeof CompressionStream === "undefined") throw new Error("Secure game verification is not supported by this browser. Please update Telegram or your browser.");
  const compressedStream = new Blob([raw.buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer());
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new Error("This match data is too large to verify. Please update Telegram or restart the game.");
  return { version: 1, frameCount: recorder.frameCount, gzipBase64: toBase64(compressed) };
}
