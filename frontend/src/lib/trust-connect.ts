import { openLink, webApp } from "@/lib/tg";

type Provider = { request:(args:{method:string;params?:unknown[]})=>Promise<unknown>; on?:(event:string,listener:(...args:unknown[])=>void)=>void; removeListener?:(event:string,listener:(...args:unknown[])=>void)=>void };

// Public Reown (WalletConnect) project ID. Not a secret; the allowed domain list in Reown protects it.
const DEFAULT_WALLETCONNECT_PROJECT_ID = "b5a064d2976a1d6913d536cb44021a74";

// Official Trust Wallet browser extension download page, opened on PCs that do not have it yet.
export const TRUST_EXTENSION_URL = "https://trustwallet.com/browser-extension";
// Store pages, opened on phones that do not have the Trust Wallet app yet.
export const TRUST_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp";
export const TRUST_APP_STORE_URL = "https://apps.apple.com/app/trust-crypto-bitcoin-wallet/id1288339409";

// How long to wait for the Trust Wallet app to take over the screen before assuming it is not installed.
const APP_OPEN_WAIT_MS = 2500;

/** Thrown when the phone has no Trust Wallet app; the store page has already been opened. */
export class TrustAppMissingError extends Error {
  constructor() {
    super("Trust Wallet app is not installed. Install it, then tap Connect again.");
    this.name = "TrustAppMissingError";
  }
}

/** Direct Trust Wallet app link carrying the WalletConnect approval request. */
export function trustAppConnectLink(uri: string) {
  return "trust://wc?uri=" + encodeURIComponent(uri);
}

/** Phone = Telegram on Android/iOS, or a mobile browser. Everything else is treated as a PC. */
export function isPhoneDevice(platform?: string, userAgent?: string): boolean {
  const p = (platform ?? "").toLowerCase();
  if (p.startsWith("android") || p === "ios") return true;
  if (["tdesktop", "macos", "web", "weba", "webk", "unigram"].includes(p)) return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent ?? "");
}

/** Where to install Trust Wallet: App Store on iPhone/iPad, Play Store on every other phone. */
export function trustStoreUrl(platform?: string, userAgent?: string): string {
  const p = (platform ?? "").toLowerCase();
  const ios = p === "ios" || (!p.startsWith("android") && /iPhone|iPad|iPod/i.test(userAgent ?? ""));
  return ios ? TRUST_APP_STORE_URL : TRUST_PLAY_STORE_URL;
}

export function currentDeviceIsPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  return isPhoneDevice(webApp()?.platform, navigator.userAgent);
}

async function initWalletConnect(showQrModal: boolean) {
  const configured = import.meta.env['VITE_WALLETCONNECT_PROJECT_ID'];
  const projectId = typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_WALLETCONNECT_PROJECT_ID;
  const { default: EthereumProvider } = await import("@walletconnect/ethereum-provider");
  return EthereumProvider.init({
    projectId, chains:[56], showQrModal,
    methods:["eth_sendTransaction","personal_sign"],
    optionalMethods:["wallet_switchEthereumChain","wallet_addEthereumChain"],
    events:["accountsChanged","chainChanged"],
    rpcMap:{56:"https://bsc-dataseed.bnbchain.org"},
    metadata:{name:"Shooting Master",description:"USDT BEP-20 withdrawal destination",url:window.location.origin,icons:[]},
  });
}

/** Opens the Trust Wallet app; resolves true when the app took over the screen, false when nothing opened. */
function openTrustApp(link: string): Promise<boolean> {
  return new Promise((resolve) => {
    let left = false;
    const markLeft = () => { left = true; };
    const onVisibility = () => { if (document.visibilityState === "hidden") left = true; };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", markLeft);
    window.addEventListener("blur", markLeft);
    try {
      window.location.href = link;
    } catch {
      // Ignore: treated as "app did not open" below.
    }
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", markLeft);
      window.removeEventListener("blur", markLeft);
      resolve(left || document.visibilityState === "hidden");
    }, APP_OPEN_WAIT_MS);
  });
}

/**
 * Phone flow: open the Trust Wallet app straight away with a USDT BEP-20 (BNB Smart Chain) approval request
 * and wait for the user to approve. When the app is not installed, opens the store page instead.
 */
export async function connectTrustWalletSession(): Promise<Provider> {
  const provider = await initWalletConnect(false);
  if (provider.session) return provider as Provider;
  let appMissing: (error: Error) => void = () => {};
  const missing = new Promise<never>((_, reject) => { appMissing = reject; });
  provider.on("display_uri", async (uri: string) => {
    const opened = await openTrustApp(trustAppConnectLink(uri));
    if (opened) return;
    openLink(trustStoreUrl(webApp()?.platform, navigator.userAgent));
    appMissing(new TrustAppMissingError());
  });
  await Promise.race([provider.connect(), missing]);
  return provider as Provider;
}

/** Silently restores an earlier Trust Wallet approval without opening any wallet window. */
export async function restoreTrustWalletSession(): Promise<Provider | null> {
  try {
    const hasSession = Object.keys(window.localStorage).some((key) => key.startsWith("wc@2"));
    if (!hasSession) return null;
    const provider = await initWalletConnect(false);
    return provider.session ? (provider as Provider) : null;
  } catch {
    return null;
  }
}
