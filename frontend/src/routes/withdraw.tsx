import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, CheckCircle2, Headphones, History, Wallet } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { usePlayer } from "@/hooks/use-player";
import { getWithdrawals, requestWithdraw } from "@/lib/api.functions";
import { auth, openLink, PROOF_URL, SUPPORT_URL, haptic, webApp } from "@/lib/tg";
import { COINS_PER_USD, MIN_WITHDRAW_USD, coinsToUsd } from "@/lib/rules";

const BSC_CHAIN_ID = 56;
const BSC_CHAIN_ID_HEX = "0x38";
const BSC_NETWORK = {
  chainId: BSC_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
  blockExplorerUrls: ["https://bscscan.com"],
};

type TrustWalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  isTrust?: boolean;
};

declare global {
  interface Window {
    trustwallet?: { ethereum?: TrustWalletProvider };
    ethereum?: TrustWalletProvider & { providers?: TrustWalletProvider[] };
  }
}

const trustWalletProviders = new Map<string, TrustWalletProvider>();

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const detail = (event as CustomEvent<{
      info?: { uuid?: string; rdns?: string };
      provider?: TrustWalletProvider;
    }>).detail;
    if (detail?.info?.rdns?.toLowerCase() === "com.trustwallet.app" && detail.provider) {
      trustWalletProviders.set(detail.info.uuid || "trust-wallet", detail.provider);
    }
  });
}

function getTrustWalletProvider(): TrustWalletProvider | null {
  if (typeof window === "undefined") return null;
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  const inApp = window.trustwallet?.ethereum;
  if (inApp?.request) return inApp;

  const announced = trustWalletProviders.values().next().value as TrustWalletProvider | undefined;
  if (announced?.request) return announced;

  const providers = window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : []);
  return providers.find((provider) => provider.isTrust === true) ?? null;
}

async function switchToBnbSmartChain(provider: TrustWalletProvider) {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (Number(chainId) !== BSC_CHAIN_ID) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BSC_CHAIN_ID_HEX }],
      });
    } catch (error) {
      if (Number((error as { code?: number })?.code) !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [BSC_NETWORK],
      });
    }
  }

  const confirmedChain = await provider.request({ method: "eth_chainId" });
  if (Number(confirmedChain) !== BSC_CHAIN_ID) {
    throw new Error("Please select BNB Smart Chain (BEP-20) in Trust Wallet.");
  }
}

function shortAddress(address: string) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}


