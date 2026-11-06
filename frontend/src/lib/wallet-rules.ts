export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_ID_HEX = "0x38";
export const validBep20Address = (value: unknown): value is string => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
export function trustBrowserLink(page: string) {
  const url = new URL(page);
  url.hash = "";
  url.search = "";
  return "https://link.trustwallet.com/open_url?coin_id=60&url=" + encodeURIComponent(url.href);
}