import { createClient } from "@libsql/client/web";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatUnits,
  http,
  keccak256,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { assessBep20PayoutBalances } from "../payout-preflight.ts";
import { destinationInput, isBep20Destination } from "../wallet-destination.ts";
import { normalizeSecret, rawQueryValues, secretFingerprint, secretMatches } from "../adsgram-secret.ts";
import { approvalPayoutLimitError, parseAdminTelegramIds, parseWithdrawalApprovalCallback, withdrawalAmountsFromUsd } from "../withdrawal-approval.ts";

interface Env {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
  APP_ORIGIN: string;
  PAYOUT_QUEUE: Queue;
  ADSGRAM_REWARD_SECRET?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OFFICIAL_CHANNEL_URL?: string;
  OFFICIAL_GROUP_URL?: string;
  PAYOUT_ENABLED?: string;
  PAYOUT_PRIVATE_KEY?: string;
  BSC_RPC_URL?: string;
  PAYOUT_CHANNEL_ID?: string;
  ADMIN_TELEGRAM_IDS?: string;
}
const COINS_PER_KILL=10, MIN_ENEMIES=9, MAX_ENEMIES=12;
/** Daily Games cash claims are USD cents, credited only to withdraw balance. */
const DAILY_GOAL_REWARDS_CENTS:Record<number,number>={10:3,20:4};
function claimedGoalsToday(row:Row):number[]{return row.claimed_goals_date===today()?String(row.claimed_goals??"").split(",").filter(Boolean).map(Number):[];}
const DAILY_GAMES_GOAL=100, BONUS_MIN_CENTS=1, BONUS_MAX_CENTS=5;
const REFERRAL_REWARD=100, REFERRAL_GAMES_NEEDED=10, MAX_EXTRA_PLAYS=3;
const AD_COOLDOWN_MS=150000,AD_WATCH_COOLDOWN_MS=180000,MIN_MS_PER_KILL=500, SEASON_MS=172800000, GAME_TTL_MS=1200000, AD_TTL_MS=1800000;
type TelegramUser={id:number;first_name:string;username?:string;photo_url?:string};
type AuthUser={id:number;firstName:string;username:string|null;photoUrl:string|null};
type Row=Record<string,any>;
type PayoutMessage={withdrawalId:string;tgId:number;usd:number;coins:number;wallet:string;asset:"USDT";network:"BEP20";createdAt:string};

function json(data:unknown,status=200,headers:HeadersInit={}) {
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
}
function today(){return new Date().toISOString().slice(0,10);}
function seasonId(now=Date.now()){return Math.floor(now/SEASON_MS);}
function dbFor(env:Env){
  if(!env.TURSO_DATABASE_URL||!env.TURSO_AUTH_TOKEN)throw new Error("Database credentials are not configured");
  return createClient({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN});
}
const bytes=(s:string)=>new TextEncoder().encode(s);
async function hmac(keyBytes:Uint8Array,value:string){
  const key=await crypto.subtle.importKey("raw",new Uint8Array(keyBytes),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC",key,bytes(value)));
}
function hex(a:Uint8Array){return [...a].map(x=>x.toString(16).padStart(2,"0")).join("");}
function equal(a:string,b:string){
  if(a.length!==b.length)return false;let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function verifyTelegram(initData:unknown,env:Env):Promise<AuthUser>{
  if(typeof initData!=="string"||initData.length<20||initData.length>4096)throw new Error("Open this app inside Telegram");
  if(!env.TELEGRAM_BOT_TOKEN)throw new Error("Telegram authentication is not configured");
  const params=new URLSearchParams(initData),received=params.get("hash")||"";
  params.delete("hash");
  const authDate=Number(params.get("auth_date")),now=Math.floor(Date.now()/1000);
  if(!received||!Number.isFinite(authDate)||authDate>now+60||now-authDate>86400)throw new Error("Telegram session expired. Reopen the mini app.");
  const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
  const secret=await hmac(bytes("WebAppData"),env.TELEGRAM_BOT_TOKEN);
  if(!equal(hex(await hmac(secret,check)),received.toLowerCase()))throw new Error("Telegram authentication failed");
  let user:TelegramUser;
  try{user=JSON.parse(params.get("user")||"") as TelegramUser;}catch{throw new Error("Telegram user information is missing");}
  if(!Number.isSafeInteger(user.id)||user.id<=0||typeof user.first_name!=="string")throw new Error("Invalid Telegram user");
  return {id:user.id,firstName:user.first_name.slice(0,80),username:user.username?.slice(0,64)??null,photoUrl:user.photo_url?.slice(0,500)??null};
}
async function playerRow(db:any,tgId:number,tx?:any):Promise<Row|undefined>{
  const r=await (tx??db).execute({sql:"SELECT p.*,(SELECT COUNT(*) FROM players AS joined WHERE joined.referred_by=p.tg_id) AS joined_referral_count,(SELECT COUNT(*) FROM players AS rewarded WHERE rewarded.referred_by=p.tg_id AND rewarded.referral_paid=1) AS paid_referral_count FROM players AS p WHERE p.tg_id=?",args:[tgId]});
  return r.rows[0] as Row|undefined;
}
function view(row:Row){
  const t=today(),sid=seasonId();
  return {tgId:Number(row.tg_id),name:String(row.first_name),username:row.username==null?null:String(row.username),
    coins:Number(row.coins),withdrawBalanceCents:Number(row.withdraw_balance_cents??0),seasonCoins:Number(row.season_id)===sid?Number(row.season_coins):0,
    canPlayFree:row.last_play_date!==t,extraPlays:Number(row.extra_plays),gamesPlayed:Number(row.games_played),
    bestScore:Number(row.best_score),referralCount:Number(row.joined_referral_count??row.referral_count),referralPaidCount:Number(row.paid_referral_count??row.referral_count),photoUrl:row.photo_url==null?null:String(row.photo_url),
    adReadyAt:row.ad_ready_at==null?0:Number(row.ad_ready_at),
    dailyGames:row.daily_games_date===t?Number(row.daily_games):0,bonusClaimedToday:row.bonus_claimed_date===t,claimedGoals:claimedGoalsToday(row),
    serverNow:Date.now()};
}
async function ensurePlayer(db:any,user:AuthUser,startParam=""){
  let referrer:number|null=null;const m=/^ref_(\d+)$/.exec(startParam);
  if(m&&Number(m[1])!==user.id&&Number.isSafeInteger(Number(m[1])))referrer=Number(m[1]);
  // One UPSERT refreshes Telegram profile fields and preserves first-touch referral attribution.
  // This avoids two sequential Turso round-trips before the player row can be returned.
  await db.execute({sql:"INSERT INTO players (tg_id,first_name,username,photo_url,referred_by,coins,season_coins,season_id,games_played,best_score,daily_games,extra_plays,referral_count,referral_paid,created_at) VALUES (?,?,?,?,?,0,0,?,0,0,0,0,0,0,?) ON CONFLICT(tg_id) DO UPDATE SET first_name=excluded.first_name,username=excluded.username,photo_url=excluded.photo_url,referred_by=CASE WHEN players.referred_by IS NULL AND excluded.referred_by IS NOT NULL AND players.referral_paid=0 AND players.games_played=0 THEN excluded.referred_by ELSE players.referred_by END",
    args:[user.id,user.firstName,user.username,user.photoUrl,referrer,seasonId(),new Date().toISOString()]});
  const row=await playerRow(db,user.id);if(!row)throw new Error("Could not create player");return row;
}
async function txRun(db:any,fn:(tx:any)=>Promise<any>){
  const tx=await db.transaction("write");
  try{const value=await fn(tx);await tx.commit();return value;}
  catch(e){await tx.rollback();throw e;}
}

async function settleGameResult(db:any,tx:any,tgId:number,session:Row,score:number,kills:number){
  const used=await tx.execute({sql:"UPDATE game_sessions SET consumed_at=? WHERE id=? AND tg_id=? AND consumed_at IS NULL",args:[Date.now(),String(session.id),tgId]});
  if(used.rowsAffected!==1)throw new Error("Game result already submitted");
  const sessionType=Number(session.uses_extra_play);
  if(sessionType!==0&&sessionType!==1&&sessionType!==2)throw new Error("Invalid game session type");
  const reward=kills*COINS_PER_KILL,sid=seasonId(),t=today();
  const cooldown=Number(session.uses_extra_play)>0?Date.now()+AD_COOLDOWN_MS:null;
  await tx.execute({sql:"UPDATE players SET coins=coins+?,season_coins=CASE WHEN season_id=? THEN season_coins+? ELSE ? END,season_id=?,games_played=games_played+1,best_score=MAX(best_score,?),daily_games=CASE WHEN daily_games_date=? THEN daily_games+1 ELSE 1 END,daily_games_date=?,ad_ready_at=CASE WHEN ? IS NULL THEN ad_ready_at ELSE ? END WHERE tg_id=?",
    args:[reward,sid,reward,reward,sid,score,t,t,cooldown,cooldown,tgId]});
  let p=await playerRow(db,tgId,tx);
  if(p&&p.referred_by!=null&&Number(p.games_played)>=REFERRAL_GAMES_NEEDED&&Number(p.referral_paid)===0){
    const mark=await tx.execute({sql:"UPDATE players SET referral_paid=1 WHERE tg_id=? AND referral_paid=0",args:[tgId]});
    if(mark.rowsAffected===1){
      const referrer=Number(p.referred_by);
      await tx.execute({sql:"UPDATE players SET coins=coins+?,referral_count=referral_count+1 WHERE tg_id=?",args:[REFERRAL_REWARD,referrer]});
      await tx.execute({sql:"INSERT OR IGNORE INTO referral_rewards (referred_tg_id,referrer_tg_id,reward,created_at) VALUES (?,?,?,?)",args:[tgId,referrer,REFERRAL_REWARD,new Date().toISOString()]});
    }
  }
  p=await playerRow(db,tgId,tx);
  console.info("[AdsGram] game coins credited", { kills, reward });
  return {...view(p!),reward,pendingVerification:false};
}

function prize(rank:number){
  if(rank<1||rank>30)return 0;
  const step=(30*0.5-10)/(30*29/2);
  return Math.max(0,0.5-(rank-1)*step);
}
function randomBonusCents(){return BONUS_MIN_CENTS+Math.floor(Math.random()*(BONUS_MAX_CENTS-BONUS_MIN_CENTS+1));}
function walletValid(value:string){return /^0x[a-fA-F0-9]{40}$/.test(value)||/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);}

function newWalletConnectTicket(){
  const random=new Uint8Array(32);
  crypto.getRandomValues(random);
  return hex(random);
}
async function walletConnectTicketHash(ticket:string){
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes(ticket))));
}

