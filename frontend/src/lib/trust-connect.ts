import { webApp } from "@/lib/tg";

type Provider = { request:(args:{method:string;params?:unknown[]})=>Promise<unknown>; on?:(event:string,listener:(...args:unknown[])=>void)=>void; removeListener?:(event:string,listener:(...args:unknown[])=>void)=>void };

// Public Reown (WalletConnect) project ID. Not a secret; the allowed domain list in Reown protects it.
const DEFAULT_WALLETCONNECT_PROJECT_ID = "b5a064d2976a1d6913d536cb44021a74";

export function trustWalletConnectLink(uri: string) {
  return "https://link.trustwallet.com/wc?uri=" + encodeURIComponent(uri);
}

export async function connectTrustWalletSession(): Promise<Provider | null> {
  const configured = import.meta.env['VITE_WALLETCONNECT_PROJECT_ID'];
  const projectId = typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_WALLETCONNECT_PROJECT_ID;
  const tg = webApp();
  // Inside Telegram or on a phone, send the approval request straight to the Trust Wallet app.
  const openTrustApp = Boolean(tg?.initData) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const { default: EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const provider = await EthereumProvider.init({
    projectId, chains:[56], showQrModal:!openTrustApp,
    methods:["eth_sendTransaction","personal_sign"],
    optionalMethods:["wallet_switchEthereumChain","wallet_addEthereumChain"],
    events:["accountsChanged","chainChanged"],
    rpcMap:{56:"https://bsc-dataseed.bnbchain.org"},
    metadata:{name:"Shooting Master",description:"USDT BEP-20 withdrawal destination",url:window.location.origin,icons:[]},
  });
  if (provider.session) return provider as Provider;
  if (openTrustApp) {
    provider.on("display_uri", (uri: string) => {
      const link = trustWalletConnectLink(uri);
      if (tg?.openLink) tg.openLink(link);
      else window.location.href = link;
    });
  }
  await provider.connect();
  return provider as Provider;
}
