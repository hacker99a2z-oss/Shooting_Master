import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Crown, Clock, Info } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getLeaderboard } from "@/lib/api.functions";
import { auth } from "@/lib/tg";
import { LEADERBOARD_MIN_COINS, PRIZE_POOL_USD, PRIZE_WINNERS } from "@/lib/rules";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — Coin Rush" },
      { name: "description", content: "Top 30 players share a $10 prize pool every 2 days." },
      { property: "og:title", content: "Leaderboard — Coin Rush" },
      { property: "og:description", content: "Top 30 players share a $10 prize pool every 2 days." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Leaderboard,
});

function useCountdown(to?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!to) return { h: "--", m: "--", s: "--" };
  const s = Math.max(0, Math.floor((to - now) / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return { h: p(Math.floor(s / 3600)), m: p(Math.floor((s % 3600) / 60)), s: p(s % 60) };
}

type Row = { rank: number; tgId: number; name: string; coins: number; prize: number; isMe: boolean };

function Leaderboard() {
  const { data, isLoading } = useQuery({ queryKey: ["leaderboard"], queryFn: () => getLeaderboard(auth()), refetchInterval: 30_000 });
  const left = useCountdown(data?.seasonEndsAt);
  const list = (data?.list ?? []) as Row[];
  const podium = [list[1], list[0], list[2]];
  const rest = list.slice(3);

  return (
    <AppShell title="Leaderboard">
      <section className="relative overflow-hidden rounded-3xl border border-primary/30 bg-card p-5 shadow-card">
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gold opacity-25 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Prize pool</p>
            <p className="font-display text-5xl text-gold-gradient">${PRIZE_POOL_USD}</p>
            <p className="text-xs text-muted-foreground">shared by top {PRIZE_WINNERS}</p>
          </div>
          <Crown className="h-16 w-16 text-primary drop-shadow animate-float" />
        </div>
        <div className="relative mt-4">
          <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> Round ends in</p>
          <div className="grid grid-cols-3 gap-2">
            {[["h", left.h], ["m", left.m], ["s", left.s]].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-muted py-2 text-center">
                <span className="font-display text-2xl tabular-nums">{v}</span>
                <span className="ml-1 text-xs text-muted-foreground">{k}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-secondary py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 text-primary" /> Play at least <b className="text-foreground">1 game</b> to join this round
          </p>
        </div>
      </section>

      {list.length > 0 && (
        <section className="mt-5 grid grid-cols-3 items-end gap-2">
          {podium.map((r, i) => {
            if (!r) return <div key={i} />;
            const tall = r.rank === 1 ? "h-32" : r.rank === 2 ? "h-24" : "h-20";
            return (
              <div key={r.tgId} className="flex flex-col items-center">
                <div className={`mb-1 flex h-12 w-12 items-center justify-center rounded-full font-display text-xl ${r.rank === 1 ? "bg-gold text-primary-foreground shadow-glow" : "bg-secondary"} ${r.isMe ? "ring-2 ring-primary" : ""}`}>
                  {r.name.charAt(0).toUpperCase()}
                </div>
                <p className="w-full truncate text-center text-xs font-medium">{r.name}</p>
                <p className="text-[11px] text-muted-foreground">{r.coins.toLocaleString()}</p>
                <div className={`mt-1 flex w-full ${tall} flex-col items-center justify-start rounded-t-2xl pt-2 ${r.rank === 1 ? "bg-gold text-primary-foreground" : "bg-card border"}`}>
                  <span className="font-display text-2xl">#{r.rank}</span>
                  <span className={`font-display text-sm ${r.rank === 1 ? "" : "text-success"}`}>${r.prize.toFixed(2)}</span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="mt-4 space-y-2">
        {isLoading && Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-card" />)}
        {data && list.length === 0 && (
          <div className="rounded-3xl border bg-card p-6 text-center text-sm text-muted-foreground">
            <Crown className="mx-auto mb-2 h-10 w-10 text-primary" />
            No one has played a game yet this round. Be the first!
          </div>
        )}
        {rest.map((r) => (
          <div key={r.tgId} className={`flex items-center gap-3 rounded-2xl border p-3 shadow-card ${r.isMe ? "border-primary bg-secondary" : "bg-card"}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted font-display">{r.rank}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{r.name}{r.isMe && " (you)"}</p>
              <p className="text-xs text-muted-foreground">{r.coins.toLocaleString()} coins</p>
            </div>
            <div className={`font-display ${r.prize > 0 ? "text-success" : "text-muted-foreground"}`}>{r.prize > 0 ? `$${r.prize.toFixed(2)}` : "—"}</div>
          </div>
        ))}
      </section>

    </AppShell>
  );
}