const BSC_CHAIN_ID=56;
const USDT_BEP20_CONTRACT="0x55d398326f99059fF775485246999027B3197955" as const;
const AUTO_PAYOUT_MAX_USD=10;
const AUTO_PAYOUT_DAILY_MAX_USD=100;
const MAX_BSC_GAS_PRICE=20_000_000_000n;
const MAX_BSC_GAS_LIMIT=150_000n;
const TRANSFER_ABI=[{
  type:"function",name:"transfer",stateMutability:"nonpayable",
  inputs:[{name:"to",type:"address"},{name:"value",type:"uint256"}],
  outputs:[{name:"",type:"bool"}]
},{
  type:"function",name:"balanceOf",stateMutability:"view",
  inputs:[{name:"account",type:"address"}],outputs:[{name:"",type:"uint256"}]
},{
  type:"function",name:"decimals",stateMutability:"view",
  inputs:[],outputs:[{name:"",type:"uint8"}]
},{
  type:"function",name:"symbol",stateMutability:"view",
  inputs:[],outputs:[{name:"",type:"string"}]
},{
  type:"event",name:"Transfer",anonymous:false,
  inputs:[{name:"from",type:"address",indexed:true},{name:"to",type:"address",indexed:true},{name:"value",type:"uint256",indexed:false}]
}] as const;

class PayoutSafetyError extends Error {}
function payoutConfigured(env:Env){
  if(env.PAYOUT_ENABLED!=="true"||!/^0x[0-9a-fA-F]{64}$/.test(env.PAYOUT_PRIVATE_KEY||""))return false;
  try{return new URL(env.BSC_RPC_URL||"").protocol==="https:";}catch{return false;}
}
function makePayoutClients(env:Env){
  if(!payoutConfigured(env))throw new PayoutSafetyError("Automatic payout is not configured; request requires manual review.");
  if(!/^0x[0-9a-fA-F]{64}$/.test(env.PAYOUT_PRIVATE_KEY!))throw new PayoutSafetyError("Treasury signing key is invalid.");
  let rpc:URL;
  try{rpc=new URL(env.BSC_RPC_URL!);}catch{throw new PayoutSafetyError("BSC RPC endpoint is invalid.");}
  if(rpc.protocol!=="https:")throw new PayoutSafetyError("BSC RPC endpoint must use HTTPS.");
  const account=privateKeyToAccount(env.PAYOUT_PRIVATE_KEY as Hex);
  const transport=http(rpc.toString(),{timeout:15_000,retryCount:1});
  return {
    account,
    publicClient:createPublicClient({chain:bsc,transport}),
    walletClient:createWalletClient({account,chain:bsc,transport}),
  };
}
function amountForUsd(usd:number){
  if(!Number.isFinite(usd)||usd<0.02||usd>AUTO_PAYOUT_MAX_USD)throw new PayoutSafetyError("Amount is outside the automatic payout limit.");
  return parseUnits(usd.toFixed(2),18);
}

function assertTreasuryBalances(input:{
  tokenBalance:bigint;gasBalance:bigint;amount:bigint;gasPrice:bigint;estimatedGas:bigint;
}){
  const result=assessBep20PayoutBalances({
    ...input,
    maxGasPrice:MAX_BSC_GAS_PRICE,
    maxGasLimit:MAX_BSC_GAS_LIMIT,
  });
  if(!result.ok){
    if(result.reason==="insufficient_usdt"){
      throw new PayoutSafetyError("Treasury USDT balance is "+formatUnits(input.tokenBalance,18)+" USDT; this payout needs "+formatUnits(input.amount,18)+" USDT.");
    }
    if(result.reason==="gas_price_high"){
      throw new PayoutSafetyError("BNB gas price is above the automatic payout safety limit.");
    }
    if(result.reason==="gas_limit_high"){
      throw new PayoutSafetyError("Estimated gas exceeds the automatic payout safety limit.");
    }
    if(result.reason==="insufficient_bnb"){
      const shortfall=result.requiredGasBalance-input.gasBalance;
      throw new PayoutSafetyError("Treasury BNB is short by "+formatUnits(shortfall,18)+" BNB for the required gas reserve.");
    }
    throw new PayoutSafetyError("Treasury gas estimate could not be verified.");
  }
  return result;
}

