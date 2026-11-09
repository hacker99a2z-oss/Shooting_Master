import { Link } from "@tanstack/react-router";
import { Home, Trophy, Users, Wallet } from "lucide-react";
import type { ReactNode } from "react";

const tabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/refer", label: "Refer", icon: Users },
  { to: "/withdraw", label: "Wallet", icon: Wallet },
] as const;

export function AppShell({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="app-column mine-app-shell mx-auto flex min-h-dvh max-w-md flex-col text-foreground">
      <header className="mine-header px-4 pt-3">
        {(title || action) && (
          <div className="flex items-center justify-between gap-3">
            {title && <h1 className="text-2xl font-semibold text-foreground">{title}</h1>}
            {action}
          </div>
        )}
      </header>

      <main className="mine-main flex-1 px-4 pb-[calc(7.6rem+env(safe-area-inset-bottom))] pt-4 text-foreground">
        {children}
      </main>

      <nav className="mine-bottom-nav fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-3 pb-[calc(0.65rem+env(safe-area-inset-bottom))]" aria-label="Main navigation">
        <div className="mine-bottom-nav-inner grid grid-cols-4">
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
