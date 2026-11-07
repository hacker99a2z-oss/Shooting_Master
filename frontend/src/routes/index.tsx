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
  const { data: me, isLoading, error, setPlayer, dataUpdatedAt } = usePlayer();
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
            <p className="text-sm text-destructive">{(error as Error).message}</p>
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

      <section className="mt-4 rounded-3xl border bg-card p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl">Your Mining Area</h2>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${mining ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"}`}>
            <span className={`h-2 w-2 rounded-full ${mining ? "animate-pulse bg-success" : "bg-muted-foreground"}`} />
            {mining ? "Mining" : "Resting"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_7.5rem] gap-2.5">
          <div className="relative min-h-[13.5rem] overflow-hidden rounded-2xl border shadow-card">
            <GoldMiner mining={mining} />
          </div>

          <div className="flex flex-col justify-between gap-2 rounded-2xl border bg-secondary p-2.5 text-center">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Miner Energy</p>
              <p className="mt-0.5 flex items-center justify-center gap-1 font-display text-lg leading-none tabular-nums">
                <Zap className="h-4 w-4 fill-current text-energy" />{live.energy}/{MINE_CAPACITY}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-energy transition-all" style={{ width: `${(live.energy / MINE_CAPACITY) * 100}%` }} />
              </div>
            </div>
            <div>
              <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Hourglass className="h-3 w-3" />Time left</p>
              <p className="font-display text-lg leading-tight tabular-nums">{clock(remainingMs)}</p>
              <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground"><Pickaxe className="h-3 w-3" />{mining ? `+0.001 in ${clock(nextGoldMs)}` : "Not mining"}</p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-gold" style={{ width: `${(cycleElapsed / MINE_CYCLE_MS) * 100}%` }} />
              </div>
            </div>
            <button
              disabled={mineBusy || live.pending < 1}
              onClick={claimGold}
              aria-label={`Claim ${formatGold(live.pending)} gold`}
              className="flex w-full items-center justify-center gap-1 rounded-xl bg-gold py-2.5 font-display text-lg tabular-nums text-primary-foreground shadow-glow active:scale-95 transition-transform disabled:opacity-60"
            >
              <GoldNugget className="on-gold h-4 w-4" />
              {formatGold(live.pending)}
            </button>
          </div>
        </div>

        <button
          disabled={mineBusy || !me || energy < ENERGY_PER_GIVE || minerFull}
          onClick={give}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-energy py-3.5 font-display text-xl text-energy-foreground shadow-energy active:scale-95 transition-transform disabled:opacity-60"
        >
          <Zap className="h-5 w-5 fill-current" />
          {minerFull ? "Miner is full" : energy < ENERGY_PER_GIVE ? "Not enough Energy" : `Give ${ENERGY_PER_GIVE} Energy`}
        </button>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">{ENERGY_PER_CYCLE} Energy = 0.001 Gold every 2 minutes</p>
      </section>
    </AppShell>
  );
}
