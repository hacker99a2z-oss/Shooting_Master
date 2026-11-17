import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BattleGame } from "@/components/battle/BattleGame";
import { webApp } from "@/lib/tg";

export const Route = createFileRoute("/play")({
  head: () => ({
    meta: [
      { title: "Shooting Master — Battle Arena" },
      { name: "description", content: "Play Battle Arena in Shooting Master: shoot arrows, raise your shield and earn coins for every enemy you kill." },
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
      <BattleGame />
    </div>
  );
}
