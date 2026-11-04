import { createServerFn } from "@tanstack/react-start";
import {
  COINS_PER_USD,
  rewardForKills,
  AD_COOLDOWN_MS,
  DAILY_GAMES_GOAL,
  randomBonusCoins,
  LEADERBOARD_MIN_COINS,
  LEADERBOARD_SHOWN,
  MAX_PENDING_AD_PLAYS,
  MIN_WITHDRAW_USD,
  SEASON_MS,
  prizeForRank,
} from "./rules";

type Auth = { initData: string; guestId?: number };

function authInput<T extends object = {}>(extra?: (d: any) => T) {
  return (d: unknown): Auth & T => {
    const o = (d ?? {}) as any;
    if (typeof o.initData !== "string") throw new Error("Bad request");
    const guestId = typeof o.guestId === "number" ? o.guestId : undefined;
    return { initData: o.initData.slice(0, 4096), guestId, ...(extra ? extra(o) : ({} as T)) };
  };
}

async function ctx(a: Auth) {
  const { verifyInitData } = await import("./telegram.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const user = await verifyInitData(a.initData, a.guestId);
  return { user, db: supabaseAdmin };
}

const season = () => Math.floor(Date.now() / SEASON_MS);
const today = () => new Date().toISOString().slice(0, 10);

function view(p: any) {
  const s = season();
  return {
    tgId: p.tg_id as number,
    name: p.first_name as string,
    username: p.username as string | null,
    coins: Number(p.coins),
    seasonCoins: p.season_id === s ? Number(p.season_coins) : 0,
    canPlayFree: p.last_play_date !== today(),
    extraPlays: p.extra_plays as number,
    gamesPlayed: p.games_played as number,
    bestScore: p.best_score as number,
    referralCount: p.referral_count as number,
    photoUrl: (p.photo_url as string | null) ?? null,
    adReadyAt: p.ad_ready_at ? new Date(p.ad_ready_at).getTime() : 0,
    dailyGames: p.daily_games_date === today() ? (p.daily_games as number) : 0,
    bonusClaimedToday: p.bonus_claimed_date === today(),
  };
}

export const getMe = createServerFn({ method: "POST" })
  .inputValidator(authInput((o) => ({ startParam: typeof o.startParam === "string" ? o.startParam : "" })))
  .handler(async ({ data }) => {
    const { user, db } = await ctx(data);
    const { data: existing } = await db.from("players").select("*").eq("tg_id", user.id).maybeSingle();
    if (existing) {
      const photo = user.photo_url ?? existing.photo_url ?? null;
      if (existing.first_name !== user.first_name || existing.username !== (user.username ?? null) || existing.photo_url !== photo) {
        await db.from("players").update({ first_name: user.first_name, username: user.username ?? null, photo_url: photo }).eq("tg_id", user.id);
        existing.photo_url = photo;
      }
      return view(existing);
    }
    let referredBy: number | null = null;
    const m = /^ref_(\d+)$/.exec(data.startParam);
    if (m && Number(m[1]) !== user.id) referredBy = Number(m[1]);
    const { data: created, error } = await db
      .from("players")
      .insert({ tg_id: user.id, first_name: user.first_name, username: user.username ?? null, photo_url: user.photo_url ?? null, referred_by: referredBy })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return view(created);
  });

export const finishGame = createServerFn({ method: "POST" })
  .inputValidator(authInput((o) => ({
    score: Math.max(0, Math.min(100000, Math.floor(Number(o.score) || 0))),
    kills: Math.max(0, Math.floor(Number(o.kills) || 0)),
  })))
  .handler(async ({ data }) => {
    const { user, db } = await ctx(data);
    const { data: before } = await db.from("players").select("last_play_date").eq("tg_id", user.id).single();
    const wasFree = before?.last_play_date !== today();
    const reward = rewardForKills(data.kills);
    const { error } = await db.rpc("finish_game", { p_tg_id: user.id, p_score: data.score, p_reward: reward });
    if (error) throw new Error(error.message.includes("no plays") ? "No plays left — watch an ad to play again" : error.message);
    // Daily free game: no ad timer. Every ad-unlocked game: 3 minute timer.
    const readyAt = wasFree ? null : new Date(Date.now() + AD_COOLDOWN_MS).toISOString();
    const { data: p } = await db.from("players").update({ ad_ready_at: readyAt }).eq("tg_id", user.id).select("*").single();
    return { ...view(p), reward };
  });

export const grantAdPlay = createServerFn({ method: "POST" })
  .inputValidator(authInput())
  .handler(async ({ data }) => {
    const { user, db } = await ctx(data);
    const { data: p } = await db.from("players").select("*").eq("tg_id", user.id).single();
    if (!p) throw new Error("Player not found");
    if (p.ad_ready_at && new Date(p.ad_ready_at).getTime() > Date.now()) throw new Error("Next ad unlocks soon — please wait");
    const extra = Math.min(MAX_PENDING_AD_PLAYS, p.extra_plays + 1);
    const { data: up } = await db.from("players").update({ extra_plays: extra }).eq("tg_id", user.id).select("*").single();
    return view(up);
  });

export const claimDailyBonus = createServerFn({ method: "POST" })
  .inputValidator(authInput())
  .handler(async ({ data }) => {
    const { user, db } = await ctx(data);
    const bonus = randomBonusCoins();
    const { error } = await db.rpc("claim_daily_bonus", { p_tg_id: user.id, p_goal: DAILY_GAMES_GOAL, p_coins: bonus });
    if (error) throw new Error(error.message.includes("not available") ? `Play ${DAILY_GAMES_GOAL} games today to claim` : error.message);
    const { data: p } = await db.from("players").select("*").eq("tg_id", user.id).single();
    return { ...view(p), bonus };
  });

export const getLeaderboard = createServerFn({ method: "POST" })
  .inputValidator(authInput())
  .handler(async ({ data }) => {
    const { user, db } = await ctx(data);
    const s = season();
    const { data: rows } = await db
      .from("players")
      .select("tg_id, first_name, username, season_coins")
      .eq("season_id", s)
      .gte("season_coins", LEADERBOARD_MIN_COINS)
      .order("season_coins", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(LEADERBOARD_SHOWN);
    const list = (rows ?? []).map((r, i) => ({
      rank: i + 1,
      tgId: r.tg_id,
      name: r.first_name,
      username: r.username,
      coins: Number(r.season_coins),
      prize: prizeForRank(i + 1),
      isMe: r.tg_id === user.id,
    }));
    return { list, seasonEndsAt: (s + 1) * SEASON_MS };
  });

export const requestWithdraw = createServerFn({ method: "POST" })
  .inputValidator(
    authInput((o) => ({
      usd: Math.floor(Number(o.usd) * 100) / 100,
      wallet: String(o.wallet ?? "").trim().slice(0, 120),
    })),
  )
  .handler(async ({ data }) => {
    const { user, db } = await ctx(data);
    if (!(data.usd >= MIN_WITHDRAW_USD)) throw new Error(`Minimum withdraw is $${MIN_WITHDRAW_USD}`);
    if (data.wallet.length < 20) throw new Error("Enter a valid Trust Wallet address");
    const coins = Math.round(data.usd * COINS_PER_USD);
    const { error } = await db.rpc("request_withdrawal", { p_tg_id: user.id, p_coins: coins, p_usd: data.usd, p_wallet: data.wallet });
    if (error) throw new Error(error.message.includes("not enough") ? "Not enough coins" : error.message);
    return { ok: true };
  });

export const getWithdrawals = createServerFn({ method: "POST" })
  .inputValidator(authInput())
  .handler(async ({ data }) => {
    const { user, db } = await ctx(data);
    const { data: rows } = await db
      .from("withdrawals")
      .select("id, coins, usd, wallet, status, created_at")
      .eq("tg_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    return (rows ?? []).map((r) => ({ ...r, usd: Number(r.usd), coins: Number(r.coins) }));
  });
