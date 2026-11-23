import { webApp } from "@/lib/tg";

const DEFAULT_WALLETCONNECT_PROJECT_ID = "b5a064d2976a1d6913d536cb44021a74";
export const TRUST_EXTENSION_URL = "https://trustwallet.com/browser-extension";

/** Official Trust Wallet HTTPS universal link for a WalletConnect v2 pairing URI. */
export function trustAppConnectLink(uri: string): string {
  return "https://link.trustwallet.com/wc?uri=" + encodeURIComponent(uri);
}

type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  connect?: () => Promise<void>;
  disconnect?: () => Promise<void>;
  session?: unknown;
};

type PreparedConnection = { provider: Provider; link: string | null; connectPromise: Promise<void> | null };
let preparedConnection: PreparedConnection | null = null;

// Keep one WalletConnect provider for the lifetime of the Mini App. Route components
// can unmount during navigation, but that must never tear down a live wallet session.
let sharedProvider: Provider | null = null;
let sharedProviderPromise: Promise<Provider> | null = null;
let restoreSessionPromise: Promise<Provider | null> | null = null;

async function getSharedWalletConnectProvider(): Promise<Provider> {
  if (sharedProvider) return sharedProvider;
  if (!sharedProviderPromise) {
    sharedProviderPromise = initWalletConnect(false)
      .then((provider) => {
        sharedProvider = provider as Provider;
        return sharedProvider;
      })
      .finally(() => {
        sharedProviderPromise = null;
      });
  }
  return await sharedProviderPromise;
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

/** Desktop Telegram Mini Apps run embedded; injected extensions must connect from a top-level tab. */
export function shouldUseExternalWalletBridge(platform?: string, userAgent?: string, embedded = false): boolean {
  const p=(platform??"").toLowerCase();
  const desktopShell=["tdesktop","macos","windows","linux","unigram"].includes(p);
  return !isPhoneDevice(platform,userAgent) && (embedded || desktopShell);
}

export function currentDeviceNeedsExternalWalletBridge(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined" || currentDeviceIsPhone()) return false;
  const platform=String(webApp()?.platform??"").toLowerCase();
  const telegramDesktop=["tdesktop","macos","windows","linux","unigram"].includes(platform);
  let embedded=false;
  try{embedded=window.top!==window.self;}catch{embedded=true;}
  return shouldUseExternalWalletBridge(platform,navigator.userAgent,embedded||telegramDesktop);
}

async function initWalletConnect(showQrModal: boolean) {
  const configured = import.meta.env["VITE_WALLETCONNECT_PROJECT_ID"];
  const projectId =
    typeof configured === "string" && configured.trim()
      ? configured.trim()
      : DEFAULT_WALLETCONNECT_PROJECT_ID;
  const { default: EthereumProvider } = await import("@walletconnect/ethereum-provider");
  return EthereumProvider.init({
    projectId,
    chains: [56],
    showQrModal,
    methods: ["eth_sendTransaction", "personal_sign"],
    optionalMethods: ["wallet_switchEthereumChain", "wallet_addEthereumChain"],
    events: ["accountsChanged", "chainChanged"],
    rpcMap: { 56: "https://bsc-dataseed.bnbchain.org" },
    metadata: {
      name: "Shooting Master",
      description: "USDT BEP-20 withdrawal destination",
      url: window.location.origin,
      icons: [],
    },
  });
}

/**
 * Prepare the WalletConnect URI in the background so the Connect tap can open
 * Trust Wallet synchronously through Telegram's openLink.
 */
export async function prepareTrustWalletSession(
  onConnectLink: (link: string) => void,
  onError?: (error: unknown) => void,
): Promise<void> {
  if (preparedConnection) {
    if (preparedConnection.link) onConnectLink(preparedConnection.link);
    return;
  }
  const provider = await getSharedWalletConnectProvider();
  if (provider.session) {
    preparedConnection = { provider, link: null, connectPromise: null };
    return;
  }
  const prepared: PreparedConnection = { provider, link: null, connectPromise: null };
  preparedConnection = prepared;
  provider.on?.("display_uri", (uri: string) => {
    if (preparedConnection !== prepared) return;
    prepared.link = trustAppConnectLink(uri);
    onConnectLink(prepared.link);
  });
  if (!provider.connect) {
    preparedConnection = null;
    throw new Error("WalletConnect provider cannot start a connection.");
  }
  const promise = provider.connect();
  prepared.connectPromise = promise;
  void promise.catch((error) => {
    if (preparedConnection === prepared) preparedConnection = null;
    onError?.(error);
  });
}

export function pendingTrustWalletConnectLink(): string | null {
  return preparedConnection?.link ?? null;
}

export async function connectPreparedTrustWalletSession(): Promise<Provider> {
  const prepared = preparedConnection;
  if (!prepared) throw new Error("Trust Wallet is not ready yet. Tap Connect again in a moment.");
  if (prepared.provider.session) {
    preparedConnection = null;
    return prepared.provider;
  }
  if (!prepared.link || !prepared.connectPromise) {
    throw new Error("Trust Wallet is still preparing the secure connection. Please try again.");
  }
  await prepared.connectPromise;
  if (!prepared.provider.session) throw new Error("Trust Wallet did not approve the connection.");
  preparedConnection = null;
  return prepared.provider;
}

export async function restoreTrustWalletSession(): Promise<Provider | null> {
  if (sharedProvider?.session) return sharedProvider;
  if (restoreSessionPromise) return await restoreSessionPromise;

  // EthereumProvider hydrates its persisted WalletConnect session during init.
  // Do not use a localStorage key as proof of connection: stale WC keys can remain
  // after a session has expired or been deleted in Trust Wallet.
  restoreSessionPromise = (async () => {
    try {
      const provider = await getSharedWalletConnectProvider();
      return provider.session ? provider : null;
    } catch {
      return null;
    }
  })();

  try {
    return await restoreSessionPromise;
  } finally {
    restoreSessionPromise = null;
  }
}

export async function disconnectTrustWalletProvider(provider: Provider): Promise<void> {
  if (provider.disconnect) {
    await provider.disconnect();
  } else {
    try {
      await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      // Some injected wallets do not implement account permission revocation.
    }
  }

  if (preparedConnection?.provider === provider) preparedConnection = null;
  if (sharedProvider === provider) sharedProvider = null;
  sharedProviderPromise = null;
  restoreSessionPromise = null;
}

export type InjectedTrustProvider = Provider & {
  isTrust?: boolean;
  isTrustWallet?: boolean;
};

/** Trust Wallet documents both flags for its EIP-1193 browser extension provider. */
export function isTrustWalletInjectedProvider(value: unknown): value is InjectedTrustProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Partial<InjectedTrustProvider>;
  return typeof provider.request === "function" &&
    (provider.isTrust === true || provider.isTrustWallet === true);
}

/** Select only a provider positively identified as Trust Wallet from injected providers. */
export function selectTrustWalletInjectedProvider(candidates: unknown[]): InjectedTrustProvider | null {
  return candidates.find(isTrustWalletInjectedProvider) ?? null;
}
