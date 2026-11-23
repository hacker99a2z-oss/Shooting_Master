export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_ID_HEX = "0x38";
export const validBep20Address = (value: unknown): value is string => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);

const KECCAK_MASK = (1n << 64n) - 1n;
const KECCAK_ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000000000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
] as const;
const KECCAK_ROTATION_OFFSETS = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
] as const;

function rotateKeccakLane(value: bigint, offset: number): bigint {
  if (offset === 0) return value;
  const shift = BigInt(offset);
  return ((value << shift) | (value >> (64n - shift))) & KECCAK_MASK;
}

function permuteKeccak(state: bigint[]): void {
  for (const roundConstant of KECCAK_ROUND_CONSTANTS) {
    const columnParity = Array<bigint>(5).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        columnParity[x] = (columnParity[x] ?? 0n) ^ (state[x + 5 * y] ?? 0n);
      }
    }

    const theta = Array<bigint>(5);
    for (let x = 0; x < 5; x += 1) {
      theta[x] = (columnParity[(x + 4) % 5] ?? 0n) ^ rotateKeccakLane(columnParity[(x + 1) % 5] ?? 0n, 1);
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const index = x + 5 * y;
        state[index] = ((state[index] ?? 0n) ^ (theta[x] ?? 0n)) & KECCAK_MASK;
      }
    }

    const moved = Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const source = x + 5 * y;
        const targetX = y;
        const targetY = (2 * x + 3 * y) % 5;
        moved[targetX + 5 * targetY] = rotateKeccakLane(
          state[source] ?? 0n,
          KECCAK_ROTATION_OFFSETS[source] ?? 0,
        );
      }
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const index = x + 5 * y;
        const next = (x + 1) % 5 + 5 * y;
        const afterNext = (x + 2) % 5 + 5 * y;
        state[index] = ((moved[index] ?? 0n) ^ ((~(moved[next] ?? 0n) & KECCAK_MASK) & (moved[afterNext] ?? 0n))) & KECCAK_MASK;
      }
    }
    state[0] = ((state[0] ?? 0n) ^ roundConstant) & KECCAK_MASK;
  }
}

/** Keccak-256 of an ASCII string, used for the EIP-55 address checksum. */
function keccak256Ascii(value: string): string {
  const rate = 136;
  const bytes = Array.from(value, (character) => character.charCodeAt(0));
  const paddedLength = Math.ceil((bytes.length + 1) / rate) * rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) | 0x80;

  const state = Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let index = 0; index < rate; index += 1) {
      const lane = Math.floor(index / 8);
      const byte = padded[offset + index] ?? 0;
      state[lane] = (state[lane] ?? 0n) ^ (BigInt(byte) << BigInt((index % 8) * 8));
    }
    permuteKeccak(state);
  }

  let hash = "";
  for (let index = 0; index < 32; index += 1) {
    const lane = state[Math.floor(index / 8)] ?? 0n;
    const byte = Number((lane >> BigInt((index % 8) * 8)) & 0xffn);
    hash += byte.toString(16).padStart(2, "0");
  }
  return hash;
}

/** Returns the standard EIP-55 mixed-case form used by EVM wallets for display. */
export function toChecksumAddress(address: string): string {
  const value = (address ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return value;

  const lower = value.slice(2).toLowerCase();
  const hash = keccak256Ascii(lower);
  let checksummed = "0x";
  for (let index = 0; index < lower.length; index += 1) {
    const character = lower[index] ?? "";
    checksummed += /[a-f]/.test(character) && Number.parseInt(hash[index] ?? "0", 16) >= 8
      ? character.toUpperCase()
      : character;
  }
  return checksummed;
}

/** Wallet address shown in the badge: first few characters, dots, then the last few. */
export function shortenWalletAddress(address: string, head = 6, tail = 4): string {
  const value = (address ?? "").trim();
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}
export function trustBrowserLink(page: string) {
  const url = new URL(page);
  url.hash = "";
  url.search = "";
  return "https://link.trustwallet.com/open_url?coin_id=60&url=" + encodeURIComponent(url.href);
}
