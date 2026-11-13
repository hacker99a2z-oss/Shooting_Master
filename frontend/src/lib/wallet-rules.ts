export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_ID_HEX = "0x38";
export const validBep20Address = (value: unknown): value is string => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);

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
