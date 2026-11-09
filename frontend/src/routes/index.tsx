import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { usePlayer } from "@/hooks/use-player";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shooting Master — Your Profile" },
      { name: "description", content: "See your Shooting Master profile, player ID and coin balance." },
      { property: "og:title", content: "Shooting Master — Your Profile" },
      { property: "og:description", content: "Your player profile and coin balance in Shooting Master." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function Home() {
  const { data: me, error } = usePlayer();
  const initial = (me?.name || "?").charAt(0).toUpperCase();

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
      {error && <p className="hud-panel p-3 text-center text-sm text-muted-foreground">{(error as Error).message}</p>}
    </AppShell>
  );
}
