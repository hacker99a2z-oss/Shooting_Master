// Browser helpers for the Telegram WebApp + Adsgram SDKs (loaded via <script> in __root).
declare global {
  interface Window {
    Telegram?: { WebApp: any };
    Adsgram?: { init: (o: { blockId: string }) => { show: () => Promise<{ done: boolean }> } };
  }
}

export const BOT_USERNAME = import.meta.env['VITE_TELEGRAM_BOT_USERNAME'] || "YourBot";
export const ADSGRAM_BLOCK_ID = import.meta.env['VITE_ADSGRAM_BLOCK_ID'] || "";
export const SUPPORT_URL = import.meta.env['VITE_SUPPORT_URL'] || "https://t.me/";
export const PROOF_URL = import.meta.env['VITE_PROOF_URL'] || "https://t.me/";

export function webApp() {
  return typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
}

export function auth() {
  const wa = webApp();
  const initData: string = wa?.initData || "";
  return { initData };
}

export function startParam(): string {
  const wa = webApp();
  return wa?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("startapp") || "";
}

export function haptic(kind: "light" | "medium" | "heavy" | "success" | "error" = "light") {
  const h = webApp()?.HapticFeedback;
  if (!h) return;
  if (kind === "success" || kind === "error") h.notificationOccurred(kind);
  else h.impactOccurred(kind);
}

export function openLink(url: string) {
  const wa = webApp();
  if (url.startsWith("https://t.me/") && wa?.openTelegramLink) wa.openTelegramLink(url);
  else if (wa?.openLink) wa.openLink(url);
  else window.open(url, "_blank");
}

export async function showRewardAd(): Promise<boolean> {
  if (!window.Adsgram || !ADSGRAM_BLOCK_ID) throw new Error("Ads are not set up yet");
  const ctrl = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
  const res = await ctrl.show();
  return !!res?.done;
}
