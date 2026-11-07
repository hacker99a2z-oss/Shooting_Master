import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gift, Tv, Timer, Zap, Pickaxe, Hourglass, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GoldMiner } from "@/components/GoldMiner";
import { GoldNugget } from "@/components/GoldNugget";
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
      <section className="energy-dock" aria-label="Energy balance">
        <div className="energy-dock-icon">
          <Zap className="h-7 w-7 fill-current" />
        </div>
        <div className="energy-meter">
          <div className="energy-meter-heading">
            <span>Energy</span>
            <span className="energy-meter-bonus">{dailyClaimed ? \`+\${ENERGY_PER_AD} per ad\` : \`+\${ENERGY_PER_GIVE} daily bonus\`}</span>
          </div>
          <div className="energy-meter-value">
            <strong>{me ? energy.toLocaleString() : "…"}</strong>
            <span>AVAILABLE</span>
          </div>
          <div className="energy-track" aria-label={\`\${energy} available energy\`}>
            <span style={{ width: \`\${Math.min(100, Math.max(0, (energy / MINE_CAPACITY) * 100))}%\` }} />
          </div>
        </div>
        <button
          type="button"
          className="get-energy-button"
          disabled={isLoading || busy || (dailyClaimed && waitSec > 0 && !pendingAdSessionId)}
          onClick={() => {
            if (!dailyClaimed) void claimBonus();
            else if (pendingAdSessionId) void checkPendingAd();
            else void watchAd();
          }}
        >
          {waitSec > 0 && dailyClaimed && !pendingAdSessionId ? <Timer className="h-5 w-5" /> : dailyClaimed ? <Tv className="h-5 w-5" /> : <Gift className="h-5 w-5" />}
          <span>{busy ? "Please wait…" : waitSec > 0 && dailyClaimed && !pendingAdSessionId ? clock(waitSec * 1000) : pendingAdSessionId ? "Verify" : "Get Energy"}</span>
        </button>
        <p className="energy-dock-footnote">
          {error ? (error as Error).message : !dailyClaimed ? "Your free daily energy bonus is ready to collect." : pendingAdSessionId ? "Your watched ad is waiting for secure confirmation." : "Watch a rewarded ad to collect more energy."}
        </p>
      </section>

      <section id="mining-area" className="mining-home" aria-label="Your gold mining area">
        <div className="mine-title-plaque">
          <Pickaxe className="h-6 w-6" />
          <h2>Your Mining Area</h2>
          <Pickaxe className="h-6 w-6 scale-x-[-1]" />
        </div>

        <div className="mine-stage">
          <GoldMiner mining={mining} />
          <div className={\`mine-status-pill \${mining ? "active" : ""}\`}>
            <span />
            {mining ? "MINER WORKING" : "MINER RESTING"}
          </div>
          <div className="mine-stage-caption">
            <strong>GOLD MINE</strong>
            <span>{mining ? "Keep mining to collect gold!" : "Fuel your miner to start digging"}</span>
          </div>
        </div>

        <div className="mine-stats-grid">
          <div className="mine-stat-card miner-energy-stat">
            <span className="mine-stat-label"><Zap className="h-3.5 w-3.5 fill-current" /> Miner Energy</span>
            <div className="mine-stat-main">
              <strong>{live.energy.toLocaleString()}<small>/{MINE_CAPACITY.toLocaleString()}</small></strong>
              <button
                type="button"
                className="miner-refuel-button"
                aria-label={\`Give \${ENERGY_PER_GIVE} energy to miner\`}
                title={\`Give \${ENERGY_PER_GIVE} energy\`}
                disabled={mineBusy || !me || energy < ENERGY_PER_GIVE || minerFull}
                onClick={give}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="miner-energy-track">
              <span style={{ width: \`\${Math.min(100, (live.energy / MINE_CAPACITY) * 100)}%\` }} />
            </div>
            <span className="mine-stat-hint">{minerFull ? "Miner is full" : energy < ENERGY_PER_GIVE ? "Get energy to refill" : \`+ \${ENERGY_PER_GIVE} energy to mine\`}</span>
          </div>

          <div className="mine-stat-card">
            <span className="mine-stat-label"><Hourglass className="h-3.5 w-3.5" /> Next Gold</span>
            <strong className="mine-stat-value">{mining ? clock(nextGoldMs) : "2:00"}</strong>
            <span className="mine-stat-hint">{ENERGY_PER_CYCLE} energy / cycle</span>
            <div className="mine-cycle-track">
              <span style={{ width: \`\${(cycleElapsed / MINE_CYCLE_MS) * 100}%\` }} />
            </div>
          </div>

          <div className="mine-stat-card">
            <span className="mine-stat-label"><Pickaxe className="h-3.5 w-3.5" /> Gold Reward</span>
            <strong className="mine-stat-value">{formatGold(MILLI_GOLD_PER_CYCLE)}</strong>
            <span className="mine-stat-hint">Gold per cycle</span>
            <span className="mine-stat-runway">{mining ? \`Run time \${clock(remainingMs)}\` : "2 min per 10 energy"}</span>
          </div>
        </div>

        <button
          type="button"
          disabled={mineBusy || live.pending < 1}
          onClick={claimGold}
          aria-label={\`Claim \${formatGold(live.pending)} gold\`}
          className="claim-gold-button"
        >
          <span className="claim-gold-coins"><GoldNugget /><GoldNugget /><GoldNugget /></span>
          <span className="claim-gold-copy">
            <strong>{mineBusy ? "Collecting…" : "Claim Gold"}</strong>
            <small>{formatGold(live.pending)} GOLD READY</small>
          </span>
          <span className="claim-gold-arrow">›</span>
        </button>
        <p className="mine-rules-note">{ENERGY_PER_CYCLE} Energy = {formatGold(MILLI_GOLD_PER_CYCLE)} Gold every 2 minutes. Your gold is verified and credited by the server.</p>
      </section>
    </AppShell>
  );
}
