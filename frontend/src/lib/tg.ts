// Browser helpers for the Telegram WebApp + Adsgram SDKs (loaded via <script> in __root).
declare global {
  interface Window {
    Telegram?: { WebApp: any };
    Adsgram?: { init: (o: { blockId: string }) => AdsgramController };
  }
}

type AdsgramShowResult = { done: boolean; description?: string; state?: "load" | "render" | "playing" | "destroy"; error?: boolean };
type AdsgramEvent = "onReward" | "onSkip" | "onError" | "onBannerNotFound" | "onNonStopShow" | "onTooLongSession";
type AdsgramListener = (event?: unknown) => void;
type AdsgramController = {
  show: () => Promise<AdsgramShowResult>;
  addEventListener?: (event: AdsgramEvent, callback: AdsgramListener) => void;
  removeEventListener?: (event: AdsgramEvent, callback: AdsgramListener) => void;
  destroy?: () => void;
};

function adsgramEventMessage(event: unknown, fallback: string): string {
  if (event && typeof event === "object") {
    const detail = event as { description?: unknown; message?: unknown };
    if (typeof detail.description === "string" && detail.description.trim()) return detail.description;
    if (typeof detail.message === "string" && detail.message.trim()) return detail.message;
  }
  return fallback;
}

let adsgramController: AdsgramController | null = null;
let adShowing = false;

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

function getAdsgramController(): AdsgramController {
  if (!ADSGRAM_BLOCK_ID) throw new Error("Ads are not set up yet");
  if (!window.Adsgram) throw new Error("AdsGram SDK is not loaded. Please try again.");
  if (!adsgramController) adsgramController = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
  return adsgramController;
}

export async function showRewardAd(): Promise<AdsgramShowResult> {
  if (adShowing) throw new Error("An ad is already opening. Please wait.");
  const controller = getAdsgramController();
  adShowing = true;
  const listeners: Array<[AdsgramEvent, AdsgramListener]> = [];
  try {
    // AdsGram resolves show() on completion, and also exposes onReward.
    // Race both signals, but let the Worker alone decide whether a reward is granted.
    const rewardEvent = new Promise<AdsgramShowResult>((resolve, reject) => {
      if (!controller.addEventListener) return;
      const subscribe = (event: AdsgramEvent, listener: AdsgramListener) => {
        listeners.push([event, listener]);
        controller.addEventListener?.(event, listener);
      };
      subscribe("onReward", () => resolve({ done: true, state: "destroy" }));
      subscribe("onSkip", () => resolve({ done: false, description: "The ad was skipped.", state: "destroy" }));
      subscribe("onError", (event) => reject(new Error(adsgramEventMessage(event, "The ad could not be played."))));
      subscribe("onBannerNotFound", () => reject(new Error("No ad is available right now. Please try again.")));
      subscribe("onNonStopShow", () => reject(new Error("Please wait before requesting another ad.")));
      subscribe("onTooLongSession", () => reject(new Error("The AdsGram session expired. Please reopen the game and try again.")));
    });
    const result = await Promise.race([controller.show(), rewardEvent]);
    if (!result?.done) return { done: false, description: result?.description || "The ad was not completed.", state: result?.state, error: result?.error };
    return result;
  } catch (reason) {
    const detail = reason as Partial<AdsgramShowResult>;
    const message = typeof detail?.description === "string" && detail.description.trim()
      ? detail.description
      : typeof (reason as Error)?.message === "string" && (reason as Error).message.trim()
        ? (reason as Error).message
        : "No ad is available right now. Tap again to request a new ad.";
    throw new Error(message);
  } finally {
    listeners.forEach(([event, listener]) => controller.removeEventListener?.(event, listener));
    // AdsGram destroys a failed, skipped, or completed banner automatically.
    // Only reset our local guard; the controller itself is reused for the next request.
    adShowing = false;
  }
}
