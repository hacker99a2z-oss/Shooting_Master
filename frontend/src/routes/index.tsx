import { createFileRoute } from "@tanstack/react-router";
import { Gamepad2, Play } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { usePlayer } from "@/hooks/use-player";
import { COINS_PER_ENEMY, DAILY_GAMES_REWARD_USD, dailyGamesProgress } from "@/lib/home-rules";
import battleArena from "@/assets/battle-arena.jpg";

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

function Home() {
  const { data: me, error } = usePlayer();
  const initial = (me?.name || "?").charAt(0).toUpperCase();
  const daily = dailyGamesProgress(me?.dailyGames ?? 0);

  return (
    <AppShell>
      <section className="profile-card" aria-label="Player profile">
        <div className="profile-card-left">
          {me?.photoUrl ? (
            <img src={me.photoUrl} alt={me.name} className="profile-avatar" />
          ) : (
            <div className="profile-avatar profile-avatar-fallback">{initial}</div>
          )}
          <div className="min-w-0">
            <p className="profile-name">{me?.name ?? "Loading…"}</p>
            <p className="profile-id">ID: {me?.tgId ?? "…"}</p>
          </div>
        </div>
        <div className="profile-coins">
          <p className="hud-label">Coins</p>
          <p className="profile-coins-value">
            <span className="coin-dot" />
            <span className="text-gold-gradient">{me ? me.coins.toLocaleString() : "…"}</span>
          </p>
        </div>
      </section>

      <h2 className="home-section-title">Battle Arena</h2>

      <section className="arena-card" aria-label="Battle Arena">
        <img src={battleArena} alt="Battle Arena: hero aiming at red enemy soldiers" className="arena-card-image" />
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
        <button type="button" className="arena-play-button">
          <Play className="h-5 w-5" fill="currentColor" />
          <span>Play</span>
        </button>
      </section>

      <div className="home-stats-row">
        <section className="home-stat-card home-games-card" aria-label="Games played">
          <p className="home-stat-title">
            <Gamepad2 className="h-4 w-4" />
            Games
          </p>
          <p className="home-games-count">{me ? me.gamesPlayed.toLocaleString() : "…"}</p>
        </section>

        <section className="home-stat-card home-daily-card" aria-label="Daily Games">
          <p className="home-stat-title">Daily Games</p>
          <div className="home-daily-progress">
            <div
              className="home-daily-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={daily.target}
              aria-valuenow={daily.played}
              aria-label="Daily games progress"
            >
              <span style={{ width: `${daily.percent}%` }} />
            </div>
            <span className="home-daily-count">
              {daily.played}/{daily.target}
            </span>
          </div>
          <button type="button" className="home-claim-button" disabled={!daily.canClaim}>
            Claim {DAILY_GAMES_REWARD_USD} $
          </button>
        </section>
      </div>

      <h2 className="home-section-title">How To Play</h2>

      {error && <p className="hud-panel p-3 text-center text-sm text-muted-foreground">{(error as Error).message}</p>}
    </AppShell>
  );
}
