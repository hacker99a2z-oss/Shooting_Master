export type Auth = { initData: string; startParam?: string };
export type Player = { tgId:number; name:string; username:string|null; coins:number; seasonCoins:number; canPlayFree:boolean; extraPlays:number; gamesPlayed:number; bestScore:number; referralCount:number; referralPaidCount:number; photoUrl:string|null; adReadyAt:number; dailyGames:number; bonusClaimedToday:boolean };
const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
async function post<T>(path:string,data:Record<string,unknown>,keepalive=false):Promise<T>{
 const response=await fetch(API_BASE+"/api/"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data),credentials:"omit",cache:"no-store",keepalive});
 const payload=await response.json() as {error?:string};
 if(!response.ok) throw new Error(payload.error ?? "Request failed");
 return payload as T;
}
export const getMe=(data:Auth)=>post<Player>("me",data);
export const startGame=(data:Auth)=>post<{gameId:string;enemyTotal:number;expiresAt:number}>("game/start",data);
export const startGameAfterAd=(data:Auth & {adSessionId:string})=>post<{gameId:string;enemyTotal:number;expiresAt:number}>("game/start-ad",data);
export const finishGame=(data:Auth & {gameId:string;score:number;kills:number})=>post<Player & {reward:number;pendingVerification?:boolean}>("game/finish",data);
export const cancelGame=(data:Auth & {gameId:string})=>post<Player & {cancelled:boolean;alreadyFinished?:boolean}>("game/cancel",data,true);
export const startAdPlay=(data:Auth)=>post<{adSessionId:string;expiresAt:number}>("ad/start",data);
export type AdPlayStatus = Player & {verified:boolean; rewardPending:boolean; expired?:boolean; status?:string; cancelled?:boolean};
export const grantAdPlay=(data:Auth & {adSessionId:string})=>post<AdPlayStatus>("ad/complete",data);
export const getAdPlayStatus=(data:Auth & {adSessionId:string})=>post<AdPlayStatus>("ad/status",data);
export const cancelAdPlay=(data:Auth & {adSessionId:string})=>post<AdPlayStatus & {cancelled?:boolean}>("ad/cancel",data,true);
export const claimDailyBonus=(data:Auth)=>post<Player & {bonus:number}>("bonus/claim",data);
export type LeaderboardRow={rank:number;tgId:number;name:string;username:string|null;coins:number;prize:number;isMe:boolean};
export const getLeaderboard=(data:Auth)=>post<{list:LeaderboardRow[];seasonEndsAt:number}>("leaderboard",data);
export const requestWithdraw=(data:Auth & {usd:number;wallet:string;asset:"USDT";network:"BEP20"})=>post<{ok:boolean;id:string;status:string;automatic:boolean}>("withdrawals/request",data);
export type Withdrawal={id:string;coins:number;usd:number;wallet:string;status:string;created_at:string;payout_tx_hash?:string|null;payout_asset?:string|null;payout_network?:string|null;payout_error?:string|null};
export const getWithdrawals=(data:Auth)=>post<Withdrawal[]>("withdrawals",data);

export type WalletDestination={address:string;asset:"USDT";network:"BEP20";chainId:56;updatedAt:string};
export const getWalletDestination=(data:Auth)=>post<{destination:WalletDestination|null}>("wallet/destination",data);
export const saveWalletDestination=(data:Auth & {address:string;asset:"USDT";network:"BEP20"})=>post<{destination:WalletDestination}>("wallet/save",data);
