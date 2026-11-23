import { getAddress } from "viem";

export const isBep20Destination = (value: unknown): value is string => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);

/** Return the standard EIP-55 checksum representation for UI display and storage. */
export function checksumBep20Address(address: string): string {
  return getAddress(address.toLowerCase() as `0x${string}`);
}
export function destinationInput(body: Record<string, unknown>) {
  const address = typeof body['address'] === "string" ? body['address'].trim() : "";
  if (body['asset'] !== "USDT" || body['network'] !== "BEP20" || !isBep20Destination(address)) throw new Error("A valid USDT BEP-20 destination is required.");
  return { address: checksumBep20Address(address), asset: "USDT" as const, network: "BEP20" as const, chainId: 56 as const };
}