export const Route = createFileRoute("/withdraw")({
  head: () => ({
    meta: [
      { title: "Withdraw — Coin Rush" },
      { name: "description", content: "Convert your Coin Rush coins to dollars and withdraw to Trust Wallet." },
      { property: "og:title", content: "Withdraw — Coin Rush" },
      { property: "og:description", content: "Convert coins to dollars and withdraw to Trust Wallet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Withdraw,
});

function Withdraw() {
  const { data: me, refetch } = usePlayer();
  const qc = useQueryClient();
  const { data: history } = useQuery({ queryKey: ["withdrawals"], queryFn: () => getWithdrawals(auth()) });
  const [usd, setUsd] = useState(String(MIN_WITHDRAW_USD));
  const [walletAddress, setWalletAddress] = useState("");
  const [walletProvider, setWalletProvider] = useState<TrustWalletProvider | null>(null);
  const [isBscNetwork, setIsBscNetwork] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);

  const coins = me?.coins ?? 0;
  const balanceUsd = coinsToUsd(coins);
  const amount = Number(usd);
  const validAmount = Number.isFinite(amount) && amount >= MIN_WITHDRAW_USD;
  const needCoins = Math.round((amount || 0) * COINS_PER_USD);

  useEffect(() => {
    if (!walletProvider) return;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0];
      const address = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      setWalletAddress(/^0x[a-fA-F0-9]{40}$/.test(address) ? address : "");
      if (!address) setIsBscNetwork(false);
    };
    const handleChainChanged = (...args: unknown[]) => {
      setIsBscNetwork(Number(args[0]) === BSC_CHAIN_ID);
    };
    const handleDisconnect = () => {
      setWalletAddress("");
      setIsBscNetwork(false);
      setWalletProvider(null);
    };

    walletProvider.on?.("accountsChanged", handleAccountsChanged);
    walletProvider.on?.("chainChanged", handleChainChanged);
    walletProvider.on?.("disconnect", handleDisconnect);

    return () => {
      walletProvider.removeListener?.("accountsChanged", handleAccountsChanged);
      walletProvider.removeListener?.("chainChanged", handleChainChanged);
      walletProvider.removeListener?.("disconnect", handleDisconnect);
    };
  }, [walletProvider]);

  const connectTrustWallet = async () => {
    setConnecting(true);
    try {
      const provider = getTrustWalletProvider();
      if (!provider) {
        const mobileOrTelegram = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || Boolean(webApp());
        if (mobileOrTelegram) {
          const deepLink = "https://link.trustwallet.com/open_url?coin_id=714&url=" + encodeURIComponent(window.location.href);
          toast.info("Opening Trust Wallet. Connect after this page opens in its browser.");
          window.location.assign(deepLink);
        } else {
          toast.error("Trust Wallet was not detected. Install the official browser extension, then reconnect.");
          window.open("https://trustwallet.com/browser-extension", "_blank", "noopener,noreferrer");
        }
        return;
      }

      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const firstAddress = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      if (!/^0x[a-fA-F0-9]{40}$/.test(firstAddress)) {
        throw new Error("Trust Wallet did not return a valid BEP-20 address.");
      }

      await switchToBnbSmartChain(provider);
      const activeAccounts = await provider.request({ method: "eth_accounts" });
      const activeAddress = Array.isArray(activeAccounts) && typeof activeAccounts[0] === "string"
        ? activeAccounts[0]
        : firstAddress;
      if (!/^0x[a-fA-F0-9]{40}$/.test(activeAddress)) {
        throw new Error("No valid wallet account is connected.");
      }

      setWalletProvider(provider);
      setWalletAddress(activeAddress);
      setIsBscNetwork(true);
      haptic("success");
      toast.success("Trust Wallet connected on BEP-20.");
    } catch (error) {
      const code = Number((error as { code?: number | string })?.code);
      const message = code === 4001
        ? "Wallet connection was cancelled."
        : error instanceof Error ? error.message : "Could not connect Trust Wallet.";
      toast.error(message);
    } finally {
      setConnecting(false);
    }
  };

  const submit = async () => {
    if (!walletAddress || !isBscNetwork) {
      toast.error("Connect Trust Wallet on BNB Smart Chain (BEP-20) first.");
      return;
    }
    if (!validAmount) {
      toast.error("Enter a valid withdrawal amount.");
      return;
    }

    setBusy(true);
    try {
      const result = await requestWithdraw({ ...auth(), usd: amount, wallet: walletAddress, asset: "USDT", network: "BEP20" });
      haptic("success");
      toast.success(result.automatic ? "USDT payout queued for automatic BEP-20 transfer." : "Withdrawal request sent for manual review.");
      refetch();
      qc.invalidateQueries({ queryKey: ["withdrawals"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Wallet">
      <section className="relative overflow-hidden rounded-3xl border border-primary/30 bg-card p-5 shadow-card">
        <div className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-gold opacity-25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-14 -left-10 h-40 w-40 rounded-full bg-coral opacity-20 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Balance</p>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold shadow-glow">
            <Wallet className="h-6 w-6 text-primary-foreground" />
          </div>
        </div>
        <div className="relative mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border bg-muted p-3">
            <p className="text-xs text-muted-foreground">Dollars</p>
            <p className="font-display text-3xl text-success">${balanceUsd.toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border bg-muted p-3">
            <p className="text-xs text-muted-foreground">Coins</p>
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-5 w-5 shrink-0 rounded-full bg-gold shadow-glow" />
              <span className="truncate font-display text-3xl text-gold-gradient">{coins.toLocaleString()}</span>
            </p>
          </div>
        </div>
        <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-gold" style={{ width: `${Math.min(100, (balanceUsd / MIN_WITHDRAW_USD) * 100)}%` }} />
        </div>
        <p className="relative mt-1.5 text-xs text-muted-foreground">
          {balanceUsd >= MIN_WITHDRAW_USD ? "Ready to withdraw!" : `${Math.max(0, MIN_WITHDRAW_USD * COINS_PER_USD - coins).toLocaleString()} more coins to reach $${MIN_WITHDRAW_USD}`} · {COINS_PER_USD.toLocaleString()} coins = $1
        </p>
      </section>

      <section className="mt-4 space-y-3 rounded-3xl border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl">Withdraw USDT to Trust Wallet</h2>
          <button
            type="button"
            onClick={connectTrustWallet}
            disabled={connecting}
            className="shrink-0 rounded-xl border border-primary/50 bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground transition-transform active:scale-95 disabled:opacity-50"
          >
            {connecting ? "Connecting…" : walletAddress ? "Connected" : "Connect"}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {walletAddress && isBscNetwork
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              : <Wallet className="h-4 w-4 shrink-0" />}
            <span className="truncate">{walletAddress ? shortAddress(walletAddress) : "Trust Wallet not connected"}</span>
          </span>
          <span className={"text-xs font-medium " + (walletAddress && isBscNetwork ? "text-success" : "text-muted-foreground")}>
            {walletAddress && isBscNetwork ? "BNB Smart Chain · BEP-20" : walletAddress ? "Switch to BEP-20" : "BEP-20 only"}
          </span>
        </div>
        <label className="block text-xs text-muted-foreground">
          Amount (USD, min ${MIN_WITHDRAW_USD})
          <input
            type="number" min={MIN_WITHDRAW_USD} step="0.01" inputMode="decimal" value={usd}
            onChange={(e) => setUsd(e.target.value)}
            className="mt-1 w-full rounded-xl border bg-input px-3 py-3 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <div className="flex items-center justify-between rounded-xl border bg-muted px-3 py-2">
          <span className="text-xs text-muted-foreground">Coins needed</span>
          <span className={`flex items-center gap-1.5 font-display text-lg ${needCoins > coins ? "text-destructive" : "text-gold-gradient"}`}>
            <span className="inline-block h-4 w-4 rounded-full bg-gold" />
            {needCoins.toLocaleString()}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Payout asset: USDT · Network: BNB Smart Chain (BEP-20). Your connected wallet is used automatically. Eligible requests are paid automatically when enabled; requests outside payout limits go to review.
        </p>
        <button
          onClick={submit}
          disabled={busy || connecting || !walletAddress || !isBscNetwork || !validAmount || needCoins > coins}
          className="w-full rounded-2xl bg-gold py-3.5 font-display text-xl text-primary-foreground shadow-glow active:scale-95 transition-transform disabled:opacity-40 disabled:shadow-none"
        >
          {busy ? "Sending…" : !walletAddress ? "Connect wallet first" : !isBscNetwork ? "Switch to BEP-20" : needCoins > coins ? "Not enough coins" : "Withdraw"}
        </button>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <button onClick={() => openLink(PROOF_URL)} className="flex items-center justify-center gap-2 rounded-2xl border bg-secondary py-3 text-sm font-medium active:scale-95 transition-transform">
          <BadgeCheck className="h-4 w-4 text-success" /> Payment proof
        </button>
        <button onClick={() => openLink(SUPPORT_URL)} className="flex items-center justify-center gap-2 rounded-2xl border bg-secondary py-3 text-sm font-medium active:scale-95 transition-transform">
          <Headphones className="h-4 w-4 text-primary" /> Contact support
        </button>
      </section>

      <section className="mt-5">
        <h2 className="mb-2 flex items-center gap-2 text-xl"><History className="h-5 w-5" /> History</h2>
        {!history?.length && <p className="rounded-2xl border bg-card p-4 text-center text-sm text-muted-foreground">No withdrawals yet</p>}
        <div className="space-y-2">
          {history?.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-2 rounded-2xl border bg-card p-3 shadow-card">
              <div className="min-w-0">
                <p className="font-display text-lg">${h.usd.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()} · {h.wallet.slice(0, 6)}…{h.wallet.slice(-4)}</p>
                {h.payout_tx_hash && <a href={"https://bscscan.com/tx/" + h.payout_tx_hash} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-primary underline">View BEP-20 transaction</a>}
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium capitalize ${h.status === "paid" ? "bg-success text-primary-foreground" : h.status === "rejected" || h.status === "payout_failed_review" ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground"}`}>
                {h.status === "pending_auto" || h.status === "processing" ? "processing" : h.status === "payout_failed_review" ? "needs review" : h.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
