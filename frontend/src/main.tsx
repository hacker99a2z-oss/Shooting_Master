import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter, queryClient } from "./router";
import { getMe } from "@/lib/api.functions";
import { auth, startParam, webApp } from "@/lib/tg";
import { readCachedPlayer, writeCachedPlayer } from "@/lib/player-cache";
import { currentDeviceIsPhone, restoreTrustWalletSession } from "@/lib/trust-connect";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

const telegram = webApp();
telegram?.ready();
telegram?.expand();

// Warm the persisted mobile Trust Wallet session as soon as the Mini App opens.
// This does not create a new pairing or show a preparation spinner.
if (currentDeviceIsPhone()) void restoreTrustWalletSession();

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
    staleTime: 0,
    retry: 4,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 4_000),
  }).catch(() => {});
}

createRoot(root).render(React.createElement(RouterProvider, { router: getRouter() }));