async function preflightBep20Payout(env:Env,usd:number,recipient:string){
  if(!/^0x[a-fA-F0-9]{40}$/.test(recipient))throw new PayoutSafetyError("Invalid payout recipient address.");
  const amount=amountForUsd(usd);
  const {account,publicClient}=makePayoutClients(env);
  const chainId=await publicClient.getChainId();
  if(chainId!==BSC_CHAIN_ID)throw new PayoutSafetyError("Configured RPC is not BNB Smart Chain mainnet.");
  const token=USDT_BEP20_CONTRACT;
  const [symbol,decimals,tokenBalance,gasBalance,gasPrice]=await Promise.all([
    publicClient.readContract({address:token,abi:TRANSFER_ABI,functionName:"symbol"}),
    publicClient.readContract({address:token,abi:TRANSFER_ABI,functionName:"decimals"}),
    publicClient.readContract({address:token,abi:TRANSFER_ABI,functionName:"balanceOf",args:[account.address]}),
    publicClient.getBalance({address:account.address}),
    publicClient.getGasPrice(),
  ]);
  if(symbol!=="USDT"||Number(decimals)!==18)throw new PayoutSafetyError("Configured BSC token does not match the expected USDT contract and 18 decimals.");
  if(tokenBalance<amount){
    throw new PayoutSafetyError("Treasury USDT is short by "+formatUnits(amount-tokenBalance,18)+" USDT for this request.");
  }
  const data=encodeFunctionData({abi:TRANSFER_ABI,functionName:"transfer",args:[recipient as Address,amount]});
  const estimatedGas=await publicClient.estimateGas({account:account.address,to:token,data});
  const assessment=assertTreasuryBalances({tokenBalance,gasBalance,amount,gasPrice,estimatedGas});
  return {
    usdtBalance:formatUnits(tokenBalance,18),
    usdtRequired:formatUnits(amount,18),
    bnbBalance:formatUnits(gasBalance,18),
    estimatedFee:formatUnits(assessment.gasLimit*gasPrice,18),
    bnbSafetyReserve:formatUnits(assessment.requiredGasBalance,18),
  };
}
async function writePayoutEvent(db:any,id:string,eventType:string,payload:Row){
  await db.execute({
    sql:"INSERT OR IGNORE INTO payout_events (withdrawal_id,event_type,payload,created_at) VALUES (?,?,?,?)",
    args:[id,eventType,JSON.stringify(payload),new Date().toISOString()]
  });
}
async function setPayoutForReview(db:any,id:string,reason:string){
  const at=new Date().toISOString();
  const safeReason=reason.slice(0,500);
  await db.execute({
    sql:"UPDATE withdrawals SET status='payout_failed_review',payout_error=?,payout_updated_at=? WHERE id=? AND status IN ('pending_auto','processing')",
    args:[safeReason,at,id]
  });
  await writePayoutEvent(db,id,"failed_review",{reason:safeReason,at});
  console.error("[payout] manual review required",{withdrawalId:id,reason:safeReason});
}
// Public payout announcements: the channel comes from PAYOUT_CHANNEL_ID (@name or -100…)
// or, when unset, from the public OFFICIAL_CHANNEL_URL (https://t.me/name).
function payoutChannelChat(env:Env):string|null{
  const configured=(env.PAYOUT_CHANNEL_ID||"").trim();
  if(/^@[A-Za-z0-9_]{5,32}$/.test(configured)||/^-100\d{5,}$/.test(configured))return configured;
  const match=/^https:\/\/t\.me\/([A-Za-z0-9_]{5,32})\/?$/.exec((env.OFFICIAL_CHANNEL_URL||"").trim());
  return match?"@"+match[1]:null;
}
function escapeHtml(value:string){return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function channelPostUrl(chat:any,messageId:number):string|null{
  if(!Number.isSafeInteger(messageId))return null;
  if(typeof chat?.username==="string"&&chat.username)return "https://t.me/"+chat.username+"/"+messageId;
  const id=String(chat?.id??"");
  return id.startsWith("-100")?"https://t.me/c/"+id.slice(4)+"/"+messageId:null;
}
async function announcePaidWithdrawal(db:any,env:Env,id:string){
  const chat=payoutChannelChat(env);
  if(!chat||!env.TELEGRAM_BOT_TOKEN)return;
  const now=Date.now();
  // Claim the announcement so concurrent runs never post the same payout twice.
  const claim=await db.execute({
    sql:"UPDATE withdrawals SET channel_posted_at=? WHERE id=? AND status='paid' AND channel_post_url IS NULL AND (channel_posted_at IS NULL OR channel_posted_at<?)",
    args:[new Date(now).toISOString(),id,new Date(now-10*60_000).toISOString()]
  });
  if(claim.rowsAffected!==1)return;
  try{
    const selected=await db.execute({
      sql:"SELECT w.usd,w.coins,w.wallet,w.payout_tx_hash,p.first_name,p.username FROM withdrawals w LEFT JOIN players p ON p.tg_id=w.tg_id WHERE w.id=? LIMIT 1",
      args:[id]
    });
    const row=selected.rows[0] as Row|undefined;
    if(!row)throw new Error("Withdrawal not found for announcement");
    const wallet=String(row.wallet||"");
    const txHash=typeof row.payout_tx_hash==="string"?row.payout_tx_hash:"";
    const lines=[
      "✅ <b>WITHDRAWAL PAID</b>",
      "",
      "👤 <b>Name:</b> "+escapeHtml(String(row.first_name||"Player")),
      "🔗 <b>Username:</b> "+(row.username?"@"+escapeHtml(String(row.username)):"—"),
      "💰 <b>Amount:</b> $"+Number(row.usd).toFixed(2)+" USDT ("+Number(row.coins).toLocaleString("en-US")+" coins)",
      "👛 <b>Wallet:</b> <code>"+escapeHtml(wallet.slice(0,6)+"…"+wallet.slice(-4))+"</code>",
      "🌐 <b>Network:</b> BNB Smart Chain (BEP-20)",
    ];
    if(/^0x[0-9a-fA-F]{64}$/.test(txHash))lines.push("🧾 <a href=\"https://bscscan.com/tx/"+txHash+"\">View transaction</a>");
    const response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({chat_id:chat,text:lines.join("\n"),parse_mode:"HTML",disable_web_page_preview:true}),
    });
    const payload=await response.json().catch(()=>({})) as {ok?:boolean;description?:string;result?:{message_id:number;chat:any}};
    if(!response.ok||!payload.ok||!payload.result)throw new Error(payload.description||"Telegram channel post failed ("+response.status+")");
    const url=channelPostUrl(payload.result.chat,payload.result.message_id);
    await db.execute({sql:"UPDATE withdrawals SET channel_post_url=? WHERE id=?",args:[url||"https://t.me/"+chat.replace(/^@/,""),id]});
  }catch(error){
    console.error("[payout] channel announcement failed",id,error);
    await db.execute({sql:"UPDATE withdrawals SET channel_posted_at=NULL WHERE id=? AND channel_post_url IS NULL",args:[id]}).catch(()=>{});
  }
}
async function announceMissedPayouts(env:Env){
  if(!payoutChannelChat(env))return;
  const db=dbFor(env);
  try{
    // Bounded catch-up for recent payouts whose announcement failed; older history is never posted.
    const rows=await db.execute({
      sql:"SELECT id FROM withdrawals WHERE status='paid' AND channel_post_url IS NULL AND payout_paid_at>? ORDER BY payout_paid_at ASC LIMIT 10",
      args:[new Date(Date.now()-24*60*60_000).toISOString()]
    });
    for(const row of rows.rows as Row[])await announcePaidWithdrawal(db,env,String(row.id));
  }finally{db.close();}
}
async function markPayoutPaid(db:any,env:Env,id:string,txHash:string){
  const at=new Date().toISOString();
  const updated=await db.execute({
    sql:"UPDATE withdrawals SET status='paid',payout_tx_hash=?,payout_error=NULL,payout_updated_at=?,payout_paid_at=? WHERE id=? AND status='processing'",
    args:[txHash,at,at,id]
  });
  if(updated.rowsAffected===1){
    await writePayoutEvent(db,id,"paid",{txHash,at,network:"BEP20",asset:"USDT"});
    await announcePaidWithdrawal(db,env,id).catch((error)=>console.error("[payout] channel announcement skipped",id,error));
  }
}
async function confirmPayoutReceipt(db:any,env:Env,id:string,txHash:string,receipt:any,from:string,to:string,amount:bigint){
  if(receipt.status!=="success"){
    await setPayoutForReview(db,id,"The BNB Smart Chain transaction reverted. Treasury review is required.");
    return;
  }
  const transfers=parseEventLogs({abi:TRANSFER_ABI,eventName:"Transfer",logs:receipt.logs,strict:true});
  const transfer=transfers.some((log:any)=>
    String(log.args.from).toLowerCase()===from.toLowerCase()&&
    String(log.args.to).toLowerCase()===to.toLowerCase()&&
    log.args.value===amount
  );
  if(!transfer){
    await setPayoutForReview(db,id,"Transaction receipt did not contain the exact USDT transfer event. Treasury review is required.");
    return;
  }
  await markPayoutPaid(db,env,id,txHash);
}
function isReceiptNotFound(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  return /receipt not found|transaction hash not found|could not be found|unknown transaction/i.test(message);
}
async function processBep20Payout(p:PayoutMessage,env:Env,db:any){
  if(p.asset!=="USDT"||p.network!=="BEP20")throw new PayoutSafetyError("Unsupported payout asset or network.");
  if(!/^0x[a-fA-F0-9]{40}$/.test(p.wallet))throw new PayoutSafetyError("Invalid payout recipient address.");
  const selected=await db.execute({
    sql:"SELECT id,tg_id,usd,wallet,status,payout_asset,payout_network,payout_tx_hash,payout_raw_tx FROM withdrawals WHERE id=? LIMIT 1",
    args:[p.withdrawalId]
  });
  const row=selected.rows[0] as Row|undefined;
  if(!row)throw new PayoutSafetyError("Withdrawal record does not exist.");
  if(String(row.status)==="paid")return;
  if(!["pending_auto","processing"].includes(String(row.status)))return;
  if(String(row.wallet).toLowerCase()!==p.wallet.toLowerCase()||Number(row.tg_id)!==p.tgId||
     String(row.payout_asset)!=="USDT"||String(row.payout_network)!=="BEP20"||
     Number(row.usd)!==Number(p.usd))throw new PayoutSafetyError("Queue payload does not match the stored withdrawal.");
  const amount=amountForUsd(Number(row.usd));
  const {account,publicClient,walletClient}=makePayoutClients(env);
  const chainId=await publicClient.getChainId();
  if(chainId!==BSC_CHAIN_ID)throw new PayoutSafetyError("Configured RPC is not BNB Smart Chain mainnet.");
  const token=USDT_BEP20_CONTRACT;
  const [symbol,decimals]=await Promise.all([
    publicClient.readContract({address:token,abi:TRANSFER_ABI,functionName:"symbol"}),
    publicClient.readContract({address:token,abi:TRANSFER_ABI,functionName:"decimals"})
  ]);
  if(symbol!=="USDT"||Number(decimals)!==18)throw new PayoutSafetyError("Configured BSC token does not match the expected USDT contract and 18 decimals.");

  const recipient=p.wallet as Address;
  let txHash=typeof row.payout_tx_hash==="string"?row.payout_tx_hash:"";
  let rawTx=typeof row.payout_raw_tx==="string"?row.payout_raw_tx as Hex:"";

  if(txHash){
    try{
      const receipt=await publicClient.getTransactionReceipt({hash:txHash as Hex});
      await confirmPayoutReceipt(db,env,p.withdrawalId,txHash,receipt,account.address,recipient,amount);
      return;
    }catch(error){
      if(!isReceiptNotFound(error))throw error;
    }
  }

  if(!rawTx){
    if(String(row.status)==="processing") {
      const age=Date.now()-Date.parse(String(row.payout_updated_at||""));
      if(Number.isFinite(age)&&age<30_000)throw new Error("A payout signing attempt is already in progress.");
    }
    const [tokenBalance,gasBalance,gasPrice,nonce]=await Promise.all([
      publicClient.readContract({address:token,abi:TRANSFER_ABI,functionName:"balanceOf",args:[account.address]}),
      publicClient.getBalance({address:account.address}),
      publicClient.getGasPrice(),
      publicClient.getTransactionCount({address:account.address,blockTag:"pending"})
    ]);
    const data=encodeFunctionData({abi:TRANSFER_ABI,functionName:"transfer",args:[recipient,amount]});
    const estimate=await publicClient.estimateGas({account:account.address,to:token,data});
    const balanceCheck=assertTreasuryBalances({tokenBalance,gasBalance,amount,gasPrice,estimatedGas:estimate});
    const gas=balanceCheck.gasLimit;
    rawTx=await walletClient.signTransaction({account,chain:bsc,to:token,data,gas,gasPrice,nonce});
    txHash=keccak256(rawTx);
    const now=new Date().toISOString();
    const saved=await db.execute({
      sql:"UPDATE withdrawals SET status='processing',payout_raw_tx=?,payout_tx_hash=?,payout_nonce=?,payout_attempts=payout_attempts+1,payout_error=NULL,payout_updated_at=? WHERE id=? AND payout_raw_tx IS NULL AND status IN ('pending_auto','processing')",
      args:[rawTx,txHash,nonce,now,p.withdrawalId]
    });
    if(saved.rowsAffected!==1){
      const latest=await db.execute({sql:"SELECT payout_raw_tx,payout_tx_hash FROM withdrawals WHERE id=? LIMIT 1",args:[p.withdrawalId]});
      const existing=latest.rows[0] as Row|undefined;
      if(!existing?.payout_raw_tx||!existing?.payout_tx_hash)throw new Error("Could not persist the signed payout transaction safely.");
      rawTx=String(existing.payout_raw_tx) as Hex;
      txHash=String(existing.payout_tx_hash);
    }else{
      await writePayoutEvent(db,p.withdrawalId,"signed",{txHash,nonce,asset:"USDT",network:"BEP20",treasury:account.address});
    }
  }

  try{
    await publicClient.sendRawTransaction({serializedTransaction:rawTx});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(!/already known|known transaction|already imported/i.test(message))throw error;
  }
  await db.execute({
    sql:"UPDATE withdrawals SET payout_updated_at=? WHERE id=? AND status='processing'",
    args:[new Date().toISOString(),p.withdrawalId]
  });
  await writePayoutEvent(db,p.withdrawalId,"broadcast",{txHash,network:"BEP20",asset:"USDT"});
  try{
    const receipt=await publicClient.waitForTransactionReceipt({hash:txHash as Hex,confirmations:1,timeout:45_000});
    await confirmPayoutReceipt(db,env,p.withdrawalId,txHash,receipt,account.address,recipient,amount);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(!/timed out|timeout/i.test(message))throw error;
    // A pending transaction is left in processing; the scheduled recovery checks this same hash.
    await db.execute({
      sql:"UPDATE withdrawals SET payout_updated_at=? WHERE id=? AND status='processing'",
      args:[new Date().toISOString(),p.withdrawalId]
    });
  }
}

