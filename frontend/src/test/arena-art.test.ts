import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Read a JPEG's pixel size straight from its SOF segment (no decoder needed). */
function jpegSize(buffer: Buffer): [number, number] {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("not a JPEG");
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error("corrupt JPEG marker stream");
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    const length = buffer.readUInt16BE(offset);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) return [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)];
    offset += length;
  }
  throw new Error("no start-of-frame segment found");
}

describe("Battle Arena artwork", () => {
  const artwork = readFileSync(path.join(process.cwd(), "src/assets/battle-arena.jpg"));

  // The generated picture came with a black strip along its bottom and right edge;
  // those rows/columns are cropped off so the card never shows a black band under the art.
  it("is cropped to the clean artwork area, with no black edge strips", () => {
    expect(jpegSize(artwork)).toEqual([1233, 607]);
  });
});
