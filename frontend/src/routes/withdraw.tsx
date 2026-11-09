import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, CheckCircle2, Clock3, ExternalLink, Headphones, History, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { usePlayer } from "@/hooks/use-player";
import { getWithdrawals, requestWithdraw, saveWalletDestination, type Withdrawal } from "@/lib/api.functions";
import { auth, openLink, PROOF_URL, SUPPORT_URL, haptic } from "@/lib/tg";
import { MIN_WITHDRAW_USD, coinsToUsd } from "@/lib/rules";
import { BSC_CHAIN_ID, BSC_CHAIN_ID_HEX, validBep20Address } from "@/lib/wallet-rules";
import { coinsForWithdrawUsd, HISTORY_LIMIT, isPendingWithdrawal } from "@/lib/withdraw-rules";
import { TRUST_EXTENSION_URL, TrustAppMissingError, connectTrustWalletSession, currentDeviceIsPhone, restoreTrustWalletSession } from "@/lib/trust-connect";

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

function collectTrustProvider(event: Event) {
  const detail = (event as CustomEvent<{
    info?: { uuid?: string; rdns?: string };
    provider?: TrustWalletProvider;
  }>).detail;
  if (detail?.info?.rdns?.toLowerCase() === "com.trustwallet.app" && detail.provider) {
    trustWalletProviders.set(detail.info.uuid || "trust-wallet", detail.provider);
  }
}

/** Trust Wallet injected by its in-app browser or its PC browser extension. */
function getInjectedTrustWallet(): TrustWalletProvider | null {
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
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_CHAIN_ID_HEX }] });
    } catch (error) {
      if (Number((error as { code?: number })?.code) !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [BSC_NETWORK] });
    }
  }
  const confirmedChain = await provider.request({ method: "eth_chainId" });
  if (Number(confirmedChain) !== BSC_CHAIN_ID) {
    throw new Error("Please select BNB Smart Chain (BEP-20) in Trust Wallet.");
  }
}

/** The PC extension can announce itself a moment late, so ask again briefly before giving up. */
async function findTrustExtension(): Promise<TrustWalletProvider | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const provider = getInjectedTrustWallet();
    if (provider) return provider;
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  return null;
}

/** Trust Wallet shield logo shown on the Connect button. */
function TrustWalletLogo() {
  return (
    <span className="trust-logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path className="trust-logo-left" d="M12 2.4 4.2 5.3v5.9c0 4.9 3.3 8.9 7.8 10.4V2.4Z" />
        <path className="trust-logo-right" d="M12 2.4v19.2c4.5-1.5 7.8-5.5 7.8-10.4V5.3L12 2.4Z" />
      </svg>
    </span>
  );
}

function firstAccount(accounts: unknown): string {
  return Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
}

