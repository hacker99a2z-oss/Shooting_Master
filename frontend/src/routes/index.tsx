import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { GoldMiner } from "@/components/GoldMiner";
import { usePlayer } from "@/hooks/use-player";
import { startAdPlay, grantAdPlay, getAdPlayStatus, cancelAdPlay, claimDailyEnergy, giveMinerEnergy, claimMinedGold, type AdPlayStatus } from "@/lib/api.functions";
import { auth, haptic, showRewardAd } from "@/lib/tg";
import { ENERGY_PER_AD, ENERGY_PER_GIVE, ENERGY_PER_CYCLE, MINE_CAPACITY, MINE_CYCLE_MS, MILLI_GOLD_PER_CYCLE, formatGold, mineRemainingMs, settleMine } from "@/lib/mining";

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
      <section className="reference-energy-layer" aria-label="Energy balance">
        <div className="reference-energy-readout" aria-live="polite">
          {me ? `${energy.toLocaleString()} / ${MINE_CAPACITY.toLocaleString()}` : "…"}
        </div>
        <div
          className="reference-energy-bar-fill"
          style={{ width: `${Math.min(100, Math.max(0, (energy / MINE_CAPACITY) * 100)) * 0.42}%` }}
        />
        <button
          type="button"
          className="reference-energy-plus-hit"
          aria-label={`Give ${ENERGY_PER_GIVE} energy to miner`}
          disabled={mineBusy || !me || energy < ENERGY_PER_GIVE || minerFull}
          onClick={give}
        />
        <button
          type="button"
          className="reference-get-energy-hit"
          aria-label="Get energy"
          disabled={isLoading || busy || (dailyClaimed && waitSec > 0 && !pendingAdSessionId)}
          onClick={() => {
            if (!dailyClaimed) void claimBonus();
            else if (pendingAdSessionId) void checkPendingAd();
            else void watchAd();
          }}
        >
          <span className="sr-only">
            {busy ? "Please wait" : waitSec > 0 && dailyClaimed && !pendingAdSessionId
              ? clock(waitSec * 1000)
              : pendingAdSessionId ? "Verify ad reward" : "Get Energy"}
          </span>
        </button>
        {(busy || pendingAdSessionId || (dailyClaimed && waitSec > 0)) && (
          <div className="reference-energy-action-state">
            {busy ? "Please wait…" : pendingAdSessionId ? "Verify" : clock(waitSec * 1000)}
          </div>
        )}
        <div className="sr-only">
          {error ? (error as Error).message : !dailyClaimed
            ? "Your free daily energy bonus is ready to collect."
            : pendingAdSessionId
              ? "Your watched ad is waiting for secure confirmation."
              : "Watch a rewarded ad to collect more energy."}
        </div>
      </section>

      <section className="reference-mining-layer" aria-label="Your Mining Area">
        <div id="mining-area" className="reference-mining-anchor" />
        <GoldMiner mining={mining} />
      </section>

      <section className="reference-stats-layer" aria-label="Mining statistics">
        <div className="reference-stat-energy">{live.energy.toLocaleString()} / {MINE_CAPACITY.toLocaleString()}</div>
        <div className="reference-stat-time">{mining ? clock(nextGoldMs) : "2 min"}</div>
        <div className="reference-stat-gold">{formatGold(MILLI_GOLD_PER_CYCLE)}</div>
      </section>

      <button
        type="button"
        className="reference-claim-hit"
        disabled={mineBusy || live.pending < 1}
        onClick={claimGold}
        aria-label={`Claim ${formatGold(live.pending)} gold`}
      >
        <span className="reference-claim-state">
          {mineBusy ? "Collecting…" : live.pending > 0 ? `${formatGold(live.pending)} GOLD READY` : ""}
        </span>
      </button>
    </AppShell>
  );
}