type StartKeyboardButton={text:string;url?:string;web_app?:{url:string}};

async function telegramCall(env:Env,method:string,payload:Row):Promise<Row>{
  if(!env.TELEGRAM_BOT_TOKEN)throw new Error("Telegram bot is not configured");
  const response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/"+method,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)
  });
  const result=await response.json().catch(()=>({})) as Row;
  if(!response.ok||result.ok!==true)throw new Error(typeof result.description==="string"?result.description:"Telegram "+method+" failed ("+response.status+")");
  return result.result as Row;
}

async function notifyWithdrawalAdmins(env:Env,details:{id:string;tgId:number;name:string;username:string|null;usd:number;coins:number;wallet:string;createdAt:string}):Promise<boolean>{
  const admins=parseAdminTelegramIds(env.ADMIN_TELEGRAM_IDS);
  if(!admins.length){
    console.error("[withdrawal approval] ADMIN_TELEGRAM_IDS is not configured");
    return false;
  }
  const lines=[
    "🔐 <b>WITHDRAWAL APPROVAL REQUIRED</b>","",
    "<b>Request:</b> <code>"+escapeHtml(details.id)+"</code>",
    "<b>Player:</b> "+escapeHtml(details.name)+(details.username?" (@"+escapeHtml(details.username)+")":""),
    "<b>Telegram ID:</b> <code>"+details.tgId+"</code>",
    "<b>Amount:</b> $"+details.usd.toFixed(2)+" USDT",
    "<b>Reserved coins:</b> "+details.coins.toLocaleString("en-US"),
    "<b>Destination:</b> <code>"+escapeHtml(details.wallet)+"</code>",
    "<b>Network:</b> BNB Smart Chain (BEP-20)",
    "<b>Requested:</b> "+escapeHtml(details.createdAt),"",
    "Approve only after checking the destination and payout configuration."
  ];
  const replyMarkup={inline_keyboard:[
    [{text:"✅ Approve & Send",callback_data:"wd:approve:"+details.id}],
    [{text:"❌ Reject & Refund",callback_data:"wd:reject:"+details.id}]
  ]};
  const sent=await Promise.all(admins.map(async(adminId)=>{
    try{
      await telegramCall(env,"sendMessage",{chat_id:adminId,text:lines.join("\n"),parse_mode:"HTML",disable_web_page_preview:true,reply_markup:replyMarkup});
      return true;
    }catch(error){
      console.error("[withdrawal approval] admin notification failed",adminId,error);
      return false;
    }
  }));
  return sent.some(Boolean);
}
async function answerTelegramCallback(env:Env,callbackId:string,text:string,showAlert=true){
  try{await telegramCall(env,"answerCallbackQuery",{callback_query_id:callbackId,text,show_alert:showAlert});}
  catch(error){console.error("[withdrawal approval] callback acknowledgement failed",error);}
}
async function editTelegramApprovalMessage(env:Env,chatId:number|string,messageId:number,text:string){
  try{await telegramCall(env,"editMessageText",{
    chat_id:chatId,message_id:messageId,text,parse_mode:"HTML",disable_web_page_preview:true,
    reply_markup:{inline_keyboard:[]}
  });}catch(error){console.error("[withdrawal approval] approval message update failed",error);}
}

async function handleWithdrawalApprovalCallback(callback:Row,env:Env){
  const callbackId=typeof callback.id==="string"?callback.id:"";
  const adminId=Number(callback.from?.id);
  const message=callback.message as Row|undefined;
  const chat=message?.chat as Row|undefined;
  const notify=(text:string,alert=true)=>callbackId?answerTelegramCallback(env,callbackId,text,alert):Promise.resolve();
  const admins=parseAdminTelegramIds(env.ADMIN_TELEGRAM_IDS);
  if(!Number.isSafeInteger(adminId)||!admins.includes(adminId)){
    await notify("You are not authorized to approve withdrawals.");
    return json({ok:true});
  }
  if(chat?.type!=="private"||String(chat.id)!==String(adminId)||!Number.isSafeInteger(Number(message?.message_id))){
    await notify("Open the approval request in your private chat with the bot.");
    return json({ok:true});
  }
  const parsed=parseWithdrawalApprovalCallback(callback.data);
  if(!parsed){
    await notify("This approval button is invalid or expired.");
    return json({ok:true});
  }
  if(parsed.action==="approve"&&!payoutConfigured(env)){
    await notify("Automatic payouts are disabled or payout credentials are incomplete. No payment was sent.",true);
    return json({ok:true});
  }

  const db=dbFor(env);
  try{
    if(parsed.action==="approve"){
      const candidate=await db.execute({
        sql:"SELECT usd,wallet,status FROM withdrawals WHERE id=? LIMIT 1",
        args:[parsed.withdrawalId]
      });
      const row=candidate.rows[0] as Row|undefined;
      if(row&&String(row.status)==="pending_approval"){
        try{
          const preflight=await preflightBep20Payout(env,Number(row.usd),String(row.wallet));
          await notify(
            "Treasury check passed: "+preflight.usdtBalance+" USDT available; "+preflight.bnbBalance+" BNB available. Queueing payout.",
            false
          );
        }catch(error){
          const reason=error instanceof PayoutSafetyError
            ?error.message
            :"Could not verify the treasury wallet on BNB Smart Chain. Check BSC_RPC_URL and try again.";
          await notify(("Preflight blocked: "+reason+" No payment was queued.").slice(0,195),true);
          return json({ok:true,disposition:"preflight_blocked"});
        }
      }
    }
    const outcome=await txRun(db,async(tx)=>{
      const selected=await tx.execute({sql:"SELECT id,tg_id,coins,usd,wallet,status,created_at,balance_cents FROM withdrawals WHERE id=? LIMIT 1",args:[parsed.withdrawalId]});
      const row=selected.rows[0] as Row|undefined;
      if(!row)return {kind:"missing" as const};
      if(String(row.status)!=="pending_approval")return {kind:"handled" as const,status:String(row.status)};
      if(parsed.action==="reject"){
        const at=new Date().toISOString();
        const changed=await tx.execute({sql:"UPDATE withdrawals SET status='rejected',payout_error='Rejected by owner; reserved coins refunded',payout_updated_at=? WHERE id=? AND status='pending_approval'",args:[at,parsed.withdrawalId]});
        if(changed.rowsAffected!==1)return {kind:"handled" as const,status:"changed"};
        const refund=await tx.execute({sql:"UPDATE players SET coins=coins+?,withdraw_balance_cents=withdraw_balance_cents+? WHERE tg_id=?",args:[Number(row.coins),Number(row.balance_cents??0),Number(row.tg_id)]});
        if(refund.rowsAffected!==1)throw new Error("Could not refund reserved coins");
        await writePayoutEvent(tx,parsed.withdrawalId,"rejected",{adminTelegramId:adminId,refundCoins:Number(row.coins),refundBalanceCents:Number(row.balance_cents??0),at});
        return {kind:"rejected" as const,coins:Number(row.coins),usd:Number(row.usd)};
      }
      if(!payoutConfigured(env))return {kind:"blocked" as const,reason:"Automatic payouts are disabled or not fully configured."};
      const daily=await tx.execute({
        sql:"SELECT COALESCE(SUM(usd),0) AS total FROM withdrawals WHERE substr(created_at,1,10)=? AND status IN ('pending_auto','processing','paid','payout_failed_review')",
        args:[today()]
      });
      const limitError=approvalPayoutLimitError(Number(row.usd),Number(daily.rows[0]?.total??0));
      if(limitError)return {kind:"blocked" as const,reason:limitError};
      const at=new Date().toISOString();
      const changed=await tx.execute({sql:"UPDATE withdrawals SET status='pending_auto',payout_error=NULL,payout_updated_at=? WHERE id=? AND status='pending_approval'",args:[at,parsed.withdrawalId]});
      if(changed.rowsAffected!==1)return {kind:"handled" as const,status:"changed"};
      await writePayoutEvent(tx,parsed.withdrawalId,"approved",{adminTelegramId:adminId,at,network:"BEP20",asset:"USDT"});
      const payout:PayoutMessage={withdrawalId:String(row.id),tgId:Number(row.tg_id),usd:Number(row.usd),coins:Number(row.coins),wallet:String(row.wallet),asset:"USDT",network:"BEP20",createdAt:String(row.created_at)};
      return {kind:"approved" as const,payout,usd:Number(row.usd)};
    });
    const messageId=Number(message.message_id);
    if(outcome.kind==="missing"){
      await notify("Withdrawal request not found.");
      await editTelegramApprovalMessage(env,chat.id,messageId,"⚠️ <b>Request not found.</b>");
      return json({ok:true});
    }
    if(outcome.kind==="handled"){
      await notify("This withdrawal has already been handled.");
      await editTelegramApprovalMessage(env,chat.id,messageId,"ℹ️ <b>This request is no longer awaiting approval.</b>\nCurrent state: <code>"+escapeHtml(outcome.status)+"</code>");
      return json({ok:true});
    }
    if(outcome.kind==="blocked"){
      await notify(outcome.reason,true);
      return json({ok:true});
    }
    if(outcome.kind==="rejected"){
      await notify("Rejected. "+outcome.coins.toLocaleString("en-US")+" coins were refunded.",true);
      await editTelegramApprovalMessage(env,chat.id,messageId,"❌ <b>WITHDRAWAL REJECTED</b>\n$"+outcome.usd.toFixed(2)+" request rejected. "+outcome.coins.toLocaleString("en-US")+" coins have been refunded.");
      return json({ok:true,disposition:"rejected"});
    }
    let queueError="";
    try{await env.PAYOUT_QUEUE.send(outcome.payout);}
    catch(error){
      queueError=error instanceof Error?error.message:"Payout queue unavailable";
      const at=new Date().toISOString();
      await db.execute({sql:"UPDATE withdrawals SET status='pending_review',payout_error=?,payout_updated_at=? WHERE id=? AND status='pending_auto'",args:[queueError.slice(0,500),at,parsed.withdrawalId]});
      await writePayoutEvent(db,parsed.withdrawalId,"queue_fallback",{reason:queueError.slice(0,500),at});
    }
    if(queueError){
      await notify("Approval was recorded, but the payout queue is unavailable. Manual review is required.",true);
      await editTelegramApprovalMessage(env,chat.id,messageId,"⚠️ <b>APPROVAL RECORDED — MANUAL REVIEW REQUIRED</b>\nThe payout queue was unavailable. No blockchain transfer was started.");
      return json({ok:true,disposition:"manual_review"});
    }
    await writePayoutEvent(db,parsed.withdrawalId,"queued",{asset:"USDT",network:"BEP20",wallet:outcome.payout.wallet,usd:outcome.payout.usd,at:new Date().toISOString()}).catch((error)=>console.error("[withdrawal approval] queue audit write failed",error));
    await notify("Approved. The app will show Sent only after BNB Chain confirms the transfer.",false);
    await editTelegramApprovalMessage(env,chat.id,messageId,"✅ <b>APPROVED & QUEUED</b>\n$"+outcome.usd.toFixed(2)+" USDT is being processed. The user will see <b>Sent</b> only after blockchain confirmation.");
    return json({ok:true,disposition:"queued"});
  }catch(error){
    console.error("[withdrawal approval] callback handling failed",error);
    await notify("Temporary server error. Please retry the button.",true);
    return json({ok:false},503);
  }finally{db.close();}
}

