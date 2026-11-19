import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Gamepad2, LoaderCircle, Play } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { usePlayer } from "@/hooks/use-player";
import { arenaPlayButtonLabel, COINS_PER_ENEMY, DAILY_GAME_GOALS, dailyGamesProgress } from "@/lib/home-rules";
import { COIN_COUNT_DELAY_MS, COIN_COUNT_MS, COIN_GAIN_KEY, countUpValue, type CoinGain } from "@/lib/coin-gain";
import battleArena from "@/assets/battle-arena.jpg";
import { cancelAdPlay, claimDailyGoal, getAdPlayStatus, getMe, grantAdPlay, startAdPlay, startGameAfterAd } from "@/lib/api.functions";
import { auth, showRewardAd, telegramUserPreview } from "@/lib/tg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shooting Master — Your Profile" },
      { name: "description", content: "See your Shooting Master profile, coins, Battle Arena and daily games progress." },
      { property: "og:title", content: "Shooting Master — Your Profile" },
      { property: "og:description", content: "Your player profile, coins and Battle Arena in Shooting Master." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

/** After a match: the profile coins roll up from the old balance to the new one, with a "+N" badge. */
function useCoinGain(coins: number | undefined) {
  const qc = useQueryClient();
  const [gain] = useState(() => qc.getQueryData<CoinGain>(COIN_GAIN_KEY) ?? null);
  const [shown, setShown] = useState<number | null>(gain ? gain.from : null);
  useEffect(() => {
    if (!gain) return;
    qc.removeQueries({ queryKey: COIN_GAIN_KEY });
    let frame = 0;
    let last: number | null = null;
    let elapsed = -COIN_COUNT_DELAY_MS;
    const tick = (now: number) => {
      // Advance at most 100 ms per frame so a busy phone still shows the roll instead of a jump.
      elapsed += last == null ? 0 : Math.min(100, now - last);
      last = now;
      setShown(countUpValue(gain.from, gain.to, elapsed));
      if (elapsed < COIN_COUNT_MS) frame = requestAnimationFrame(tick);
      else setShown(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [gain, qc]);
  return { value: shown ?? coins, gained: gain?.gained ?? 0, counting: shown !== null };
}

function Home() {
  const { data: me, error, dataUpdatedAt } = usePlayer();
  const coinView = useCoinGain(me?.coins);
  const telegramUser = telegramUserPreview();
  const displayName = me?.name ?? telegramUser?.first_name;
  const displayPhoto = me?.photoUrl ?? telegramUser?.photo_url;
  const displayId = me?.tgId ?? telegramUser?.id;
  const initial = (displayName || "?").charAt(0).toUpperCase();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [playBusy, setPlayBusy] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  // Estimate current server time from the last authenticated player response.
  // This remains correct across route changes and a closed/reopened Telegram app.
  const estimatedServerNow = me
    ? me.serverNow + Math.max(0, clockNow - (dataUpdatedAt || clockNow))
    : clockNow;
  const adCooldownSeconds = me && !me.canPlayFree
    ? Math.max(0, Math.ceil((me.adReadyAt - estimatedServerNow) / 1_000))
    : 0;
  const [claiming, setClaiming] = useState<number | null>(null);
  const [claimError, setClaimError] = useState("");
  const goals = DAILY_GAME_GOALS.map((g) => ({
    ...dailyGamesProgress(me?.dailyGames ?? 0, g.target, me?.claimedGoals?.includes(g.target) ?? false),
    rewardUsd: g.rewardUsd,
  }));
  const playArena = async () => {
    if (playBusy) return;
    setPlayBusy(true);
    let adSessionId = "";
    let adIsShowing = false;
    let exitCancelSent = false;
    const cancelIfAppCloses = () => {
      if (!adSessionId || !adIsShowing || exitCancelSent) return;
      exitCancelSent = true;
      void cancelAdPlay({ ...auth(), adSessionId }).catch(() => undefined);
    };
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    try {
      const credentials = auth();
      if (!credentials.initData) {
        await navigate({ to: "/play" });
        return;
      }

      // Read authoritative daily play state from the backend before choosing free vs rewarded.
      const latest = await getMe(credentials);
      qc.setQueryData(["me"], latest);
      if (latest.canPlayFree) {
        await navigate({ to: "/play" });
        return;
      }

      const ad = await startAdPlay(credentials);
      adSessionId = ad.adSessionId;

      if (!ad.alreadyVerified && !ad.waitingVerification) {
        window.addEventListener("pagehide", cancelIfAppCloses);
        window.addEventListener("beforeunload", cancelIfAppCloses);
        adIsShowing = true;
        let result;
        try {
          result = await showRewardAd();
        } finally {
          adIsShowing = false;
          window.removeEventListener("pagehide", cancelIfAppCloses);
          window.removeEventListener("beforeunload", cancelIfAppCloses);
        }
        if (!result.done || result.error) {
          throw new Error(result.description || "Please watch the full ad to unlock the game.");
        }

        // Client completion only changes the session to awaiting_postback.
        // Only AdsGram's Reward URL callback can mark it rewarded.
        await grantAdPlay({ ...credentials, adSessionId }).catch(() => undefined);
      } else if (ad.waitingVerification) {
      } else {
      }

      const deadline = Date.now() + 90_000;
      let verified = Boolean(ad.alreadyVerified);
      while (!verified && Date.now() < deadline) {
        try {
          const status = await getAdPlayStatus({ ...credentials, adSessionId });
          if (status.verified) {
            verified = true;
            break;
          }
          if (status.cancelled || status.expired) {
            throw new Error("This ad session ended without AdsGram server verification. Tap Watch Ads to Play to start a new attempt.");
          }
        } catch (reason) {
          if (reason instanceof Error && /ended without AdsGram server verification/.test(reason.message)) throw reason;
          // A transient API/network failure must not cancel a fully watched ad.
        }
        await wait(1_200);
      }

      if (!verified) {
        // Keep the postback session alive for the documented server callback. A later tap
        // resumes verification rather than starting another ad or cancelling a full view.
        adSessionId = "";
        toast.info("Ad completed. Waiting for AdsGram server confirmation; tap Watch Ads to Play again to check.");
        return;
      }

      const game = await startGameAfterAd({ ...credentials, adSessionId });
      qc.setQueryData(["pending-arena-session"], game);
      await qc.invalidateQueries({ queryKey: ["me"] });
      adSessionId = "";
      await navigate({ to: "/play" });
    } catch (reason) {
      if (adSessionId) await cancelAdPlay({ ...auth(), adSessionId }).catch(() => undefined);
      toast.error(reason instanceof Error ? reason.message : "Could not start the game.");
    } finally {
      adIsShowing = false;
      window.removeEventListener("pagehide", cancelIfAppCloses);
      window.removeEventListener("beforeunload", cancelIfAppCloses);
      setPlayBusy(false);
    }
  };

  const claim = async (target: number) => {
    setClaiming(target);
    setClaimError("");
    try {
      const p = await claimDailyGoal({ ...auth(), target });
      qc.setQueryData(["me"], p);
      toast.success("$" + (p.balanceRewardCents / 100).toFixed(2) + " added to Withdraw Balance.");
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setClaiming(null);
    }
  };

  // Defer the 3D engine/model preload until after the profile UI has painted.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void import("@/components/battle/preload")
        .then(({ preloadBattle }) => { if (!cancelled) preloadBattle(); })
        .catch(() => {});
    }, 1_200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <AppShell>
      <section className="profile-card" aria-label="Player profile">
        <div className="profile-card-left">
          {displayPhoto ? (
            <img src={displayPhoto} alt={displayName || "Player"} className="profile-avatar" />
          ) : (
            <div className="profile-avatar profile-avatar-fallback">{initial}</div>
          )}
          <div className="min-w-0">
            <p className="profile-name">{displayName ?? "Loading…"}</p>
            <p className="profile-id">ID: {displayId ?? "…"}</p>
          </div>
        </div>
        <div className="profile-coins" data-counting={coinView.counting ? "true" : undefined}>
          <p className="hud-label">Coins</p>
          <p className="profile-coins-value" aria-live="polite">
            <span className="coin-dot" />
            <span className="text-gold-gradient">{coinView.value != null ? coinView.value.toLocaleString() : "…"}</span>
          </p>
          {coinView.gained > 0 && (
            <span className="profile-coins-gain" aria-hidden="true">
              +{coinView.gained.toLocaleString()}
            </span>
          )}
        </div>
      </section>

      <h2 className="home-section-title">Battle Arena</h2>

      <section className="arena-card" aria-label="Battle Arena">
        <img src={battleArena} alt="Battle Arena: the hooded archer facing skeleton enemies on the 3D map" className="arena-card-image" />
        <div className="arena-card-shade" aria-hidden="true" />
        <div className="arena-card-copy">
          <p className="arena-card-heading">Kill all the enemies</p>
          <p className="arena-card-reward">
            <span className="coin-dot" />
            <span>
              Earn <strong>{COINS_PER_ENEMY} coins</strong> for every enemy you kill
            </span>
          </p>
        </div>
        <button
          type="button"
          className="arena-play-button"
          onClick={() => void playArena()}
          disabled={playBusy || !me || (!me.canPlayFree && adCooldownSeconds > 0)}
          aria-live="polite"
        >
          {playBusy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" fill="currentColor" />}
          <span>{arenaPlayButtonLabel(Boolean(me?.canPlayFree), adCooldownSeconds)}</span>
        </button>
      </section>

      <div className="home-stats-row">
        <section className="home-stat-card home-games-card" aria-label="Games played">
          <p className="home-stat-title">
            <Gamepad2 className="h-4 w-4" />
            Games
          </p>
          <p className="home-games-count">{me ? me.dailyGames.toLocaleString() : "…"}</p>
        </section>

        {goals.map((goal) => (
          <section key={goal.target} className="home-stat-card home-daily-card" aria-label={`Daily Games: ${goal.target} games`}>
            <p className="home-stat-title">Daily Games</p>
            <div className="home-daily-progress">
              <div
                className="home-daily-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={goal.target}
                aria-valuenow={goal.played}
                aria-label={`Daily games progress toward ${goal.target}`}
              >
                <span style={{ width: `${goal.percent}%` }} />
              </div>
              <span className="home-daily-count">
                {goal.played}/{goal.target}
              </span>
            </div>
            <button
              type="button"
              className="home-claim-button"
              disabled={!goal.canClaim || claiming !== null}
              onClick={() => void claim(goal.target)}
            >
              {goal.claimed ? "Claimed" : claiming === goal.target ? "Claiming…" : `Claim ${goal.rewardUsd} $`}
            </button>
          </section>
        ))}
      </div>

      <h2 className="home-section-title">How To Play</h2>

      {claimError && <p className="hud-panel p-3 text-center text-sm text-muted-foreground">{claimError}</p>}
      {error && <p className="hud-panel p-3 text-center text-sm text-muted-foreground">{(error as Error).message}</p>}
    </AppShell>
  );
}
