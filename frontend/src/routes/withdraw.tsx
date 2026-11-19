import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, CheckCircle2, Clock3, ExternalLink, Headphones, History, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { usePlayer } from "@/hooks/use-player";
import { createWalletConnectTicket, getWalletConnectTicketStatus, getWalletDestination, getWithdrawals, requestWithdraw, saveWalletDestination, type WalletConnectTicket, type Withdrawal } from "@/lib/api.functions";
import { auth, openLink, PROOF_URL, SUPPORT_URL, haptic } from "@/lib/tg";
import { MIN_WITHDRAW_USD } from "@/lib/rules";
import { BSC_CHAIN_ID, BSC_CHAIN_ID_HEX, shortenWalletAddress, validBep20Address } from "@/lib/wallet-rules";
import { checkWithdrawalEligibility, coinsForWithdrawUsd, withdrawalCentsForUsd, HISTORY_LIMIT, isPendingWithdrawal, withdrawalStatusLabel } from "@/lib/withdraw-rules";
import { TRUST_EXTENSION_URL, connectPreparedTrustWalletSession, currentDeviceIsPhone, currentDeviceNeedsExternalWalletBridge, disconnectTrustWalletProvider, isTrustWalletInjectedProvider, prepareTrustWalletSession, restoreTrustWalletSession, selectTrustWalletInjectedProvider } from "@/lib/trust-connect";

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
  disconnect?: () => Promise<void>;
  isTrust?: boolean;
  isTrustWallet?: boolean;
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
  // Trust Wallet extension announces an EIP-1193 provider via EIP-6963.
  // Identify it by the provider flags, not a single hard-coded rdns string.
  if (detail?.provider && isTrustWalletInjectedProvider(detail.provider)) {
    trustWalletProviders.set(detail.info?.uuid || "trust-wallet", detail.provider);
  }
}

/** Trust Wallet injected by its in-app browser or its PC browser extension. */
function getInjectedTrustWallet(): TrustWalletProvider | null {
  if (typeof window === "undefined") return null;
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  const inApp = window.trustwallet?.ethereum;
  if (inApp?.request) return inApp;

  const announced = trustWalletProviders.values().next().value as TrustWalletProvider | undefined;
  if (announced && isTrustWalletInjectedProvider(announced)) return announced;

  const providers = window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : []);
  return selectTrustWalletInjectedProvider(providers) as TrustWalletProvider | null;
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
  for (let attempt = 0; attempt < 12; attempt++) {
    const provider = getInjectedTrustWallet();
    if (provider) return provider;
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  return null;
}

