import { Link } from "@tanstack/react-router";
import { Home, Pickaxe, Trophy, Users, Wallet, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { usePlayer } from "@/hooks/use-player";
import { formatGold } from "@/lib/mining";
import { GoldNugget } from "@/components/GoldNugget";

const tabs = [
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/refer", label: "Refer", icon: Users },
  { to: "/withdraw", label: "Wallet", icon: Wallet },
] as const;

export function AppShell({ title, children, showProfile = false, action }: { title?: string; children: ReactNode; showProfile?: boolean; action?: ReactNode }) {
  const { data } = usePlayer();
  const initial = (data?.name || "?").charAt(0).toUpperCase();
  return (
    <div className="app-column mine-app-shell mx-auto flex min-h-dvh max-w-md flex-col text-foreground">
      <header className="mine-header px-4 pt-3">
        {showProfile && (
          <div className="profile-wood-card">
            {data?.photoUrl ? (
              <img src={data.photoUrl} alt={data.name} className="profile-wood-avatar" />
            ) : (
              <div className="profile-wood-avatar profile-avatar-fallback">{initial}</div>
            )}
            <div className="profile-player-meta">
              <p className="profile-player-name">{data?.name ?? "Loading…"}</p>
              <p className="profile-player-id">ID: {data?.tgId ?? "…"}</p>
            </div>
            <div className="profile-gold-balance">
              <span className="profile-gold-caption">GOLD BALANCE</span>
              <span className="profile-gold-amount"><GoldNugget />{data ? formatGold(data.gold ?? 0) : "…"}</span>
            </div>
            <Link to="/withdraw" className="profile-add-gold" aria-label="Open wallet">
              <Plus className="h-5 w-5" />
            </Link>
          </div>
        )}
        {(title || action) && (
          <div className={`flex items-center justify-between gap-3 ${showProfile ? "mt-4" : ""}`}>
            {title && <h1 className="text-2xl font-semibold text-foreground">{title}</h1>}
            {action}
          </div>
        )}
      </header>
      <main className="mine-main flex-1 px-4 pb-[calc(7.6rem+env(safe-area-inset-bottom))] pt-4 text-foreground">{children}</main>
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
    </div>
  );
}