function telegramLink(value?:string):string|null{
  const url=value?.trim()||"";
  return /^https:\/\/t\.me\/[A-Za-z0-9_+.-]+(?:\?[A-Za-z0-9_=&%-]+)?$/.test(url)?url:null;
}
async function telegramWebhook(request:Request,env:Env){
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  const received=request.headers.get("X-Telegram-Bot-Api-Secret-Token")||"";
  const expected=hex(await hmac(bytes(env.TELEGRAM_BOT_TOKEN),"shooting-master-telegram-webhook-v1"));
  if(!equal(received,expected))return json({error:"Unauthorized"},401);
  let update:Row;
  try{update=await request.json() as Row;}catch{return json({error:"Invalid update"},400);}
  const callback=update.callback_query as Row|undefined;
  if(callback)return handleWithdrawalApprovalCallback(callback,env);
  const message=update.message as Row|undefined;
  const chat=message?.chat as Row|undefined;
  const command=typeof message?.text==="string"?message.text.trim():"";
  if(chat?.type!=="private"||!/^\/start(?:@\w+)?(?:\s|$)/i.test(command))return json({ok:true});
  const text=[
    "🪙 <b>EARN COINS:</b> Defeat enemies to earn 10 coins per kill and collect bonus rewards.",
    "💵 <b>WITHDRAW BALANCE:</b> Daily cash claims add withdrawable dollars separately. Battle Arena kills earn Coins; withdrawals require both.",
    "💸 <b>WITHDRAW:</b> Requests wait for owner approval. Eligible USDT BEP-20 payments are sent after approval and blockchain confirmation."
  ].join("\n");
  const keyboard:StartKeyboardButton[][]=[
    [{text:"🎮 Open App",web_app:{url:env.APP_ORIGIN}}]
  ];
  const channelUrl=telegramLink(env.OFFICIAL_CHANNEL_URL);
  const groupUrl=telegramLink(env.OFFICIAL_GROUP_URL);
  if(channelUrl)keyboard.push([{text:"📢 Official Channel",url:channelUrl}]);
  if(groupUrl)keyboard.push([{text:"👥 Official Group",url:groupUrl}]);
  const response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chat.id,text,parse_mode:"HTML",disable_web_page_preview:true,reply_markup:{inline_keyboard:keyboard}})
  });
  const payload=await response.json() as {ok?:boolean;description?:string};
  if(!response.ok||!payload.ok){console.error("Telegram /start reply failed",payload.description);return json({error:"Telegram could not send the welcome message"},502);}
  return json({ok:true});
}

