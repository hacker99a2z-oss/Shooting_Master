import { webApp } from "@/lib/tg";

type Provider = { request:(args:{method:string;params?:unknown[]})=>Promise<unknown>; on?:(event:string,listener:(...args:unknown[])=>void)=>void; removeListener?:(event:string,listener:(...args:unknown[])=>void)=>void };

// Public Reown (WalletConnect) project ID. Not a secret; the allowed domain list in Reown protects it.
const DEFAULT_WALLETCONNECT_PROJECT_ID = "b5a064d2976a1d6913d536cb44021a74";

// Official Trust Wallet browser extension page, opened on PCs that do not have it yet.
export const TRUST_EXTENSION_URL = "https://trustwallet.com/browser-extension";

export function trustWalletConnectLink(uri: string) {
  return "https://link.trustwallet.com/wc?uri=" + encodeURIComponent(uri);
}

/** Phone = Telegram on Android/iOS, or a mobile browser. Everything else is treated as a PC. */
export function isPhoneDevice(platform?: string, userAgent?: string): boolean {
  const p = (platform ?? "").toLowerCase();
  if (p.startsWith("android") || p === "ios") return true;
  if (["tdesktop", "macos", "web", "weba", "webk", "unigram"].includes(p)) return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent ?? "");
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

/** Phone flow: open the Trust Wallet app with the approval request and wait for the user to approve. */
export async function connectTrustWalletSession(): Promise<Provider | null> {
  const tg = webApp();
  const provider = await initWalletConnect(false);
  if (provider.session) return provider as Provider;
  provider.on("display_uri", (uri: string) => {
    const link = trustWalletConnectLink(uri);
    if (tg?.openLink) tg.openLink(link);
    else window.location.href = link;
  });
  await provider.connect();
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
