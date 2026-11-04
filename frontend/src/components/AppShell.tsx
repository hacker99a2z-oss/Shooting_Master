import { Link } from "@tanstack/react-router";
import { Gamepad2, Trophy, Users, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { usePlayer } from "@/hooks/use-player";

const tabs = [
  { to: "/", label: "Play", icon: Gamepad2 },
  { to: "/leaderboard", label: "Top", icon: Trophy },
  { to: "/refer", label: "Refer", icon: Users },
  { to: "/withdraw", label: "Wallet", icon: Wallet },
] as const;

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const { data } = usePlayer();
  const initial = (data?.name || "?").charAt(0).toUpperCase();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="px-5 pt-5">
        <div className="flex items-center gap-3 rounded-3xl border bg-card p-3 shadow-card">
          {data?.photoUrl ? (
            <img src={data.photoUrl} alt={data.name} className="h-12 w-12 rounded-full border-2 border-primary object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-coral font-display text-xl text-accent-foreground">{initial}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg leading-tight">{data?.name ?? "…"}</p>
            <p className="truncate text-xs text-muted-foreground">ID: {data?.tgId ?? "…"}</p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5">
            <span className="inline-block h-5 w-5 rounded-full bg-gold shadow-glow" />
            <span className="font-display text-lg tabular-nums">{data ? data.coins.toLocaleString() : "…"}</span>
          </div>
        </div>
        <h1 className="mt-4 text-2xl">{title}</h1>
      </header>
      <main className="flex-1 px-5 pb-28 pt-3">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-4 pb-4">
        <div className="grid grid-cols-4 rounded-2xl border bg-card/90 p-1.5 shadow-card backdrop-blur">
          {tabs.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: true }}
              className="flex flex-col items-center gap-0.5 rounded-xl py-2 text-xs text-muted-foreground transition-colors data-[status=active]:bg-gold data-[status=active]:text-primary-foreground"
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