async function api(request:Request,env:Env,ctx:ExecutionContext){
  const path=new URL(request.url).pathname.replace(/\/+$/,"")||"/";
  if(path==="/telegram/webhook")return telegramWebhook(request,env);
  if(path==="/health"&&(request.method==="GET"||request.method==="HEAD")){
    const health={ok:true,service:"shooting-master-api",adsgramRewardConfigured:Boolean(env.ADSGRAM_REWARD_SECRET)};
    // UptimeRobot and other monitors commonly probe with HEAD. Return the same
    // successful status without a response body for HEAD requests.
    if(request.method==="HEAD")return new Response(null,{status:200,headers:{"cache-control":"no-store"}});
    return json(health);
  }
  if(request.method==="GET"&&path==="/api/adsgram/reward"){
    const url=new URL(request.url);
    const suppliedKeys=[...rawQueryValues(url.search,"key"),...rawQueryValues(url.search,"secret"),...rawQueryValues(url.search,"token")];
    const rawUserId=(url.searchParams.get("userid")||url.searchParams.get("userId")||url.searchParams.get("user_id")||"").trim();
    console.info("[AdsGram] Reward URL hit", { userIdPresent:Boolean(rawUserId), keyPresent:suppliedKeys.length>0 });
    const expectedSecret=normalizeSecret(env.ADSGRAM_REWARD_SECRET);
    if(!expectedSecret){
      console.error("[AdsGram] callback rejected: ADSGRAM_REWARD_SECRET is missing on the server");
      return json({error:"AdsGram reward callback is not configured"},503);
    }
    if(!secretMatches(suppliedKeys,expectedSecret)){
      const supplied=suppliedKeys[0]??"";
      console.error("[AdsGram] callback rejected: shared secret mismatch", {
        keyPresent:suppliedKeys.length>0,
        suppliedLength:normalizeSecret(supplied).length,
        expectedLength:expectedSecret.length,
        suppliedFingerprint:await secretFingerprint(supplied),
        expectedFingerprint:await secretFingerprint(expectedSecret),
        hint:"If lengths/fingerprints differ, the key in the AdsGram Reward URL is not the same as ADSGRAM_REWARD_SECRET on Render (check for a typo, a missing &key= or an old URL)."
      });
      return json({error:"Unauthorized"},401);
    }
    if(!/^[0-9]{1,19}$/.test(rawUserId)){
      console.error("[AdsGram] callback rejected: userid macro missing or invalid");
      return json({error:"Invalid Telegram user ID"},400);
    }
    const tgId=Number(rawUserId);
    if(!Number.isSafeInteger(tgId)){
      console.error("[AdsGram] callback rejected: userid is not a safe integer");
      return json({error:"Invalid Telegram user ID"},400);
    }
    const db=dbFor(env);
    try{
      const outcome=await txRun(db,async(tx)=>{
        const player=await playerRow(db,tgId,tx);
        if(!player)return {ok:false as const,status:404,error:"Player not found",reason:"player_not_found"};
        const now=Date.now();
        // AdsGram Reward URL identifies the Telegram user, not an individual ad session.
        // Consume that user's oldest eligible session first so delayed callbacks can be
        // processed in order while allowing the user to start another ad in the meantime.
        const pending=await tx.execute({sql:"SELECT id FROM ad_sessions WHERE tg_id=? AND status IN ('created','awaiting_postback') AND expires_at>=? ORDER BY created_at ASC,id ASC LIMIT 1",args:[tgId,now]});
        const session=pending.rows[0] as Row|undefined;
        if(!session){
          const recent=await tx.execute({sql:"SELECT id FROM ad_sessions WHERE tg_id=? AND status='rewarded' AND rewarded_at>? ORDER BY rewarded_at DESC LIMIT 1",args:[tgId,now-AD_TTL_MS]});
          if(recent.rows.length)return {ok:true as const,duplicate:true,disposition:"duplicate"};
          return {ok:false as const,status:409,error:"No eligible ad session",reason:"no_eligible_session"};
        }
        const claimed=await tx.execute({sql:"UPDATE ad_sessions SET status='rewarded',rewarded_at=? WHERE id=? AND tg_id=? AND status IN ('created','awaiting_postback') AND expires_at>=?",args:[now,String(session.id),tgId,now]});
        if(claimed.rowsAffected!==1)return {ok:false as const,status:409,error:"Ad reward session already consumed",reason:"session_already_consumed"};
        const linked=await tx.execute({sql:"SELECT * FROM game_sessions WHERE ad_session_id=? AND tg_id=? AND consumed_at IS NULL LIMIT 1",args:[String(session.id),tgId]});
        const game=linked.rows[0] as Row|undefined;
        let disposition="verified_game_active";
        if(game&&game.pending_score!=null&&game.pending_kills!=null){
          await settleGameResult(db,tx,tgId,game,Number(game.pending_score),Number(game.pending_kills));
          disposition="coins_settled";
        }else if(!game||Number(game.expires_at)<now){
          // Ads are on hold: a verified view with no game attached is recorded only.
          disposition="verified_no_game";
        }
        return {ok:true as const,duplicate:false,disposition};
      });
      if(!outcome.ok){
        console.warn("[AdsGram] callback rejected", { reason:outcome.reason, httpStatus:outcome.status });
        return json({error:outcome.error},outcome.status);
      }
      console.info("[AdsGram] callback accepted", { duplicate:outcome.duplicate, disposition:outcome.disposition });
      return json({ok:true,duplicate:outcome.duplicate,disposition:outcome.disposition});
    }finally{db.close();}
  }
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  let body:Record<string,any>;
  try{body=await request.json() as Record<string,any>;}catch{return json({error:"Invalid JSON body"},400);}

  // This endpoint is authorized only by a short-lived, single-use ticket created
  // after validating Telegram initData in the embedded Mini App.
  if(path==="/api/wallet/connect-external"){
    const ticket=typeof body.ticket==="string"?body.ticket:"";
    if(!/^[a-f0-9]{64}$/i.test(ticket))return json({error:"Invalid or expired wallet connection link."},400);
    let destination;
    try{destination=destinationInput(body);}catch(e){return json({error:e instanceof Error?e.message:"Invalid wallet destination."},400);}
    const db=dbFor(env);
    try{
      const ticketHash=await walletConnectTicketHash(ticket);
      const saved=await txRun(db,async(tx)=>{
        const selected=await tx.execute({sql:"SELECT tg_id FROM wallet_connect_tickets WHERE ticket_hash=? AND consumed_at IS NULL AND expires_at>?",args:[ticketHash,Date.now()]});
        const row=selected.rows[0] as Row|undefined;
        if(!row)throw new Error("Invalid or expired wallet connection link.");
        const consumedAt=Date.now();
        const consumed=await tx.execute({sql:"UPDATE wallet_connect_tickets SET consumed_at=? WHERE ticket_hash=? AND consumed_at IS NULL AND expires_at>?",args:[consumedAt,ticketHash,consumedAt]});
        if(consumed.rowsAffected!==1)throw new Error("This wallet connection link has already been used.");
        const tgId=Number(row.tg_id),updatedAt=new Date().toISOString();
        await tx.execute({sql:"INSERT INTO wallet_destinations (tg_id,address,asset,network,chain_id,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(tg_id) DO UPDATE SET address=excluded.address,asset=excluded.asset,network=excluded.network,chain_id=excluded.chain_id,updated_at=excluded.updated_at",args:[tgId,destination.address,destination.asset,destination.network,destination.chainId,updatedAt]});
        return {address:destination.address,asset:destination.asset,network:destination.network,chainId:destination.chainId,updatedAt};
      });
      return json({ok:true,destination:saved});
    }catch(e){
      const message=e instanceof Error?e.message:"Wallet connection could not be saved.";
      const status=/invalid or expired|already been used/i.test(message)?410:400;
      return json({error:message},status);
    }finally{db.close();}
  }
  let user:AuthUser;
  try{user=await verifyTelegram(body.initData,env);}catch(e){return json({error:e instanceof Error?e.message:"Authentication failed"},401);}
  const db=dbFor(env);
  try{
    if(path==="/api/me")return json(view(await ensurePlayer(db,user,typeof body.startParam==="string"?body.startParam:"")));

    if(path==="/api/wallet/connect-ticket"){
      const now=Date.now(),expiresAt=now+5*60_000,ticket=newWalletConnectTicket(),ticketHash=await walletConnectTicketHash(ticket);
      await db.execute({sql:"DELETE FROM wallet_connect_tickets WHERE expires_at<? OR created_at<?",args:[now-60_000,now-24*60*60_000]});
      await db.execute({sql:"INSERT INTO wallet_connect_tickets (ticket_hash,tg_id,created_at,expires_at,consumed_at) VALUES (?,?,?,?,NULL)",args:[ticketHash,user.id,now,expiresAt]});
      const base=env.APP_ORIGIN.replace(/\/+$/, "");
      return json({ticket,expiresAt,url:base+"/connect-wallet?ticket="+encodeURIComponent(ticket)});
    }
    if(path==="/api/wallet/connect-ticket/status"){
      const ticket=typeof body.ticket==="string"?body.ticket:"";
      if(!/^[a-f0-9]{64}$/i.test(ticket))return json({error:"Invalid wallet connection ticket."},400);
      const ticketHash=await walletConnectTicketHash(ticket);
      const result=await db.execute({sql:"SELECT t.consumed_at,t.expires_at,d.address,d.asset,d.network,d.chain_id AS chainId,d.updated_at AS updatedAt FROM wallet_connect_tickets t LEFT JOIN wallet_destinations d ON d.tg_id=t.tg_id WHERE t.ticket_hash=? AND t.tg_id=? AND t.created_at>?",args:[ticketHash,user.id,Date.now()-10*60_000]});
      const row=result.rows[0] as Row|undefined;
      if(!row)return json({error:"Wallet connection ticket not found."},404);
      const destination=row.address?{address:String(row.address),asset:"USDT",network:"BEP20",chainId:Number(row.chainId),updatedAt:String(row.updatedAt)}:null;
      return json({completed:row.consumed_at!=null,expired:row.consumed_at==null&&Number(row.expires_at)<=Date.now(),destination});
    }
    if(path==="/api/wallet/destination"){
      const result=await db.execute({sql:"SELECT address,asset,network,chain_id AS chainId,updated_at AS updatedAt FROM wallet_destinations WHERE tg_id=? LIMIT 1",args:[user.id]});
      return json({destination:result.rows[0]??null});
    }
    if(path==="/api/wallet/disconnect"){
      await db.execute({sql:"DELETE FROM wallet_destinations WHERE tg_id=?",args:[user.id]});
      return json({ok:true});
    }
    if(path==="/api/wallet/save"){
      const destination=destinationInput(body);
      await ensurePlayer(db,user);
      const updatedAt=new Date().toISOString();
      await db.execute({sql:"INSERT INTO wallet_destinations (tg_id,address,asset,network,chain_id,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(tg_id) DO UPDATE SET address=excluded.address,asset=excluded.asset,network=excluded.network,chain_id=excluded.chain_id,updated_at=excluded.updated_at",args:[user.id,destination.address,destination.asset,destination.network,destination.chainId,updatedAt]});
      return json({destination:{...destination,updatedAt}});
    }
    if(path==="/api/game/start-ad"){
      const adSessionId=typeof body.adSessionId==="string"?body.adSessionId.slice(0,64):"";
      if(!adSessionId)return json({error:"Ad session ID is required"},400);
      const result=await txRun(db,async(tx)=>{
        const p=await playerRow(db,user.id,tx);if(!p)throw new Error("Player not found");
        const now=Date.now();
        const selected=await tx.execute({sql:"SELECT status,expires_at FROM ad_sessions WHERE id=? AND tg_id=?",args:[adSessionId,user.id]});
        const ad=selected.rows[0] as Row|undefined;
        if(!ad)throw new Error("Ad session not found");
        if(Number(ad.expires_at)<now)throw new Error("Ad session expired. Please request a new ad.");
        if(p.last_play_date!==today())throw new Error("Play your one daily free game first. Ads unlock after that.");
        const status=String(ad.status);
        if(status!=="rewarded")
          throw new Error("Waiting for AdsGram server reward callback. The game cannot start until the reward is verified.");
        const active=await tx.execute({sql:"SELECT id,enemy_total,expires_at,ad_session_id FROM game_sessions WHERE tg_id=? AND consumed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1",args:[user.id,now]});
        if(active.rows.length){
          const existing=active.rows[0] as Row;
          if(String(existing.ad_session_id??"")===adSessionId){
            console.info("[AdsGram] verified game start reused existing session");
            return {gameId:String(existing.id),enemyTotal:Number(existing.enemy_total),expiresAt:Number(existing.expires_at)};
          }
          throw new Error("A game is already active");
        }
        const usedAd=await tx.execute({sql:"SELECT id FROM game_sessions WHERE ad_session_id=? AND tg_id=? LIMIT 1",args:[adSessionId,user.id]});
        if(usedAd.rows.length)throw new Error("This verified AdsGram reward has already been used.");
        if(p.ad_ready_at!=null&&Number(p.ad_ready_at)>now)
          throw new Error("Next ad unlocks soon — please wait");
        const spent=await tx.execute({sql:"UPDATE players SET extra_plays=extra_plays-1 WHERE tg_id=? AND extra_plays>0",args:[user.id]});
        if(spent.rowsAffected!==1)
          throw new Error("Verified AdsGram play is no longer available. Please refresh.");
        const usesExtra=1,linkedAdSessionId=adSessionId;
        const gameId=crypto.randomUUID();
        const enemyTotal=MIN_ENEMIES+(crypto.getRandomValues(new Uint32Array(1))[0]!%(MAX_ENEMIES-MIN_ENEMIES+1));
        const expiresAt=now+GAME_TTL_MS;
        await tx.execute({sql:"INSERT INTO game_sessions (id,tg_id,enemy_total,uses_extra_play,ad_session_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",args:[gameId,user.id,enemyTotal,usesExtra,linkedAdSessionId,now,expiresAt]});
        return {gameId,enemyTotal,expiresAt};
      });
      return json(result);
    }
    if(path==="/api/game/cancel"){
      const id=typeof body.gameId==="string"?body.gameId.slice(0,64):"";
      if(!id)return json({error:"Game session ID is required"},400);
      const result=await txRun(db,async(tx)=>{
        const selected=await tx.execute({sql:"SELECT * FROM game_sessions WHERE id=? AND tg_id=?",args:[id,user.id]});
        const session=selected.rows[0] as Row|undefined;
        if(!session)throw new Error("Game session not found");
        let player=await playerRow(db,user.id,tx);
        if(!player)throw new Error("Player not found");
        if(session.consumed_at!=null)return {...view(player),cancelled:false,alreadyFinished:true};
        const now=Date.now();
        const consumed=await tx.execute({sql:"UPDATE game_sessions SET consumed_at=?,pending_score=NULL,pending_kills=NULL WHERE id=? AND tg_id=? AND consumed_at IS NULL",args:[now,id,user.id]});
        if(consumed.rowsAffected!==1){
          player=await playerRow(db,user.id,tx);
          return {...view(player!),cancelled:false,alreadyFinished:true};
        }
        // An ad-unlocked game has already consumed its verified extra play.
        // Abandoning it awards no coins and starts the normal cooldown.
        if(Number(session.uses_extra_play)>0){
          const readyAt=now+AD_COOLDOWN_MS;
          await tx.execute({sql:"UPDATE players SET ad_ready_at=CASE WHEN ad_ready_at IS NULL OR ad_ready_at<? THEN ? ELSE ad_ready_at END WHERE tg_id=?",args:[readyAt,readyAt,user.id]});
        }
        player=await playerRow(db,user.id,tx);
        if(!player)throw new Error("Player not found");
        console.info("[Game] unfinished session cancelled without reward", { gameId:id, adUnlocked:Number(session.uses_extra_play)>0 });
        return {...view(player),cancelled:true,alreadyFinished:false};
      });
      return json(result);
    }
    if(path==="/api/game/start"){
      // Every tap on Play starts a match (no daily limit for now). An unfinished earlier
      // match (app closed mid-round) is closed without coins so it never blocks the next one.
      const result=await txRun(db,async(tx)=>{
        const p=await playerRow(db,user.id,tx);if(!p)throw new Error("Player not found");
        const now=Date.now();
        await tx.execute({sql:"UPDATE game_sessions SET consumed_at=?,pending_score=NULL,pending_kills=NULL WHERE tg_id=? AND consumed_at IS NULL AND uses_extra_play=0",args:[now,user.id]});
        await tx.execute({sql:"UPDATE players SET last_play_date=? WHERE tg_id=?",args:[today(),user.id]});
        const gameId=crypto.randomUUID();
        const enemyTotal=MIN_ENEMIES+(crypto.getRandomValues(new Uint32Array(1))[0]!%(MAX_ENEMIES-MIN_ENEMIES+1));
        const expiresAt=now+GAME_TTL_MS;
        await tx.execute({sql:"INSERT INTO game_sessions (id,tg_id,enemy_total,uses_extra_play,created_at,expires_at) VALUES (?,?,?,?,?,?)",args:[gameId,user.id,enemyTotal,0,now,expiresAt]});
        return {gameId,enemyTotal,expiresAt};
      });
      return json(result);
    }
    if(path==="/api/game/finish"){
      const id=typeof body.gameId==="string"?body.gameId.slice(0,64):"",kills=Number(body.kills),score=Number(body.score);
      if(!id||!Number.isInteger(kills)||!Number.isInteger(score)||score<0||score>100000)return json({error:"Invalid game result"},400);
      const result=await txRun(db,async(tx)=>{
        const selected=await tx.execute({sql:"SELECT * FROM game_sessions WHERE id=? AND tg_id=? AND consumed_at IS NULL AND expires_at>=?",args:[id,user.id,Date.now()]});
        const session=selected.rows[0] as Row|undefined;if(!session)throw new Error("Game session expired or already submitted");
        const total=Number(session.enemy_total);
        if(kills<0||kills>total||(kills>0&&score<kills*COINS_PER_KILL))throw new Error("Game result is not valid");
        // Waves come out one after another, so a real match can't be cleared faster than this.
        if(kills>0&&Date.now()-Number(session.created_at)<kills*MIN_MS_PER_KILL)throw new Error("Game result is not valid");
        if(session.pending_score!=null||session.pending_kills!=null)throw new Error("Game result is already waiting for ad verification");
        if(Number(session.uses_extra_play)===2){
          const ad=await tx.execute({sql:"SELECT status FROM ad_sessions WHERE id=? AND tg_id=?",args:[String(session.ad_session_id),user.id]});
          if(String(ad.rows[0]?.status)!=="rewarded"){
            await tx.execute({sql:"UPDATE game_sessions SET pending_score=?,pending_kills=? WHERE id=? AND tg_id=? AND consumed_at IS NULL",args:[score,kills,id,user.id]});
            const player=await playerRow(db,user.id,tx);if(!player)throw new Error("Player not found");
            console.info("[AdsGram] game result waiting for Reward URL verification", { kills, score });
            return {...view(player),reward:0,pendingVerification:true};
          }
        }
        return await settleGameResult(db,tx,user.id,session,score,kills);
      });
      return json(result);
    }
    if(path==="/api/ad/start"){
      if(!env.ADSGRAM_REWARD_SECRET)return json({error:"AdsGram server-side reward verification is not configured. Please contact support."},503);
      const result=await txRun(db,async(tx)=>{
        const p=await playerRow(db,user.id,tx);if(!p)throw new Error("Player not found");
        const now=Date.now();
        const adReadyAt=p.ad_ready_at==null?0:Number(p.ad_ready_at);
        console.info("[AdsGram] ad start eligibility", { adReadyAt, rewardSecretConfigured:Boolean(env.ADSGRAM_REWARD_SECRET) });
        if(adReadyAt>now)throw new Error("Next ad unlocks soon — please wait");
        await tx.execute({sql:"UPDATE ad_sessions SET status='expired' WHERE tg_id=? AND status IN ('created','awaiting_postback') AND expires_at<=?",args:[user.id,now]});
        const pending=await tx.execute({sql:"SELECT COUNT(*) AS total FROM ad_sessions WHERE tg_id=? AND status IN ('created','awaiting_postback') AND expires_at>?",args:[user.id,now]});
        // Reserve a maximum of MAX_EXTRA_PLAYS across verified plays plus in-flight
        // ad sessions. A missing/delayed postback must not hard-lock the next ad after one view.
        const pendingCount=Number(pending.rows[0]?.total??0);
        console.info("[AdsGram] ad start pending sessions", { pendingCount, maxPending:MAX_EXTRA_PLAYS });
        if(pendingCount>=MAX_EXTRA_PLAYS)
          throw new Error("You have reached the maximum number of pending or verified extra plays. Please wait for server confirmation.");
        const adSessionId=crypto.randomUUID(),expiresAt=now+AD_TTL_MS;
        await tx.execute({sql:"INSERT INTO ad_sessions (id,tg_id,status,created_at,expires_at) VALUES (?,?,'created',?,?)",args:[adSessionId,user.id,now,expiresAt]});
        console.info("[AdsGram] ad session created", { expiresAt });
        return {adSessionId,expiresAt};
      });
      return json(result);
    }
    if(path==="/api/ad/cancel"){
      const id=typeof body.adSessionId==="string"?body.adSessionId.slice(0,64):"";
      if(!id)return json({error:"Ad session ID is required"},400);
      const result=await txRun(db,async(tx)=>{
        const selected=await tx.execute({sql:"SELECT status,expires_at FROM ad_sessions WHERE id=? AND tg_id=?",args:[id,user.id]});
        const session=selected.rows[0] as Row|undefined;
        if(!session)throw new Error("Ad session not found");
        const status=String(session.status);
        if(status==="rewarded")return {...view((await playerRow(db,user.id,tx))!),verified:true,rewardPending:false,cancelled:false};
        if(status==="created"||status==="awaiting_postback"){
          await tx.execute({sql:"UPDATE ad_sessions SET status='cancelled' WHERE id=? AND tg_id=? AND status IN ('created','awaiting_postback')",args:[id,user.id]});
        }
        const player=await playerRow(db,user.id,tx);
        if(!player)throw new Error("Player not found");
        return {...view(player),verified:false,rewardPending:false,cancelled:true};
      });
      return json(result);
    }
    if(path==="/api/ad/complete"){
      const id=typeof body.adSessionId==="string"?body.adSessionId.slice(0,64):"";
      const result=await txRun(db,async(tx)=>{
        const selected=await tx.execute({sql:"SELECT status,expires_at FROM ad_sessions WHERE id=? AND tg_id=?",args:[id,user.id]});
        const session=selected.rows[0] as Row|undefined;
        if(!session)throw new Error("Ad session not found");
        if(Number(session.expires_at)<Date.now())throw new Error("Ad session expired");
        let status=String(session.status);
        if(status==="created"){
          const marked=await tx.execute({sql:"UPDATE ad_sessions SET status='awaiting_postback' WHERE id=? AND tg_id=? AND status='created' AND expires_at>=?",args:[id,user.id,Date.now()]});
          if(marked.rowsAffected===1){
            status="awaiting_postback";
            const now=Date.now(),readyAt=now+AD_WATCH_COOLDOWN_MS;
            await tx.execute({sql:"UPDATE players SET ad_ready_at=CASE WHEN ad_ready_at IS NOT NULL AND ad_ready_at>? THEN ad_ready_at ELSE ? END WHERE tg_id=?",args:[now,readyAt,user.id]});
          }
        }
        if(status!=="awaiting_postback"&&status!=="rewarded")throw new Error("Ad session is not eligible for reward");
        const player=await playerRow(db,user.id,tx);
        if(!player)throw new Error("Player not found");
        const verified=status==="rewarded";
        return {...view(player),verified,rewardPending:!verified};
      });
      return json(result);
    }
    if(path==="/api/ad/status"){
      const id=typeof body.adSessionId==="string"?body.adSessionId.slice(0,64):"";
      if(!id)return json({error:"Ad session ID is required"},400);
      const selected=await db.execute({sql:"SELECT status,expires_at FROM ad_sessions WHERE id=? AND tg_id=?",args:[id,user.id]});
      const session=selected.rows[0] as Row|undefined;
      if(!session)return json({error:"Ad session not found"},404);
      const player=await playerRow(db,user.id);
      if(!player)return json({error:"Player not found"},404);
      const status=String(session.status),expired=Number(session.expires_at)<Date.now()&&status!=="rewarded";
      return json({...view(player),verified:status==="rewarded",rewardPending:!expired&&status!=="rewarded",expired});
    }
    if(path==="/api/goal/claim"){
      const target=Number(body.target),rewardCents=DAILY_GOAL_REWARDS_CENTS[target];
      if(!rewardCents)return json({error:"Unknown daily goal"},400);
      try{
        const result=await txRun(db,async(tx)=>{
          const p=await playerRow(db,user.id,tx);if(!p)throw new Error("Player not found");
          const games=p.daily_games_date===today()?Number(p.daily_games):0;
          if(games<target)throw new Error(`Play ${target} games today to claim`);
          const claimed=claimedGoalsToday(p);
          if(claimed.includes(target))throw new Error("Already claimed today");
          await tx.execute({
            sql:"UPDATE players SET withdraw_balance_cents=withdraw_balance_cents+?,claimed_goals=?,claimed_goals_date=? WHERE tg_id=?",
            args:[rewardCents,[...claimed,target].join(","),today(),user.id]
          });
          return {...view((await playerRow(db,user.id,tx))!),balanceRewardCents:rewardCents};
        });
        return json(result);
      }catch(e){return json({error:e instanceof Error?e.message:"Claim failed"},400);}
    }
    if(path==="/api/bonus/claim"){
      const result=await txRun(db,async(tx)=>{
        const p=await playerRow(db,user.id,tx);if(!p)throw new Error("Player not found");
        if(p.daily_games_date!==today()||Number(p.daily_games)<DAILY_GAMES_GOAL)throw new Error("Play 100 games today to claim");
        if(p.bonus_claimed_date===today())throw new Error("Daily bonus already claimed");
        const amountCents=randomBonusCents();
        const claimed=await tx.execute({
          sql:"UPDATE players SET withdraw_balance_cents=withdraw_balance_cents+?,bonus_claimed_date=? WHERE tg_id=? AND (bonus_claimed_date IS NULL OR bonus_claimed_date<>?)",
          args:[amountCents,today(),user.id,today()]
        });
        if(claimed.rowsAffected!==1)throw new Error("Daily bonus already claimed");
        return {...view((await playerRow(db,user.id,tx))!),balanceBonusCents:amountCents};
      });
      return json(result);
    }
    if(path==="/api/leaderboard"){
      const sid=seasonId();
      const rows=await db.execute({sql:"SELECT tg_id,first_name,username,season_coins FROM players WHERE season_id=? AND games_played>=1 ORDER BY season_coins DESC,created_at ASC LIMIT 50",args:[sid]});
      return json({list:rows.rows.map((r:any,i:number)=>({rank:i+1,tgId:Number(r.tg_id),name:String(r.first_name),username:r.username==null?null:String(r.username),coins:Number(r.season_coins),prize:prize(i+1),isMe:Number(r.tg_id)===user.id})),seasonEndsAt:(sid+1)*SEASON_MS});
    }
    if(path==="/api/withdrawals"){
      const rows=await db.execute({sql:"SELECT id,coins,usd,wallet,status,created_at,payout_tx_hash,payout_asset,payout_network,payout_error,channel_post_url FROM withdrawals WHERE tg_id=? ORDER BY created_at DESC LIMIT 5",args:[user.id]});
      return json(rows.rows.map((r:any)=>({...r,coins:Number(r.coins),usd:Number(r.usd)})));
    }
    if(path==="/api/withdrawals/request"){
      const amounts=withdrawalAmountsFromUsd(body.usd);
      const wallet=typeof body.wallet==="string"?body.wallet.trim().slice(0,120):"";
      const isBep20Address=isBep20Destination(wallet);
      if(body.asset!=="USDT"||body.network!=="BEP20"||!amounts||!isBep20Address)
        return json({error:"Withdrawals require a valid BNB Smart Chain (BEP-20) address and an amount with up to two decimal places."},400);
      if(!parseAdminTelegramIds(env.ADMIN_TELEGRAM_IDS).length)
        return json({error:"Withdrawal approval is not configured yet. Please contact support; no coins or balance were deducted."},503);
      const {usd,usdCents,coins}=amounts;
      const withdrawalId=crypto.randomUUID(),createdAt=new Date().toISOString();
      const updatedPlayer=await txRun(db,async(tx)=>{
        const saved=await tx.execute({sql:"SELECT address,asset,network,chain_id FROM wallet_destinations WHERE tg_id=? LIMIT 1",args:[user.id]});
        const destination=saved.rows[0] as Row|undefined;
        if(!destination||String(destination.asset)!=="USDT"||String(destination.network)!=="BEP20"||Number(destination.chain_id)!==BSC_CHAIN_ID)
          throw new Error("Connect Trust Wallet and save your BEP-20 destination before withdrawing");
        if(String(destination.address).toLowerCase()!==wallet.toLowerCase())
          throw new Error("Wallet address changed. Reconnect Trust Wallet and try again.");
        const spent=await tx.execute({
          sql:"UPDATE players SET coins=coins-?,withdraw_balance_cents=withdraw_balance_cents-? WHERE tg_id=? AND coins>=? AND withdraw_balance_cents>=?",
          args:[coins,usdCents,user.id,coins,usdCents]
        });
        if(spent.rowsAffected!==1)throw new Error("Not enough coins or withdraw balance");
        await tx.execute({
          sql:"INSERT INTO withdrawals (id,tg_id,coins,usd,wallet,status,created_at,payout_asset,payout_network,payout_updated_at,balance_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          args:[withdrawalId,user.id,coins,usd,wallet,"pending_approval",createdAt,"USDT","BEP20",createdAt,usdCents]
        });
        await writePayoutEvent(tx,withdrawalId,"requested",{tgId:user.id,usd,usdCents,coins,at:createdAt});
        const player=await playerRow(db,user.id,tx);
        if(!player)throw new Error("Player not found");
        return view(player);
      });
      const notified=await notifyWithdrawalAdmins(env,{id:withdrawalId,tgId:user.id,name:user.firstName,username:user.username,usd,coins,wallet,createdAt});
      if(!notified){
        await txRun(db,async(tx)=>{
          const cancelled=await tx.execute({
            sql:"UPDATE withdrawals SET status='rejected',payout_error='Admin notification failed; reserved coins and withdraw balance refunded',payout_updated_at=? WHERE id=? AND status='pending_approval'",
            args:[new Date().toISOString(),withdrawalId]
          });
          if(cancelled.rowsAffected===1){
            const refund=await tx.execute({
              sql:"UPDATE players SET coins=coins+?,withdraw_balance_cents=withdraw_balance_cents+? WHERE tg_id=?",
              args:[coins,usdCents,user.id]
            });
            if(refund.rowsAffected!==1)throw new Error("Could not refund withdrawal after failed admin notification");
            await writePayoutEvent(tx,withdrawalId,"notification_failed",{tgId:user.id,refundCoins:coins,refundBalanceCents:usdCents,at:new Date().toISOString()});
          }
        });
        return json({error:"The owner could not be notified. Your coins and withdraw balance were returned. Open the Shooting Master bot and press Start, then try again."},503);
      }
      return json({ok:true,id:withdrawalId,status:"pending_approval",automatic:false,player:updatedPlayer});
    }
    return json({error:"Not found"},404);
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    console.error("[API error]", { path, name:e instanceof Error?e.name:"UnknownError", message, stack:e instanceof Error?e.stack:undefined });
    const conflict=/not enough|no plays|already|expired|unlock|watch an ad|play 100|maximum|active|waiting for server confirmation|full/i.test(message);
    return json({error:message},conflict?409:400);
  }finally{db.close();}
}
function addCors(request:Request,env:Env,response:Response){
  const origin=request.headers.get("origin");if(!origin)return response;
  if(origin!==env.APP_ORIGIN)return json({error:"Origin not allowed"},403);
  const h=new Headers(response.headers);h.set("access-control-allow-origin",origin);
  h.set("access-control-allow-methods","GET, POST, OPTIONS");h.set("access-control-allow-headers","content-type");
  h.set("access-control-max-age","86400");h.set("vary","Origin");
  return new Response(response.body,{status:response.status,headers:h});
}
async function recoverPendingPayouts(env:Env){
  if(!payoutConfigured(env))return;
  const db=dbFor(env);
  try{
    const cutoff=new Date(Date.now()-120_000).toISOString();
    const rows=await db.execute({
      sql:"SELECT id,tg_id,usd,coins,wallet,payout_asset,payout_network,created_at FROM withdrawals WHERE status IN ('pending_auto','processing') AND payout_updated_at<? ORDER BY created_at ASC LIMIT 20",
      args:[cutoff]
    });
    for(const row of rows.rows as Row[]){
      try{
        await env.PAYOUT_QUEUE.send({
          withdrawalId:String(row.id),tgId:Number(row.tg_id),usd:Number(row.usd),coins:Number(row.coins),
          wallet:String(row.wallet),asset:String(row.payout_asset) as "USDT",network:String(row.payout_network) as "BEP20",createdAt:String(row.created_at)
        } satisfies PayoutMessage);
        await db.execute({sql:"UPDATE withdrawals SET payout_updated_at=? WHERE id=? AND status IN ('pending_auto','processing')",args:[new Date().toISOString(),String(row.id)]});
        await writePayoutEvent(db,String(row.id),"requeued",{at:new Date().toISOString()});
      }catch(error){console.error("Could not recover queued payout",row.id,error);}
    }
  }finally{db.close();}
}