/** Telegram Desktop runs Mini Apps in its own isolated WebView, not in Brave's tab. */
function isTelegramDesktopShell(): boolean {
  const platform = String(window.Telegram?.WebApp?.platform ?? "").toLowerCase();
  return ["tdesktop", "macos", "windows", "linux", "unigram"].includes(platform);
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
  const [lastWalletAddress, setLastWalletAddress] = useState("");
  const [walletConnectPreparing, setWalletConnectPreparing] = useState(false);
  const [walletProvider, setWalletProvider] = useState<TrustWalletProvider | null>(null);
  const [isBscNetwork, setIsBscNetwork] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pendingWalletConnectUrl, setPendingWalletConnectUrl] = useState<string | null>(null);
  const [walletBridgeTicket, setWalletBridgeTicket] = useState<WalletConnectTicket | null>(null);
  const [pendingWalletBridgeTicket, setPendingWalletBridgeTicket] = useState<string | null>(null);
  const [externalWalletVerified, setExternalWalletVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [showConnectHint, setShowConnectHint] = useState(false);
  const hintTimer = useRef<number | undefined>(undefined);

  const connected = Boolean(walletAddress) && isBscNetwork;
  const coins = me?.coins ?? 0;
  const withdrawBalanceCents = me?.withdrawBalanceCents ?? 0;
  const balanceUsd = withdrawBalanceCents / 100;
  const amount = Number(usd);
  const neededCents = withdrawalCentsForUsd(amount);
  const neededCoins = coinsForWithdrawUsd(amount);
  const eligibility = checkWithdrawalEligibility({
    usd: amount,
    minimumUsd: MIN_WITHDRAW_USD,
    withdrawBalanceCents,
    coins,
    walletConnected: connected && (Boolean(walletProvider) || externalWalletVerified) && walletAddress.toLowerCase() === lastWalletAddress.toLowerCase(),
  });

  // Restore the server-saved address and approved wallet session. Prepare a fresh mobile
  // WalletConnect URI ahead of the user's tap so the Connect tap opens Trust Wallet directly.
  useEffect(() => {
    let cancelled = false;
    window.addEventListener("eip6963:announceProvider", collectTrustProvider);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    void getWalletDestination(auth()).then(({ destination }) => {
      if (!cancelled && destination?.address) setLastWalletAddress(destination.address);
    }).catch(() => {});

    (async () => {
      if (currentDeviceNeedsExternalWalletBridge()) {
        try {
          const ticket = await createWalletConnectTicket(auth());
          if (!cancelled) setWalletBridgeTicket(ticket);
        } catch {
          if (!cancelled) toast.error("Could not prepare the secure browser wallet connection.");
        }
        return;
      }
      const injected = getInjectedTrustWallet();
      const provider = injected
        ? ((await injected.request({ method: "eth_accounts" }).then(firstAccount).catch(() => "")) ? injected : null)
        : await restoreTrustWalletSession();
      if (provider && !cancelled) {
        const address = firstAccount(await provider.request({ method: "eth_accounts" }).catch(() => []));
        const chainId = await provider.request({ method: "eth_chainId" }).catch(() => 0);
        if (!cancelled && validBep20Address(address)) {
          setWalletProvider(provider);
          setWalletAddress(address);
          setLastWalletAddress(address);
          setIsBscNetwork(Number(chainId) === BSC_CHAIN_ID);
          return;
        }
      }
      if (!cancelled && currentDeviceIsPhone()) {
        setWalletConnectPreparing(true);
        void prepareTrustWalletSession(
          (link) => { if (!cancelled) { setPendingWalletConnectUrl(link); setWalletConnectPreparing(false); } },
          () => { if (!cancelled) setWalletConnectPreparing(false); },
        ).catch(() => { if (!cancelled) setWalletConnectPreparing(false); });
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("eip6969:announceProvider", collectTrustProvider);
      window.clearTimeout(hintTimer.current);
    };
  }, []);


  useEffect(() => {
    if (!pendingWalletBridgeTicket) return;
    let active=true,inFlight=false,attempts=0;
    const poll=async()=>{
      if(!active||inFlight)return;
      inFlight=true;
      try{
        const status=await getWalletConnectTicketStatus({...auth(),ticket:pendingWalletBridgeTicket});
        if(!active)return;
        if(status.completed&&status.destination&&validBep20Address(status.destination.address)&&status.destination.chainId===BSC_CHAIN_ID){
          setWalletAddress(status.destination.address);
          setLastWalletAddress(status.destination.address);
          setIsBscNetwork(true);
          setWalletProvider(null);
          setExternalWalletVerified(true);
          setPendingWalletBridgeTicket(null);
          setWalletBridgeTicket(null);
          toast.success("Trust Wallet extension connected.");
          qc.invalidateQueries({queryKey:["wallet-destination"]});
          return;
        }
        if(status.expired){
          setPendingWalletBridgeTicket(null);
          toast.error("Wallet connection link expired. Tap Connect again.");
          return;
        }
      }catch{/* Continue polling while the one-time ticket is valid. */}
      finally{inFlight=false;}
      attempts++;
      if(active&&attempts>=150){
        setPendingWalletBridgeTicket(null);
        toast.info("Wallet connection was not completed. Tap Connect to try again.");
      }
    };
    void poll();
    const timer=window.setInterval(()=>void poll(),2000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[pendingWalletBridgeTicket,qc]);

  useEffect(() => {
    if (!walletProvider) return;
    const handleAccountsChanged = (...args: unknown[]) => {
      const address = firstAccount(args[0]);
      const valid = validBep20Address(address) ? address : "";
      setWalletAddress(valid);
      if (valid) {
        setLastWalletAddress(valid);
        saveWalletDestination({ ...auth(), address: valid, asset: "USDT", network: "BEP20" }).catch(() => {});
      }
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
    if (connected && externalWalletVerified && !walletProvider) {
      setWalletAddress("");
      setIsBscNetwork(false);
      setExternalWalletVerified(false);
      toast.success("Wallet disconnected from Shooting Master. Your saved destination is unchanged.");
      return;
    }
    if (currentDeviceNeedsExternalWalletBridge()) {
      if (!walletBridgeTicket || walletBridgeTicket.expiresAt <= Date.now()) {
        toast.info("Secure browser connection is preparing. Tap Connect again in a moment.");
        void createWalletConnectTicket(auth()).then(setWalletBridgeTicket).catch(() => toast.error("Could not prepare the browser wallet connection."));
        return;
      }
      setPendingWalletBridgeTicket(walletBridgeTicket.ticket);
      openLink(walletBridgeTicket.url);
      toast.info("Finish connecting in the new Brave browser tab. This page will update automatically.");
      return;
    }
    if (connected && walletProvider) {
      setConnecting(true);
      try {
        await disconnectTrustWalletProvider(walletProvider);
        setWalletProvider(null);
        setWalletAddress("");
        setIsBscNetwork(false);
        setPendingWalletConnectUrl(null);
        toast.success("Trust Wallet disconnected. Your last-used address is saved.");
        if (currentDeviceIsPhone()) {
          setWalletConnectPreparing(true);
          void prepareTrustWalletSession(
            (link) => { setPendingWalletConnectUrl(link); setWalletConnectPreparing(false); },
            () => setWalletConnectPreparing(false),
          ).catch(() => setWalletConnectPreparing(false));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not disconnect Trust Wallet.");
      } finally {
        setConnecting(false);
      }
      return;
    }

    setConnecting(true);
    try {
      let provider: TrustWalletProvider | null = getInjectedTrustWallet();
      if (!provider && currentDeviceIsPhone()) {
        const link = pendingWalletConnectUrl;
        if (!link) {
          toast.info("Trust Wallet is preparing the secure connection. Tap Connect again in a moment.");
          if (!walletConnectPreparing) {
            setWalletConnectPreparing(true);
            void prepareTrustWalletSession(
              (preparedLink) => { setPendingWalletConnectUrl(preparedLink); setWalletConnectPreparing(false); },
              () => setWalletConnectPreparing(false),
            ).catch(() => setWalletConnectPreparing(false));
          }
          return;
        }
        // Telegram requires openLink to run synchronously from the user's tap.
        const telegram = window.Telegram?.WebApp;
        if (typeof telegram?.openLink === "function") telegram.openLink(link);
        else window.location.assign(link);
        provider = await connectPreparedTrustWalletSession() as TrustWalletProvider;
      } else if (!provider) {
        provider = await findTrustExtension();
        if (!provider) {
          if (isTelegramDesktopShell()) {
            toast.info("Telegram Desktop's built-in window cannot access Brave extensions. Open Telegram Web in Brave, sign in, then launch Shooting Master there to connect Trust Wallet.");
            openLink("https://web.telegram.org/");
          } else {
            toast.info("Trust Wallet extension not found. Install or unlock it in this browser, then tap Connect again.");
            openLink(TRUST_EXTENSION_URL);
          }
          return;
        }
      }
      if (!provider) throw new Error("Could not open Trust Wallet.");
      const address = firstAccount(await provider.request({ method: "eth_requestAccounts" }));
      if (!validBep20Address(address)) throw new Error("Trust Wallet did not return a valid BEP-20 address.");
      await switchToBnbSmartChain(provider);
      const active = firstAccount(await provider.request({ method: "eth_accounts" })) || address;
      if (!validBep20Address(active)) throw new Error("No valid wallet account is connected.");

      await saveWalletDestination({ ...auth(), address: active, asset: "USDT", network: "BEP20" });
      setWalletProvider(provider);
      setWalletAddress(active);
      setLastWalletAddress(active);
      setPendingWalletConnectUrl(null);
      setIsBscNetwork(true);
      setShowConnectHint(false);
      haptic("success");
      toast.success("Trust Wallet connected.");
    } catch (error) {
      const code = Number((error as { code?: number | string })?.code);
      toast.error(code === 4001 ? "Wallet connection was cancelled." : error instanceof Error ? error.message : "Could not connect Trust Wallet.");
      if (currentDeviceIsPhone()) {
        setWalletConnectPreparing(true);
        void prepareTrustWalletSession(
          (link) => { setPendingWalletConnectUrl(link); setWalletConnectPreparing(false); },
          () => setWalletConnectPreparing(false),
        ).catch(() => setWalletConnectPreparing(false));
      }
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
    if (!connected || !walletProvider || walletAddress.toLowerCase() !== lastWalletAddress.toLowerCase()) {
      remindConnect();
      return;
    }
    if (!eligibility.canWithdraw) {
      if (eligibility.reason === "wallet_not_connected") {
        remindConnect();
      } else {
        toast.error(eligibility.message);
      }
      return;
    }

    setBusy(true);
    try {
      const result = await requestWithdraw({ ...auth(), usd: amount, wallet: walletAddress, asset: "USDT", network: "BEP20" });
      haptic("success");
      // Deduct right away; the server has already reserved these coins.
      setPlayer(result.player);
      qc.setQueryData<Withdrawal[]>(["withdrawals"], (rows = []) => [
        { id: result.id, coins: neededCoins, usd: Math.floor(amount * 100) / 100, wallet: walletAddress, status: result.status, created_at: new Date().toISOString(), channel_post_url: null },
        ...rows,
      ].slice(0, HISTORY_LIMIT));
      toast.success("Withdrawal request submitted. Waiting for owner approval.");
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
              disabled={connecting || (walletConnectPreparing && !pendingWalletConnectUrl && !connected)}
              className={"trust-connect-button" + (connected ? " is-connected" : "") + (nudge ? " animate-wallet-shake" : "")}
            >
              {connecting || (walletConnectPreparing && !connected) ? <Loader2 className="h-4 w-4 animate-spin" /> : connected ? <CheckCircle2 className="h-4 w-4" /> : <TrustWalletLogo />}
              <span>{connecting ? (connected ? "Disconnecting…" : "Connecting…") : walletConnectPreparing && !pendingWalletConnectUrl && !connected ? "Preparing…" : connected ? "Disconnect" : "Connect"}</span>
            </button>

          </div>
        </div>

        <div className="wallet-balance-grid">
          <div className="wallet-balance-tile">
            <p className="hud-label">Withdraw Balance</p>
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
            <span className="wallet-network-badge">{walletAddress ? shortenWalletAddress(walletAddress) : lastWalletAddress ? "Last: " + shortenWalletAddress(lastWalletAddress) : "No wallet connected"}</span>
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
        {eligibility.reason !== "ready" && (
          <p className="mt-2 text-xs text-destructive" role="status" aria-live="polite">
            {eligibility.message}
          </p>
        )}
        <button onClick={submit} disabled={busy || !eligibility.canWithdraw} className="fire-button w-full" aria-disabled={busy || !eligibility.canWithdraw}>
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
                  <span className="history-status is-pending"><Clock3 className="h-3.5 w-3.5" /> {withdrawalStatusLabel(h.status)}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
