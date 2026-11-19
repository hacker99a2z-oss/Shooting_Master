import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { completeExternalWalletConnect } from "@/lib/api.functions";
import { BSC_CHAIN_ID, BSC_CHAIN_ID_HEX, validBep20Address } from "@/lib/wallet-rules";
import { TRUST_EXTENSION_URL, isTrustWalletInjectedProvider, selectTrustWalletInjectedProvider } from "@/lib/trust-connect";

type TrustProvider = {
  request: (args:{method:string;params?:unknown[]})=>Promise<unknown>;
  isTrust?:boolean;
  isTrustWallet?:boolean;
};
declare global {
  interface Window {
    trustwallet?:{ethereum?:TrustProvider};
    ethereum?:(TrustProvider & {providers?:TrustProvider[]});
  }
}
const BSC_NETWORK={chainId:BSC_CHAIN_ID_HEX,chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.bnbchain.org"],blockExplorerUrls:["https://bscscan.com"]};
const announcedProviders=new Map<string,TrustProvider>();
function collectProvider(event:Event){
  const detail=(event as CustomEvent<{info?:{uuid?:string};provider?:TrustProvider}>).detail;
  if(detail?.provider&&isTrustWalletInjectedProvider(detail.provider))announcedProviders.set(detail.info?.uuid||"trust-wallet",detail.provider);
}
function findProvider():TrustProvider|null{
  const inApp=window.trustwallet?.ethereum;
  if(inApp&&isTrustWalletInjectedProvider(inApp))return inApp;
  const announced=announcedProviders.values().next().value as TrustProvider|undefined;
  if(announced)return announced;
  const candidates=window.ethereum?.providers??(window.ethereum?[window.ethereum]:[]);
  return selectTrustWalletInjectedProvider(candidates) as TrustProvider|null;
}
function accountFrom(value:unknown):string{
  return Array.isArray(value)&&typeof value[0]==="string"?value[0]:"";
}
function ConnectWallet(){
  const [ticket,setTicket]=useState("");
  const [provider,setProvider]=useState<TrustProvider|null>(null);
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(false);
  const [error,setError]=useState("");
  const [embedded,setEmbedded]=useState(false);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    setTicket(params.get("ticket")??"");
    setEmbedded(window.top!==window.self);
    window.addEventListener("eip6963:announceProvider",collectProvider);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const discover=()=>{const found=findProvider();if(found)setProvider(found);};
    discover();
    const timer=window.setInterval(discover,250);
    const stop=window.setTimeout(()=>window.clearInterval(timer),6000);
    return ()=>{
      window.removeEventListener("eip6963:announceProvider",collectProvider);
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  },[]);
  const connect=async()=>{
    if(busy)return;
    setError("");
    if(embedded){setError("This connection page is still inside Telegram. Open it in a normal Brave browser tab.");return;}
    const active=provider??findProvider();
    if(!active){setError("Trust Wallet Extension was not detected. Install and unlock it in Brave, then reload this page.");return;}
    if(!/^[a-f0-9]{64}$/i.test(ticket)){setError("This secure connection link is missing or expired. Return to Shooting Master and tap Connect again.");return;}
    setBusy(true);
    try{
      const address=accountFrom(await active.request({method:"eth_requestAccounts"}));
      if(!validBep20Address(address))throw new Error("Trust Wallet did not return a valid BEP-20 address.");
      const chainId=await active.request({method:"eth_chainId"});
      if(Number(chainId)!==BSC_CHAIN_ID){
        try{await active.request({method:"wallet_switchEthereumChain",params:[{chainId:BSC_CHAIN_ID_HEX}]});}
        catch(reason){
          if(Number((reason as {code?:number})?.code)!==4902)throw reason;
          await active.request({method:"wallet_addEthereumChain",params:[BSC_NETWORK]});
        }
      }
      const confirmedChain=await active.request({method:"eth_chainId"});
      if(Number(confirmedChain)!==BSC_CHAIN_ID)throw new Error("Please select BNB Smart Chain (BEP-20) in Trust Wallet.");
      await completeExternalWalletConnect({ticket,address,asset:"USDT",network:"BEP20"});
      setDone(true);
      window.history.replaceState({},document.title,window.location.pathname);
    }catch(reason){
      const code=Number((reason as {code?:number})?.code);
      setError(code===4001?"Wallet connection was cancelled.":reason instanceof Error?reason.message:"Could not connect Trust Wallet.");
    }finally{setBusy(false);}
  };
  return <main className="min-h-screen bg-[#0b1220] px-5 py-12 text-white">
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1d2b49] text-3xl">🛡️</div>
        <h1 className="text-2xl font-bold">Connect Trust Wallet</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">Connect your Trust Wallet browser extension to Shooting Master over a secure, one-time link.</p>
      </div>
      {embedded?<div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">This page is still embedded inside Telegram. Open the same link in a normal Brave tab so Trust Wallet can approve the request.</div>:null}
      {done?<div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-center text-emerald-100"><div className="text-lg font-semibold">Wallet connected successfully</div><p className="mt-2 text-sm">Return to Shooting Master. The Wallet page will update automatically.</p></div>:<>
        <button type="button" onClick={connect} disabled={busy||embedded} className="rounded-2xl bg-indigo-600 px-5 py-4 font-semibold shadow-lg disabled:opacity-50">{busy?"Connecting…":"Connect Trust Wallet Extension"}</button>
        {error?<p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>:null}
        {!provider&&!embedded?<p className="text-center text-xs text-slate-400">Trust Wallet extension was not detected yet. Make sure it is enabled for shooting-master.pages.dev, then reload.</p>:null}
      </>}
      <p className="text-center text-xs text-slate-400">Only your public wallet address is shared with Shooting Master. The app never receives your recovery phrase or private keys.</p>
      <a href={TRUST_EXTENSION_URL} target="_blank" rel="noreferrer" className="text-center text-sm text-indigo-300 underline">Get Trust Wallet Extension</a>
    </div>
  </main>;
}
export const Route=createFileRoute("/connect-wallet")({component:ConnectWallet});