async function cleanup(env:Env){
  const db=dbFor(env);try{
    await db.batch([
      {sql:"DELETE FROM game_sessions WHERE expires_at < ?",args:[Date.now()-86400000]},
      {sql:"DELETE FROM ad_sessions WHERE expires_at < ?",args:[Date.now()-86400000]}
    ],"write");
  }finally{db.close();}
}
export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext){
    if(request.method==="OPTIONS"){
      const origin=request.headers.get("origin");if(origin&&origin!==env.APP_ORIGIN)return json({error:"Origin not allowed"},403);
      return new Response(null,{status:204,headers:{"access-control-allow-origin":origin??env.APP_ORIGIN,"access-control-allow-methods":"GET, POST, OPTIONS","access-control-allow-headers":"content-type","access-control-max-age":"86400","vary":"Origin"}});
    }
    try{return addCors(request,env,await api(request,env,ctx));}
    catch(e){console.error("Worker unavailable",e);return json({error:"Service temporarily unavailable"},503);}
  },
  async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){
    ctx.waitUntil(Promise.all([cleanup(env),recoverPendingPayouts(env),announceMissedPayouts(env)]));
  },
  async queue(batch:MessageBatch<PayoutMessage>,env:Env){
    const db=dbFor(env);try{
      for(const message of batch.messages){
        try{
          await processBep20Payout(message.body,env,db);
          message.ack();
        }catch(error){
          if(error instanceof PayoutSafetyError){
            try{await setPayoutForReview(db,message.body.withdrawalId,error.message);message.ack();}
            catch(dbError){console.error("Could not persist payout safety failure",dbError);message.retry({delaySeconds:60});}
          }else{
            console.error("Automatic BEP-20 payout attempt failed",message.body.withdrawalId,error);
            message.retry({delaySeconds:60});
          }
        }
      }
    }finally{db.close();}
  }
};
