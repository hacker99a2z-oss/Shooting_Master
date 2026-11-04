import { createElement as h, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ShooterGame } from "@/components/ShooterGame";
import { usePlayer } from "@/hooks/use-player";
import { startGame, finishGame } from "@/lib/api.functions";
import { auth } from "@/lib/tg";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { data: me, isLoading, error, setPlayer } = usePlayer();
  const [playing, setPlaying] = useState(false);
  const [gameId, setGameId] = useState("");
  const begin = async () => {
    try {
      const session = await startGame(auth());
      setGameId(session.gameId);
      setPlaying(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to start game");
    }
  };
  const onEnd = async (score: number, kills: number) => {
    setPlaying(false);
    try {
      setPlayer(await finishGame({ ...auth(), gameId, score, kills }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save result");
    }
  };
  const content = isLoading ? h("p", null, "Loading player…")
    : error ? h("p", null, (error as Error).message)
    : h("section", { className: "rounded-3xl border bg-card p-5" },
        h("h2", { className: "text-3xl" }, "Clear 9–12 enemies"),
        h("p", null, "Earn 10 coins for each enemy."),
        h("p", null, (me?.coins ?? 0).toLocaleString() + " coins"),
        h("button", { disabled: !me?.canPlayFree && !me?.extraPlays, onClick: begin }, "Play"));
  return h(AppShell, { title: "Battle Arena" },
    playing ? h(ShooterGame, { onEnd }) : content);
}