export const Route = createFileRoute("/withdraw")({
  head: () => ({
    meta: [
      { title: "Wallet — Shooting Master" },
      { name: "description", content: "Connect Trust Wallet and withdraw your Shooting Master coins as USDT (BEP-20)." },
      { property: "og:title", content: "Wallet — Shooting Master" },
      { property: "og:description", content: "Connect Trust Wallet and withdraw your coins as USDT." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Withdraw,
});

function Withdraw() {
  const { data: me, refetch, setPlayer } = usePlayer();
  const qc = useQueryClient();
  const { data: history } = useQuery({
    queryKey: ["withdrawals"],
    queryFn: () => getWithdrawals(auth()),
    // Keep checking while a payout is still processing so "Pending" turns into "View" on its own.
    refetchInterval: (query) => (query.state.data ?? []).some((w) => isPendingWithdrawal(w.status)) ? 8_000 : false,
  });
  const [usd, setUsd] = useState(String(MIN_WITHDRAW_USD));
  const [walletAddress, setWalletAddress] = useState("");
  const [walletProvider, setWalletProvider] = useState<TrustWalletProvider | null>(null);
  const [isBscNetwork, setIsBscNetwork] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [showConnectHint, setShowConnectHint] = useState(false);
  const hintTimer = useRef<number | undefined>(undefined);

  const connected = Boolean(walletAddress) && isBscNetwork;
  const coins = me?.coins ?? 0;
  const balanceUsd = coinsToUsd(coins);
  const amount = Number(usd);
  const neededCoins = coinsForWithdrawUsd(amount);

  // Pick up the Trust Wallet extension and silently restore an earlier approval.
  useEffect(() => {
    let cancelled = false;
    window.addEventListener("eip6963:announceProvider", collectTrustProvider);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    (async () => {
      const injected = getInjectedTrustWallet();
      const provider = injected
        ? ((await injected.request({ method: "eth_accounts" }).then(firstAccount).catch(() => "")) ? injected : null)
        : await restoreTrustWalletSession();
      if (!provider || cancelled) return;
      const address = firstAccount(await provider.request({ method: "eth_accounts" }).catch(() => []));
      const chainId = await provider.request({ method: "eth_chainId" }).catch(() => 0);
      if (cancelled || !validBep20Address(address)) return;
      setWalletProvider(provider);
      setWalletAddress(address);
      setIsBscNetwork(Number(chainId) === BSC_CHAIN_ID);
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("eip6963:announceProvider", collectTrustProvider);
      window.clearTimeout(hintTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!walletProvider) return;
    const handleAccountsChanged = (...args: unknown[]) => {
      const address = firstAccount(args[0]);
      setWalletAddress(validBep20Address(address) ? address : "");
    };
    const handleChainChanged = (...args: unknown[]) => setIsBscNetwork(Number(args[0]) === BSC_CHAIN_ID);
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
    if (connecting) return;
    if (connected) {
      toast.success("Trust Wallet is connected.");
      return;
    }
    setConnecting(true);
    try {
      let provider: TrustWalletProvider | null = getInjectedTrustWallet();
      if (!provider) {
        if (currentDeviceIsPhone()) {
          // Phone: open the Trust Wallet app directly (Play Store / App Store if it is not installed).
          toast.info("Opening Trust Wallet… Approve USDT on BNB Smart Chain (BEP-20).");
          provider = await connectTrustWalletSession();
        } else {
          // PC: connect the Trust Wallet extension, or open its download page when it is missing.
          provider = await findTrustExtension();
          if (!provider) {
            toast.info("Trust Wallet extension not found. Install it, then tap Connect again.");
            openLink(TRUST_EXTENSION_URL);
            return;
          }
        }
      }
      if (!provider) throw new Error("Could not open Trust Wallet.");

      const address = firstAccount(await provider.request({ method: "eth_requestAccounts" }));
      if (!validBep20Address(address)) throw new Error("Trust Wallet did not return a valid BEP-20 address.");
      await switchToBnbSmartChain(provider);
      const active = firstAccount(await provider.request({ method: "eth_accounts" })) || address;
      if (!validBep20Address(active)) throw new Error("No valid wallet account is connected.");

      setWalletProvider(provider);
      setWalletAddress(active);
      setIsBscNetwork(true);
      setShowConnectHint(false);
      saveWalletDestination({ ...auth(), address: active, asset: "USDT", network: "BEP20" }).catch(() => {});
      haptic("success");
      toast.success("Trust Wallet connected.");
    } catch (error) {
      if (error instanceof TrustAppMissingError) {
        toast.info(error.message);
        return;
      }
      const code = Number((error as { code?: number | string })?.code);
      toast.error(code === 4001 ? "Wallet connection was cancelled." : error instanceof Error ? error.message : "Could not connect Trust Wallet.");
    } finally {
      setConnecting(false);
    }
  };

  const remindConnect = () => {
    haptic("error");
    setNudge((n) => n + 1);
    setShowConnectHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setShowConnectHint(false), 2600);
  };

  const submit = async () => {
    if (busy) return;
    if (!connected || !walletProvider) {
      remindConnect();
      return;
    }
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_USD) {
      toast.error(`Minimum withdrawal is $${MIN_WITHDRAW_USD}.`);
      return;
    }
    if (neededCoins > coins) {
      toast.error("Not enough coins for this amount.");
      return;
    }

    setBusy(true);
    try {
      const result = await requestWithdraw({ ...auth(), usd: amount, wallet: walletAddress, asset: "USDT", network: "BEP20" });
      haptic("success");
      // Deduct right away; the server has already reserved these coins.
      if (me) setPlayer({ ...me, coins: Math.max(0, me.coins - neededCoins) });
      qc.setQueryData<Withdrawal[]>(["withdrawals"], (rows = []) => [
        { id: result.id, coins: neededCoins, usd: Math.floor(amount * 100) / 100, wallet: walletAddress, status: result.status, created_at: new Date().toISOString(), channel_post_url: null },
        ...rows,
      ].slice(0, HISTORY_LIMIT));
      toast.success("Withdrawal sent! It will show as Pending until the payout is complete.");
      refetch();
      qc.invalidateQueries({ queryKey: ["withdrawals"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Withdrawal failed.");
    } finally {
      setBusy(false);
    }
  };

  const rows = (history ?? []).slice(0, HISTORY_LIMIT);

  return (
    <AppShell title="Wallet">
      <section className="wallet-card">
        <div className="wallet-card-top">
          <div>
            <p className="hud-label">Your balance</p>
            <h2 className="wallet-card-title">Wallet</h2>
          </div>
          <div className="relative">
            {showConnectHint && (
              <div role="alert" className="connect-hint">Connect wallet first</div>
            )}
            <button
              key={nudge}
              type="button"
              onClick={connectTrustWallet}
              disabled={connecting}
              className={"trust-connect-button" + (connected ? " is-connected" : "") + (nudge ? " animate-wallet-shake" : "")}
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : connected ? <CheckCircle2 className="h-4 w-4" /> : <TrustWalletLogo />}
              <span>{connecting ? "Connecting…" : connected ? "Connected" : "Connect"}</span>
            </button>
          </div>
        </div>

        <div className="wallet-balance-grid">
          <div className="wallet-balance-tile">
            <p className="hud-label">Dollars</p>
            <p className="wallet-balance-value text-success">${balanceUsd.toFixed(2)}</p>
          </div>
          <div className="wallet-balance-tile">
            <p className="hud-label">Coins</p>
            <p className="wallet-balance-value flex items-center gap-1.5">
              <span className="coin-dot" />
              <span className="truncate text-gold-gradient">{coins.toLocaleString()}</span>
            </p>
          </div>
        </div>

        <div className="hazard-divider" aria-hidden="true" />

        <h3 className="wallet-section-title">Withdraw to Trust Wallet</h3>
        <label className="block">
          <span className="wallet-amount-label-row">
            <span className="hud-label">Amount (min ${MIN_WITHDRAW_USD})</span>
            <span className="wallet-network-badge">BNB Smart Chain (BEP-20)</span>
          </span>
          <div className="wallet-amount-field">
            <span className="wallet-amount-prefix">$</span>
            <input
              type="number" min={MIN_WITHDRAW_USD} step="0.01" inputMode="decimal" value={usd}
              onChange={(e) => setUsd(e.target.value)}
              className="wallet-amount-input"
              aria-label="Withdrawal amount in dollars"
            />
            <span className="wallet-amount-suffix">USDT</span>
          </div>
        </label>
        <p className={"wallet-rate-note" + (neededCoins > coins ? " is-short" : "")}>
          Needs <span className="wallet-rate-coins">{neededCoins.toLocaleString()}</span> coins
        </p>
        <button onClick={submit} disabled={busy} className="fire-button w-full">
          {busy ? "Sending…" : "Withdraw"}
        </button>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <button onClick={() => openLink(PROOF_URL)} className="hud-chip-button">
          <BadgeCheck className="h-4 w-4 text-success" /> Payment proof
        </button>
        <button onClick={() => openLink(SUPPORT_URL)} className="hud-chip-button">
          <Headphones className="h-4 w-4 text-primary" /> Contact support
        </button>
      </section>

      <section className="mt-5">
        <h2 className="mb-2 flex items-center gap-2 text-xl"><History className="h-5 w-5 text-primary" /> Withdraw history</h2>
        {!rows.length && <p className="hud-panel p-4 text-center text-sm text-muted-foreground">No withdrawals yet</p>}
        <div className="space-y-2">
          {rows.map((h) => {
            const viewUrl = h.channel_post_url || (h.payout_tx_hash ? "https://bscscan.com/tx/" + h.payout_tx_hash : PROOF_URL);
            return (
              <div key={h.id} className="hud-panel flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="font-display text-lg">${h.usd.toFixed(2)} <span className="text-xs text-muted-foreground">· {h.coins.toLocaleString()} coins</span></p>
                  <p className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()}</p>
                </div>
                {h.status === "paid" ? (
                  <button type="button" onClick={() => openLink(viewUrl)} className="history-view-button">
                    View <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                ) : h.status === "rejected" ? (
                  <span className="history-status is-rejected">Rejected</span>
                ) : (
                  <span className="history-status is-pending"><Clock3 className="h-3.5 w-3.5" /> Pending</span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
