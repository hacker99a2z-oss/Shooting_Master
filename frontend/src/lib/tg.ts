// Browser helpers for the Telegram WebApp + Adsgram SDKs (loaded via <script> in __root).
declare global {
  interface Window {
    Telegram?: { WebApp: any };
    Adsgram?: { init: (o: { blockId: string; debug?: boolean }) => AdsgramController };
  }
}

type AdsgramShowResult = { done: boolean; description?: string; state?: "load" | "render" | "playing" | "destroy"; error?: boolean };
type AdsgramListener = () => void;
type AdsgramController = {
  show: () => Promise<AdsgramShowResult>;
  addEventListener?: (event: "onReward", callback: AdsgramListener) => void;
  removeEventListener?: (event: "onReward", callback: AdsgramListener) => void;
  destroy?: () => void;
};

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
  if (!adsgramController) adsgramController = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID, debug: false });
  return adsgramController;
}

export async function showRewardAd(onReward?: () => void): Promise<AdsgramShowResult> {
  if (adShowing) throw new Error("An ad is already opening. Please wait.");
  const controller = getAdsgramController();
  adShowing = true;
  const rewardListener: AdsgramListener = () => onReward?.();
  try {
    // AdsGram's documented Reward flow resolves show() only after a full view.
    // The onReward event is used only to record that completion as early as possible
    // during page-close handling; only a successful show() result advances the UI.
    controller.addEventListener?.("onReward", rewardListener);
    const result = await controller.show();
    if (!result?.done || result.error) {
      return {
        done: false,
        description: result?.description || "The ad was not completed.",
        state: result?.state,
        error: result?.error,
      };
    }
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
    controller.removeEventListener?.("onReward", rewardListener);
    adShowing = false;
  }
}
