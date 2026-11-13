import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArenaWorld } from "@/components/ArenaWorld";
import { webApp } from "@/lib/tg";

export const Route = createFileRoute("/play")({
  head: () => ({
    meta: [
      { title: "Shooting Master — Battle Arena" },
      { name: "description", content: "Play Battle Arena in Shooting Master and earn coins for every enemy you kill." },
      { property: "og:title", content: "Shooting Master — Battle Arena" },
      { property: "og:description", content: "Battle Arena: earn coins for every enemy you kill." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlayPage,
});

function PlayPage() {
  const navigate = useNavigate();
  // Coins earned in this round from killing enemies.
  const [roundCoins] = useState(0);

  // Telegram's own back button returns to the homepage.
  useEffect(() => {
    const back = webApp()?.BackButton;
    if (!back) return;
    const goHome = () => navigate({ to: "/" });
    back.show();
    back.onClick(goHome);
    return () => {
      back.offClick(goHome);
      back.hide();
    };
  }, [navigate]);

  return (
    <div className="arena-game">
      <ArenaWorld />
      <div className="arena-game-coins" aria-label="Coins earned this round">
        <span className="coin-dot" />
        <span className="text-gold-gradient">{roundCoins.toLocaleString()}</span>
      </div>
    </div>
  );
}
