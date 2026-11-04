export type Auth = { initData: string; startParam?: string };
export type Player = { tgId:number; name:string; username:string|null; coins:number; seasonCoins:number; canPlayFree:boolean; extraPlays:number; gamesPlayed:number; bestScore:number; referralCount:number; photoUrl:string|null; adReadyAt:number; dailyGames:number; bonusClaimedToday:boolean };
const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
async function post<T>(path:string,data:Record<string,unknown>):Promise<T>{
 const response=await fetch(API_BASE+"/api/"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data),credentials:"omit",cache:"no-store"});
 const payload=await response.json() as {error?:string};
 if(!response.ok) throw new Error(payload.error ?? "Request failed");
 return payload as T;
}
export const getMe=(data:Auth)=>post<Player>("me",data);
export const startGame=(data:Auth)=>post<{gameId:string;enemyTotal:number;expiresAt:number}>("game/start",data);
export const finishGame=(data:Auth & {gameId:string;score:number;kills:number})=>post<Player & {reward:number}>("game/finish",data);
export const startAdPlay=(data:Auth)=>post<{adSessionId:string;expiresAt:number}>("ad/start",data);
export type AdPlayStatus = Player & {verified:boolean; rewardPending:boolean; expired?:boolean};
export const grantAdPlay=(data:Auth & {adSessionId:string})=>post<AdPlayStatus>("ad/complete",data);
export const getAdPlayStatus=(data:Auth & {adSessionId:string})=>post<AdPlayStatus>("ad/status",data);
export const cancelAdPlay=(data:Auth & {adSessionId:string})=>post<AdPlayStatus & {cancelled?:boolean}>("ad/cancel",data);
export const claimDailyBonus=(data:Auth)=>post<Player & {bonus:number}>("bonus/claim",data);
export type LeaderboardRow={rank:number;tgId:number;name:string;username:string|null;coins:number;prize:number;isMe:boolean};
export const getLeaderboard=(data:Auth)=>post<{list:LeaderboardRow[];seasonEndsAt:number}>("leaderboard",data);
export const requestWithdraw=(data:Auth & {usd:number;wallet:string})=>post<{ok:boolean}>("withdrawals/request",data);
export type Withdrawal={id:string;coins:number;usd:number;wallet:string;status:string;created_at:string};
export const getWithdrawals=(data:Auth)=>post<Withdrawal[]>("withdrawals",data);
