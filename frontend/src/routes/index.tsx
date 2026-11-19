import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Gamepad2, Play } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { usePlayer } from "@/hooks/use-player";
import { COINS_PER_ENEMY, DAILY_GAME_GOALS, dailyGamesProgress } from "@/lib/home-rules";
import { COIN_COUNT_DELAY_MS, COIN_COUNT_MS, COIN_GAIN_KEY, countUpValue, type CoinGain } from "@/lib/coin-gain";
import battleArena from "@/assets/battle-arena.jpg";
import { claimDailyGoal } from "@/lib/api.functions";
import { auth, telegramUserPreview } from "@/lib/tg";

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
  const { data: me, error } = usePlayer();
  const coinView = useCoinGain(me?.coins);
  const telegramUser = telegramUserPreview();
  const displayName = me?.name ?? telegramUser?.first_name;
  const displayPhoto = me?.photoUrl ?? telegramUser?.photo_url;
  const displayId = me?.tgId ?? telegramUser?.id;
  const initial = (displayName || "?").charAt(0).toUpperCase();
  const qc = useQueryClient();
  const [claiming, setClaiming] = useState<number | null>(null);
  const [claimError, setClaimError] = useState("");
  const goals = DAILY_GAME_GOALS.map((g) => ({
    ...dailyGamesProgress(me?.dailyGames ?? 0, g.target, me?.claimedGoals?.includes(g.target) ?? false),
    rewardUsd: g.rewardUsd,
  }));
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
        <Link to="/play" className="arena-play-button">
          <Play className="h-5 w-5" fill="currentColor" />
          <span>Play</span>
        </Link>
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
