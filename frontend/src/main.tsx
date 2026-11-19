import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter, queryClient } from "./router";
import { getMe } from "@/lib/api.functions";
import { auth, startParam, webApp } from "@/lib/tg";
import { readCachedPlayer, writeCachedPlayer } from "@/lib/player-cache";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

const telegram = webApp();
telegram?.ready();
telegram?.expand();

const cached = readCachedPlayer();
if (cached) queryClient.setQueryData(["me"], cached.player, { updatedAt: cached.updatedAt });

// Fetch the verified profile as early as possible, in parallel with the first React render.
if (auth().initData) {
  void queryClient.prefetchQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const player = await getMe({ ...auth(), startParam: startParam() });
      writeCachedPlayer(player);
      return player;
    },
    staleTime: 10_000,
  }).catch(() => {});
}

createRoot(root).render(React.createElement(RouterProvider, { router: getRouter() }));
