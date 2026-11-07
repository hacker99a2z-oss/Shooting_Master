import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gift, Tv, Timer, Zap, Pickaxe, Hourglass } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GoldMiner } from "@/components/GoldMiner";
import { GoldNugget } from "@/components/GoldNugget";
import { usePlayer } from "@/hooks/use-player";
import { startAdPlay, grantAdPlay, getAdPlayStatus, cancelAdPlay, claimDailyEnergy, giveMinerEnergy, claimMinedGold, type AdPlayStatus } from "@/lib/api.functions";
import { auth, haptic, showRewardAd } from "@/lib/tg";
import { ENERGY_PER_AD, ENERGY_PER_GIVE, ENERGY_PER_CYCLE, MINE_CAPACITY, MINE_CYCLE_MS, formatGold, mineRemainingMs, settleMine } from "@/lib/mining";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gold Mine — Power Your Miner with Energy" },
      { name: "description", content: "Claim your daily bonus, watch ads for energy and give it to your miner to dig real gold every 2 minutes." },
      { property: "og:title", content: "Gold Mine — Power Your Miner with Energy" },
      { property: "og:description", content: "Collect energy, feed your gold miner and claim the gold it digs up." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const PENDING_AD_KEY = "shooting-master.pending-ad-session";

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function Home() {
  const { data: me, isLoading, error, refetch, setPlayer, dataUpdatedAt } = usePlayer();
  const [busy, setBusy] = useState(false);
  const [mineBusy, setMineBusy] = useState(false);
  const [pendingAdSessionId, setPendingAdSessionId] = useState(() => {
    try { return localStorage.getItem(PENDING_AD_KEY) || ""; }
    catch { return ""; }
  });

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(i); }, []);
  // Timers follow the server clock: the offset is measured each time fresh player data arrives.
  const offset = me?.serverNow && dataUpdatedAt ? me.serverNow - dataUpdatedAt : 0;
  const serverNow = nowMs + offset;
  const waitSec = me ? Math.max(0, Math.ceil((me.adReadyAt - serverNow) / 1000)) : 0;
  const dailyClaimed = Boolean(me?.energyBonusClaimedToday);

  useEffect(() => {
    try {
      if (pendingAdSessionId) localStorage.setItem(PENDING_AD_KEY, pendingAdSessionId);
      else localStorage.removeItem(PENDING_AD_KEY);
    } catch { /* local storage may be disabled in a restricted webview */ }
  }, [pendingAdSessionId]);

  const onAdVerified = useCallback((status: AdPlayStatus) => {
    setPlayer(status);
    setPendingAdSessionId("");
    haptic("success");
    toast.success(`AdsGram verified the reward. +${ENERGY_PER_AD} Energy!`);
  }, [setPlayer]);

  // Keep checking a pending session after the SDK reports a full view and after a
  // Telegram WebView is reopened. Only the protected server Reward URL adds energy.
  useEffect(() => {
    if (!pendingAdSessionId || busy) return;
    let stopped = false;
    let checking = false;
    const poll = async () => {
      if (stopped || checking) return;
      checking = true;
      try {
        const status = await getAdPlayStatus({ ...auth(), adSessionId: pendingAdSessionId });
        if (stopped) return;
        if (status.verified) onAdVerified(status);
        else {
          setPlayer(status);
          if (status.expired) {
            setPendingAdSessionId("");
            toast.error("AdsGram did not confirm this ad before the session expired. Please watch a new ad.");
          }
        }
      } catch (e) {
        if (!stopped) console.warn("[AdsGram] server verification remains pending", e);
      } finally {
        checking = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [pendingAdSessionId, busy, onAdVerified, setPlayer]);

  const claimBonus = async () => {
    if (busy || dailyClaimed) return;
    setBusy(true);
    try {
      const p = await claimDailyEnergy(auth());
      setPlayer(p);
      haptic("success");
      toast.success(`Daily bonus claimed: +${p.bonusEnergy} Energy!`);
    } catch (e: any) {
      toast.error(e.message || "Could not claim the daily bonus");
    } finally {
      setBusy(false);
    }
  };

  const checkPendingAd = async () => {
    if (busy || !pendingAdSessionId) return;
    setBusy(true);
    try {
      const status = await getAdPlayStatus({ ...auth(), adSessionId: pendingAdSessionId });
      if (status.verified) onAdVerified(status);
      else {
        setPlayer(status);
        if (status.expired) {
          setPendingAdSessionId("");
          toast.error("This AdsGram session expired without a server reward. Please watch a new ad.");
        } else {
          toast.info("Waiting for AdsGram's server callback. Energy is added automatically as soon as it is verified.");
        }
      }
    } catch (e: any) {
      toast.error(e.message || "Could not check AdsGram confirmation");
    } finally {
      setBusy(false);
    }
  };

  const watchAd = async () => {
    if (busy || waitSec > 0 || !dailyClaimed || pendingAdSessionId) return;
    setBusy(true);
    let adSessionId = "";
    try {
      const session = await startAdPlay(auth());
      adSessionId = session.adSessionId;
      // Persist before the SDK opens. If Telegram closes mid-ad, a verified callback
      // can still be recovered automatically when the user reopens the Mini App.
      setPendingAdSessionId(adSessionId);
      const adResult = await showRewardAd();

      if (!adResult.done || adResult.error) {
        const cancelled = await cancelAdPlay({ ...auth(), adSessionId }).catch(() => null);
        if (cancelled?.verified) onAdVerified(cancelled);
        else {
          if (cancelled) setPlayer(cancelled);
          setPendingAdSessionId("");
          toast.info("The ad was skipped or not completed. No energy was added.");
        }
        return;
      }

      console.info("[AdsGram] SDK show() confirmed a completed rewarded view; waiting for the server Reward URL", { state: adResult.state || "destroy" });
      const confirmation = await grantAdPlay({ ...auth(), adSessionId });
      if (confirmation.verified) onAdVerified(confirmation);
      else {
        setPlayer(confirmation);
        toast.info("Ad fully viewed. Waiting for AdsGram's server verification. Energy is added automatically after confirmation.");
      }
    } catch (e: any) {
      console.error("[AdsGram] watch-for-energy flow failed", {
        hasAdSession: Boolean(adSessionId),
        message: e?.message || String(e),
      });
      if (adSessionId) {
        const cancelled = await cancelAdPlay({ ...auth(), adSessionId }).catch(() => null);
        if (cancelled?.verified) onAdVerified(cancelled);
        else {
          setPendingAdSessionId("");
          toast.error(e?.message || "Ad could not be loaded. Please try again.");
        }
      } else {
        toast.error(e?.message || "Ad could not be loaded. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  // Live mining view, recalculated every second from the server's last mining state.
  const mineState = me?.mine ? { energy: me.mine.energy, updatedAt: me.mine.updatedAt, pending: me.mine.pendingGold } : { energy: 0, updatedAt: serverNow, pending: 0 };
  const live = settleMine(mineState, serverNow);
  const remainingMs = mineRemainingMs(mineState, serverNow);
  const mining = live.energy >= ENERGY_PER_CYCLE;
  const cycleElapsed = mining ? Math.min(MINE_CYCLE_MS, serverNow - live.updatedAt) : 0;
  const nextGoldMs = mining ? MINE_CYCLE_MS - cycleElapsed : 0;
  const energy = me?.energy ?? 0;
  const minerFull = live.energy + ENERGY_PER_GIVE > MINE_CAPACITY;

  const give = async () => {
    if (mineBusy) return;
    setMineBusy(true);
    try {
      const p = await giveMinerEnergy(auth());
      setPlayer(p);
      haptic("medium");
    } catch (e: any) {
      toast.error(e.message || "Could not give energy to your miner");
    } finally {
      setMineBusy(false);
    }
  };

  const claimGold = async () => {
    if (mineBusy) return;
    setMineBusy(true);
    try {
      const p = await claimMinedGold(auth());
      setPlayer(p);
      haptic("success");
      toast.success(`Claimed ${formatGold(p.claimedGold)} Gold!`);
    } catch (e: any) {
      toast.error(e.message || "Could not claim your gold");
    } finally {
      setMineBusy(false);
    }
  };

  return (
    <AppShell showProfile>
      <section className="energy-card relative mt-1 overflow-hidden rounded-3xl border p-5 shadow-card">
        <Zap aria-hidden="true" className="pointer-events-none absolute -right-6 -top-4 h-36 w-36 rotate-12 fill-current text-energy opacity-10" />
        <div className="relative flex items-center gap-4">
          <span className="energy-badge flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-energy text-energy-foreground shadow-energy">
            <Zap className="h-9 w-9 fill-current animate-zap" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Your Energy</p>
            <p className="font-display text-5xl leading-none tabular-nums text-energy drop-shadow">{me ? energy.toLocaleString() : "…"}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="rounded-full border bg-background/50 px-2.5 py-1 text-[11px] font-semibold text-energy">+{ENERGY_PER_AD} / ad</span>
            <span className={`rounded-full border bg-background/50 px-2.5 py-1 text-[11px] font-semibold ${dailyClaimed ? "text-success" : "text-primary"}`}>{dailyClaimed ? "Bonus ✓" : "Bonus ready"}</span>
          </div>
        </div>

        <div className="relative mt-4">
          {isLoading ? (
            <div className="h-16 animate-pulse rounded-2xl bg-muted" />
          ) : error ? (
            <div className="flex items-center justify-between gap-3 text-sm text-destructive">
              <p>Could not load energy right now.</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="shrink-0 whitespace-nowrap rounded-full border border-current px-3 py-1.5 font-semibold"
              >
                Try again
              </button>
            </div>
          ) : !dailyClaimed ? (
            <button
              disabled={busy}
              onClick={claimBonus}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gold py-4 font-display text-2xl text-primary-foreground shadow-glow animate-pulse-ring active:scale-95 transition-transform disabled:opacity-70"
            >
              <Gift className="h-6 w-6" />
              {busy ? "Claiming…" : "Claim Daily Bonus"}
            </button>
          ) : (
            <button
              disabled={busy || waitSec > 0}
              onClick={pendingAdSessionId ? checkPendingAd : watchAd}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-coral py-4 font-display text-xl text-accent-foreground shadow-card active:scale-95 transition-transform disabled:opacity-70"
            >
              {waitSec > 0 ? <Timer className="h-6 w-6" /> : <Tv className="h-6 w-6" />}
              {waitSec > 0 ? `Next ad in ${Math.floor(waitSec / 60)}:${String(waitSec % 60).padStart(2, "0")}` : busy ? "Waiting for AdsGram…" : pendingAdSessionId ? "Check AdsGram confirmation" : "Watch Ads to get more Energy"}
            </button>
          )}
        </div>
        <p className="relative mt-2 text-center text-xs text-muted-foreground">
          {dailyClaimed ? `+${ENERGY_PER_AD} Energy for every ad. Next ad unlocks 3 minutes after each one.` : "Claim your free daily bonus, then watch ads for more energy."}
        </p>
      </section>

      <section className="mine-card mt-4 overflow-hidden rounded-[1.8rem] border p-3.5 shadow-card">
        <div className="flex items-center justify-between gap-3 px-1">
          <div>
            <p className="mine-eyebrow">
              <Pickaxe aria-hidden="true" /> THE GOLD VEIN
            </p>
            <h2 className="mt-1 text-2xl leading-none">Mining Area</h2>
          </div>
          <span
            className={`mine-status ${mining ? "is-mining" : "is-ready"}`}
            aria-live="polite"
          >
            <span className="mine-status-dot" />
            {mining ? "Mining now" : "Ready"}
          </span>
        </div>

        <div className="mine-viewport relative mt-3 aspect-[1.7] overflow-hidden rounded-2xl border">
          <GoldMiner mining={mining} />
          <div className="mine-viewport-overlay" aria-hidden="true">
            <span className="mine-location">
              CAVE 01 <span>·</span> GOLD VEIN
            </span>
            <span className="mine-scene-message">
              {mining ? "Pickaxe at work" : "Your next strike awaits"}
            </span>
          </div>
        </div>

        <div className="mine-stats mt-3 grid grid-cols-2 gap-2.5">
          <div className="mine-stat">
            <p className="mine-stat-label">
              <Zap aria-hidden="true" /> MINER FUEL
            </p>
            <p className="mine-stat-value">
              {live.energy.toLocaleString()}
              <span> / {MINE_CAPACITY.toLocaleString()}</span>
            </p>
            <div
              className="mine-progress"
              role="progressbar"
              aria-label="Miner energy"
              aria-valuemin={0}
              aria-valuemax={MINE_CAPACITY}
              aria-valuenow={live.energy}
            >
              <span
                className="mine-energy-fill"
                style={{ width: `${(live.energy / MINE_CAPACITY) * 100}%` }}
              />
            </div>
          </div>
          <div className="mine-stat">
            <p className="mine-stat-label">
              <Hourglass aria-hidden="true" /> {mining ? "NEXT GOLD" : "MINE TIME"}
            </p>
            <p className="mine-stat-value">
              {clock(mining ? nextGoldMs : remainingMs)}
            </p>
            <div
              className="mine-progress"
              role="progressbar"
              aria-label="Mining cycle progress"
              aria-valuemin={0}
              aria-valuemax={MINE_CYCLE_MS}
              aria-valuenow={cycleElapsed}
            >
              <span
                className="mine-gold-fill"
                style={{ width: `${(cycleElapsed / MINE_CYCLE_MS) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <button
          disabled={mineBusy || live.pending < 1}
          onClick={claimGold}
          aria-label={`Claim ${formatGold(live.pending)} gold`}
          className="gold-claim mt-2.5 flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <span className="gold-claim-icon">
            <GoldNugget className="on-gold h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold leading-tight">
              Collect your gold
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Gold mined so far
            </span>
          </span>
          <span className="gold-claim-amount">
            {formatGold(live.pending)}
            <span> GOLD</span>
          </span>
        </button>

        <button
          disabled={mineBusy || !me || energy < ENERGY_PER_GIVE || minerFull}
          onClick={give}
          className="energy-action mt-2.5 flex w-full items-center gap-3 rounded-2xl px-3.5 py-3.5 text-left transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <span className="energy-action-icon">
            <Zap aria-hidden="true" className="h-5 w-5 fill-current" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xl leading-tight">
              {minerFull
                ? "Miner is full"
                : energy < ENERGY_PER_GIVE
                  ? "Not enough Energy"
                  : `Give ${ENERGY_PER_GIVE} Energy`}
            </span>
            <span className="mt-0.5 block text-xs opacity-75">
              {ENERGY_PER_CYCLE} energy powers one gold cycle
            </span>
          </span>
          <span className="energy-action-arrow" aria-hidden="true">
            ›
          </span>
        </button>
        <p className="mine-footnote">
          Your miner finds <strong>0.001 Gold</strong> every 2 minutes
        </p>
      </section>
    </AppShell>
  );
}
