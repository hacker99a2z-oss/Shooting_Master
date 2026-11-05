import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Play, Tv, Trophy, Swords, Timer, Shield, Crosshair, Skull, Gift, Target } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ShooterGame } from "@/components/ShooterGame";
import { SensitivitySettings } from "@/components/SensitivitySettings";
import { usePlayer } from "@/hooks/use-player";
import { startGame, startGameAfterAd, finishGame, startAdPlay, cancelAdPlay, claimDailyBonus } from "@/lib/api.functions";
import { auth, haptic, showRewardAd } from "@/lib/tg";
import { COINS_PER_KILL, MIN_ENEMIES, MAX_ENEMIES, DAILY_GAMES_GOAL, BONUS_MIN_COINS, BONUS_MAX_COINS, coinsToUsd } from "@/lib/rules";
import arenaBg from "@/assets/arena-bg.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Coin Rush — Play & Earn" },
      { name: "description", content: "Take cover, block and shoot the enemy squad. Earn 10 coins for every enemy you take down." },
      { property: "og:title", content: "Coin Rush — Play & Earn" },
      { property: "og:description", content: "Clear 9–12 enemies per battle and earn 10 coins for each one." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function Home() {
  const { data: me, isLoading, error, setPlayer } = usePlayer();
  const [gameId, setGameId] = useState("");
  const [enemyTotal, setEnemyTotal] = useState(9);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState<{ score: number; reward: number; kills: number; pendingVerification?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const adLaunchRef = useRef(false);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(i); }, []);
  const waitSec = me ? Math.max(0, Math.ceil((me.adReadyAt - nowMs) / 1000)) : 0;
  const canPlay = !!me && (me.canPlayFree || (me.extraPlays > 0 && waitSec === 0));

  const beginGame = async () => {
    setBusy(true);
    try {
      const session = await startGame(auth());
      setGameId(session.gameId);
      setEnemyTotal(session.enemyTotal);
      setResult(null);
      haptic("medium");
      setPlaying(true);
    } catch (e: any) { toast.error(e.message || "Unable to start game"); }
    finally { setBusy(false); }
  };

  const onEnd = async (score: number, kills: number) => {
    adLaunchRef.current = false;
    setPlaying(false);
    try {
      const p = await finishGame({ ...auth(), gameId, score, kills });
      setPlayer(p);
      setResult({ score, reward: p.reward, kills, pendingVerification: p.pendingVerification });
      if (p.pendingVerification) toast.info("Game finished. Coins will be added automatically after AdsGram server verification.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const watchAd = async () => {
    if (busy || playing) return;
    setBusy(true);
    let adSessionId = "";
    let adCompleted = false;
    const launchAdGame = async () => {
      if (!adSessionId) throw new Error("The ad session was not created. Please request a new ad.");
      console.info("[AdsGram] requesting game start after completed ad");
      const game = await startGameAfterAd({ ...auth(), adSessionId });
      console.info("[AdsGram] game start accepted", { gameId: game.gameId, enemyTotal: game.enemyTotal });
      adLaunchRef.current = true;
      setGameId(game.gameId);
      setEnemyTotal(game.enemyTotal);
      setResult(null);
      haptic("success");
      setPlaying(true);
      toast.success("Ad completed. Starting your game!");
    };
    try {
      const session = await startAdPlay(auth());
      adSessionId = session.adSessionId;
      let adResult;
      try {
        adResult = await showRewardAd();
      } catch (adError: any) {
        const cancelled = await cancelAdPlay({ ...auth(), adSessionId }).catch(() => null);
        if (cancelled?.verified) {
          await launchAdGame();
          return;
        }
        toast.info((adError?.message || "No ad is available right now.") + " Tap again to request a fresh ad.");
        return;
      }
      if (!adResult.done) {
        const cancelled = await cancelAdPlay({ ...auth(), adSessionId }).catch(() => null);
        if (cancelled?.verified) await launchAdGame();
        else toast.info("The ad was not completed. Tap again to request a fresh ad.");
        return;
      }
      adCompleted = true;
      console.info("[AdsGram] reward ad completed", { state: adResult.state || "unknown" });
      // On Reward blocks, show() only resolves after a full watch. Do not wait for Reward URL.
      // The Worker holds the resulting coins until the separate server callback confirms the ad.
      await launchAdGame();
    } catch (e: any) {
      console.error("[AdsGram] watch-to-game flow failed", {
        adCompleted,
        hasAdSession: Boolean(adSessionId),
        message: e?.message || String(e),
      });
      if (adSessionId && !adCompleted) {
        const cancelled = await cancelAdPlay({ ...auth(), adSessionId }).catch(() => null);
        if (cancelled?.verified) {
          await launchAdGame();
          return;
        }
      }
      toast.error(adCompleted
        ? `Ad completed, but game start failed: ${e?.message || "Unknown server error"}. Tap Play again or reopen the app.`
        : (e?.description || e?.message || "Ad could not be loaded. Please tap again to retry."));
    } finally {
      setBusy(false);
    }
  };

  const claimBonus = async () => {
    setBusy(true);
    try {
      const p = await claimDailyBonus(auth());
      setPlayer(p);
      haptic("success");
      toast.success(`Bonus claimed: $${coinsToUsd(p.bonus).toFixed(3)}!`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const daily = me?.dailyGames ?? 0;

  return (
    <AppShell title="Battle Arena" showProfile action={<SensitivitySettings />}>
      {playing && <ShooterGame onEnd={onEnd} enemyTotal={enemyTotal} />}

      <section className="relative overflow-hidden rounded-3xl border border-primary/30 shadow-card">
        <img src={arenaBg} alt="Military base arena" className="absolute inset-0 h-full w-full object-cover object-top" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/50 to-background" />
        <div className="relative flex min-h-[340px] flex-col justify-end p-5 pb-12">
          <span className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground">
            <span className="h-2 w-2 animate-pulse rounded-full bg-destructive-foreground" /> Enemy squad incoming
          </span>
          <h2 className="text-4xl leading-none drop-shadow">Clear {MIN_ENEMIES}–{MAX_ENEMIES} enemies.<br /><span className="text-gold-gradient">+{COINS_PER_KILL} coins each.</span></h2>
          <p className="mt-2 text-sm text-foreground/80">Hide behind cover, raise your shield and take them down one by one.</p>

          <p className="mt-4 text-center text-xs font-medium text-foreground/90">You can play 1 free game every day. Want to play more? Watch ads to play.</p>
          <div className="mt-2">
            {isLoading ? (
              <div className="h-16 animate-pulse rounded-2xl bg-muted" />
            ) : error ? (
              <p className="text-sm text-destructive">{(error as Error).message}</p>
            ) : canPlay ? (
              <button
                onClick={beginGame}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gold py-4 font-display text-2xl text-primary-foreground shadow-glow animate-pulse-ring active:scale-95 transition-transform"
              >
                <Play className="h-6 w-6 fill-current" />
                {me!.canPlayFree ? "Play (Daily 1 Time)" : `Play (${me!.extraPlays} left)}`}
              </button>
            ) : (
              <button
                disabled={busy || waitSec > 0}
                onClick={watchAd}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-coral py-4 font-display text-xl text-accent-foreground shadow-card active:scale-95 transition-transform disabled:opacity-70"
              >
                {waitSec > 0 ? <Timer className="h-6 w-6" /> : <Tv className="h-6 w-6" />}
                {waitSec > 0 ? `Next ad in ${Math.floor(waitSec / 60)}:${String(waitSec % 60).padStart(2, "0")}` : busy ? "Loading ad…" : "Watch ads to play more"}
              </button>
            )}
          </div>
        </div>
      </section>

      {result && (
        <section className={`mt-4 rounded-3xl border p-5 text-center shadow-card animate-in zoom-in-95 fade-in ${result.reward > 0 ? "border-primary/50 bg-card shadow-glow" : "border-destructive/40 bg-card"}`}>
          {result.reward > 0 ? <Trophy className="mx-auto h-9 w-9 text-primary" /> : <Skull className="mx-auto h-9 w-9 text-destructive" />}
          <p className="mt-1 font-display text-2xl">{result.reward > 0 ? `${result.kills} enemies down!` : "K.O.!"}</p>
          <p className="text-sm text-muted-foreground">Score {result.score}</p>
          {result.pendingVerification ? (
            <p className="mt-2 text-sm text-amber-500">Ad verification pending. Your earned coins will be added after server confirmation.</p>
          ) : (
            <p className={`mt-1 font-display text-3xl ${result.reward > 0 ? "text-gold-gradient" : "text-muted-foreground"}`}>+{result.reward} coins</p>
          )}
          {result.reward === 0 && <p className="mt-1 text-xs text-muted-foreground">Take down enemies to earn {COINS_PER_KILL} coins each.</p>}
        </section>
      )}

      <section className="mt-4 rounded-3xl border bg-card p-4 shadow-card">
        <h3 className="mb-3 text-lg">How to win</h3>
        <ul className="space-y-3 text-sm">
          <Tip icon={<Shield className="h-4 w-4" />} text="Hold the blue shield button and drag to point it any way." />
          <Tip icon={<Crosshair className="h-4 w-4" />} text="Hold the orange button, drag to aim, let go to shoot." />
          <Tip icon={<Target className="h-4 w-4" />} text={`Each battle has ${MIN_ENEMIES}–${MAX_ENEMIES} enemies. +${COINS_PER_KILL} coins for every one you take down.`} />
          <Tip icon={<Timer className="h-4 w-4" />} text="One free game every day. After that, watch ads to play more." />
        </ul>
      </section>
    </AppShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-2xl border bg-card p-3 text-center shadow-card">
      <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-muted">{icon}</div>
      <p className="font-display text-xl tabular-nums">{value.toLocaleString()}</p>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function Tip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">{icon}</span>
      <span className="text-muted-foreground">{text}</span>
    </li>
  );
}
