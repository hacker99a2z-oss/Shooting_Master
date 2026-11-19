import type { Player } from "./api.functions";

const CACHE_PREFIX = "shooting-master:player:v1:";

function currentTelegramId(): number | null {
  if (typeof window === "undefined") return null;
  const id = Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function readCachedPlayer(): { player: Player; updatedAt: number } | null {
  const tgId = currentTelegramId();
  if (!tgId) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + tgId);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { player?: Player; updatedAt?: number };
    const player = saved.player;
    if (
      !player ||
      player.tgId !== tgId ||
      typeof player.name !== "string" ||
      !Number.isFinite(player.coins) ||
      !Number.isFinite(player.withdrawBalanceCents) ||
      !Number.isFinite(saved.updatedAt)
    ) return null;
    return { player, updatedAt: Number(saved.updatedAt) };
  } catch {
    return null;
  }
}

/** Cache is a display snapshot only; all rewards and withdrawals are still checked by the API. */
export function writeCachedPlayer(player: Player): void {
  if (currentTelegramId() !== player.tgId) return;
  try {
    localStorage.setItem(CACHE_PREFIX + player.tgId, JSON.stringify({ player, updatedAt: Date.now() }));
  } catch {
    // Storage may be unavailable or full in an embedded WebView.
  }
}
