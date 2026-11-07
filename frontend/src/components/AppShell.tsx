import { Link } from "@tanstack/react-router";
import { Home, Pickaxe, Trophy, Users, Wallet } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import goldMiningReference from "@/assets/gold-mining-reference.webp";
import { usePlayer } from "@/hooks/use-player";
import { formatGold } from "@/lib/mining";

const tabs = [
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/refer", label: "Refer", icon: Users },
  { to: "/withdraw", label: "Wallet", icon: Wallet },
] as const;

export function AppShell({ title, children, showProfile = false, action }: { title?: string; children: ReactNode; showProfile?: boolean; action?: ReactNode }) {
  const { data } = usePlayer();
  const initial = (data?.name || "?").charAt(0).toUpperCase();
  const referenceStyle = showProfile
    ? ({ "--reference-art": `url("${goldMiningReference}")` } as CSSProperties)
    : undefined;

  return (
    <div
      className={showProfile
        ? "reference-home-shell mx-auto text-foreground"
        : "app-column mine-app-shell mx-auto flex min-h-dvh max-w-md flex-col text-foreground"}
      style={referenceStyle}
    >
      {showProfile ? (
        <header className="reference-profile-layer" aria-label="Player profile">
          {data?.photoUrl ? (
            <img src={data.photoUrl} alt={data.name} className="reference-profile-avatar" />
          ) : (
            <div className="reference-profile-avatar reference-profile-fallback">{initial}</div>
          )}
          <div className="reference-player-name">{data?.name ?? "Loading…"}</div>
          <div className="reference-player-id">ID: {data?.tgId ?? "…"}</div>
          <div className="reference-player-gold">
            {data ? formatGold(data.gold ?? 0) : "…"}
          </div>
          <Link to="/withdraw" className="reference-profile-wallet-hit" aria-label="Open wallet" />
        </header>
      ) : (
        <header className="mine-header px-4 pt-3">
          {(title || action) && (
            <div className="flex items-center justify-between gap-3">
              {title && <h1 className="text-2xl font-semibold text-foreground">{title}</h1>}
              {action}
            </div>
          )}
        </header>
      )}

      <main className={showProfile
        ? "reference-home-main"
        : "mine-main flex-1 px-4 pb-[calc(7.6rem+env(safe-area-inset-bottom))] pt-4 text-foreground"}
      >
        {children}
      </main>

      {showProfile ? (
        <nav className="reference-home-nav" aria-label="Main navigation">
          <Link to="/" activeOptions={{ exact: true }} className="reference-nav-hit" aria-label="Home" />
          <Link to="/refer" className="reference-nav-hit" aria-label="Upgrade" />
          <Link to="/" hash="mining-area" className="reference-nav-hit" aria-label="Mine" />
          <Link to="/leaderboard" className="reference-nav-hit" aria-label="Leaderboard" />
          <Link to="/withdraw" className="reference-nav-hit" aria-label="Wallet" />
        </nav>
      ) : (
        <nav className="mine-bottom-nav fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-3 pb-[calc(0.65rem+env(safe-area-inset-bottom))]" aria-label="Main navigation">
          <div className="mine-bottom-nav-inner grid grid-cols-5">
            <Link to="/" activeOptions={{ exact: true }} className="mine-nav-item">
              <Home className="h-5 w-5" />
              <span>Home</span>
            </Link>
            <Link to="/" hash="mining-area" className="mine-nav-item">
              <Pickaxe className="h-5 w-5" />
              <span>Mine</span>
            </Link>
            {tabs.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} activeOptions={{ exact: true }} className="mine-nav-item">
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
