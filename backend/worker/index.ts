import { createClient } from "@libsql/client/web";

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
}
const COINS_PER_KILL=10, MIN_ENEMIES=9, MAX_ENEMIES=12;
const DAILY_GAMES_GOAL=100, BONUS_MIN_COINS=1000, BONUS_MAX_COINS=5000;
const REFERRAL_REWARD=100, REFERRAL_GAMES_NEEDED=10, MAX_EXTRA_PLAYS=3;
const AD_COOLDOWN_MS=180000, SEASON_MS=172800000, GAME_TTL_MS=1200000, AD_TTL_MS=1800000;
type TelegramUser={id:number;first_name:string;username?:string;photo_url?:string};
type AuthUser={id:number;firstName:string;username:string|null;photoUrl:string|null};
type Row=Record<string,any>;
type PayoutMessage={withdrawalId:string;tgId:number;usd:number;coins:number;wallet:string;createdAt:string};

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
  const r=await (tx??db).execute({sql:"SELECT * FROM players WHERE tg_id=?",args:[tgId]});
  return r.rows[0] as Row|undefined;
}
function view(row:Row){
  const t=today(),sid=seasonId();
  return {tgId:Number(row.tg_id),name:String(row.first_name),username:row.username==null?null:String(row.username),
    coins:Number(row.coins),seasonCoins:Number(row.season_id)===sid?Number(row.season_coins):0,
    canPlayFree:row.last_play_date!==t,extraPlays:Number(row.extra_plays),gamesPlayed:Number(row.games_played),
    bestScore:Number(row.best_score),referralCount:Number(row.referral_count),photoUrl:row.photo_url==null?null:String(row.photo_url),
    adReadyAt:row.ad_ready_at==null?0:Number(row.ad_ready_at),
    dailyGames:row.daily_games_date===t?Number(row.daily_games):0,bonusClaimedToday:row.bonus_claimed_date===t};
}
async function ensurePlayer(db:any,user:AuthUser,startParam=""){
  let referrer:number|null=null;const m=/^ref_(\d+)$/.exec(startParam);
  if(m&&Number(m[1])!==user.id&&Number.isSafeInteger(Number(m[1])))referrer=Number(m[1]);
  await db.execute({sql:"INSERT OR IGNORE INTO players (tg_id,first_name,username,photo_url,referred_by,coins,season_coins,season_id,games_played,best_score,daily_games,extra_plays,referral_count,referral_paid,created_at) VALUES (?,?,?,?,?,0,0,?,0,0,0,0,0,0,?)",
    args:[user.id,user.firstName,user.username,user.photoUrl,referrer,seasonId(),new Date().toISOString()]});
  await db.execute({sql:"UPDATE players SET first_name=?,username=?,photo_url=? WHERE tg_id=?",args:[user.firstName,user.username,user.photoUrl,user.id]});
  const row=await playerRow(db,user.id);if(!row)throw new Error("Could not create player");return row;
}
async function txRun(db:any,fn:(tx:any)=>Promise<any>){
  const tx=await db.transaction("write");
  try{const value=await fn(tx);await tx.commit();return value;}
  catch(e){await tx.rollback();throw e;}
}
function prize(rank:number){
  if(rank<1||rank>30)return 0;
  const step=(30*0.5-10)/(30*29/2);
  return Math.max(0,0.5-(rank-1)*step);
}
function randomBonus(){return BONUS_MIN_COINS+Math.floor(Math.random()*((BONUS_MAX_COINS-BONUS_MIN_COINS)/100+1))*100;}
function walletValid(value:string){return /^0x[a-fA-F0-9]{40}$/.test(value)||/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);}

type StartKeyboardButton={text:string;url?:string;web_app?:{url:string}};
function telegramLink(value?:string):value is string{
  return typeof value==="string"&&/^https:\/\/t\.me\/[A-Za-z0-9_+.-]+(?:\?[A-Za-z0-9_=&%-]+)?$/.test(value);
}
async function telegramWebhook(request:Request,env:Env){
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  const received=request.headers.get("X-Telegram-Bot-Api-Secret-Token")||"";
  const expected=hex(await hmac(bytes(env.TELEGRAM_BOT_TOKEN),"shooting-master-telegram-webhook-v1"));
  if(!equal(received,expected))return json({error:"Unauthorized"},401);
  let update:Row;
  try{update=await request.json() as Row;}catch{return json({error:"Invalid update"},400);}
  const message=update.message as Row|undefined;
  const chat=message?.chat as Row|undefined;
  const command=typeof message?.text==="string"?message.text.trim():"";
  if(chat?.type!=="private"||!/^\/start(?:@\w+)?(?:\s|$)/i.test(command))return json({ok:true});
  const text=[
    "🪙 <b>EARN COINS:</b> Defeat enemies to earn 10 coins per kill and collect bonus rewards.",
    "💵 <b>DOLLAR BALANCE:</b> Your coins convert to dollars automatically — 100,000 coins = $1.",
    "💸 <b>WITHDRAW:</b> Submit a withdrawal request from $0.02; requests are sent automatically for manual review before payment."
  ].join("\n");
  const keyboard:StartKeyboardButton[][]=[
    [{text:"🎮 Open App",web_app:{url:env.APP_ORIGIN}}]
  ];
  if(telegramLink(env.OFFICIAL_CHANNEL_URL))keyboard.push([{text:"📢 Official Channel",url:env.OFFICIAL_CHANNEL_URL}]);
  if(telegramLink(env.OFFICIAL_GROUP_URL))keyboard.push([{text:"👥 Official Group",url:env.OFFICIAL_GROUP_URL}]);
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
  if(request.method==="GET"&&path==="/health")return json({ok:true,service:"shooting-master-api"});
  if(request.method==="GET"&&path==="/api/adsgram/reward"){
    const url=new URL(request.url);
    const suppliedKey=url.searchParams.get("key")||"";
    const rawUserId=url.searchParams.get("userid")||url.searchParams.get("userId")||"";
    if(!env.ADSGRAM_REWARD_SECRET)return json({error:"AdsGram reward callback is not configured"},503);
    if(!equal(suppliedKey,env.ADSGRAM_REWARD_SECRET))return json({error:"Unauthorized"},401);
    if(!/^[0-9]{1,19}$/.test(rawUserId))return json({error:"Invalid Telegram user ID"},400);
    const tgId=Number(rawUserId);
    if(!Number.isSafeInteger(tgId))return json({error:"Invalid Telegram user ID"},400);
    const db=dbFor(env);
    try{
      const outcome=await txRun(db,async(tx)=>{
        const player=await playerRow(db,tgId,tx);
        if(!player)return {ok:false as const,status:404,error:"Player not found"};
        const now=Date.now();
        const pending=await tx.execute({sql:"SELECT id FROM ad_sessions WHERE tg_id=? AND status IN ('created','awaiting_postback') AND expires_at>=? ORDER BY created_at DESC LIMIT 2",args:[tgId,now]});
        const session=pending.rows[0] as Row|undefined;
        if(!session){
          const recent=await tx.execute({sql:"SELECT id FROM ad_sessions WHERE tg_id=? AND status='rewarded' AND rewarded_at>? ORDER BY rewarded_at DESC LIMIT 1",args:[tgId,now-AD_TTL_MS]});
          if(recent.rows.length)return {ok:true as const,duplicate:true};
          return {ok:false as const,status:409,error:"No eligible ad session"};
        }
        if(pending.rows.length!==1)return {ok:false as const,status:409,error:"Multiple pending ad sessions"};
        const claimed=await tx.execute({sql:"UPDATE ad_sessions SET status='rewarded',rewarded_at=? WHERE id=? AND tg_id=? AND status IN ('created','awaiting_postback') AND expires_at>=?",args:[now,String(session.id),tgId,now]});
        if(claimed.rowsAffected!==1)return {ok:false as const,status:409,error:"Ad reward session already consumed"};
        const credited=await tx.execute({sql:"UPDATE players SET extra_plays=MIN(?,extra_plays+1) WHERE tg_id=?",args:[MAX_EXTRA_PLAYS,tgId]});
        if(credited.rowsAffected!==1)throw new Error("Player not found");
        return {ok:true as const,duplicate:false};
      });
      if(!outcome.ok)return json({error:outcome.error},outcome.status);
      return json({ok:true,duplicate:outcome.duplicate});
    }finally{db.close();}
  }
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  let body:Record<string,any>;
  try{body=await request.json() as Record<string,any>;}catch{return json({error:"Invalid JSON body"},400);}
  let user:AuthUser;
  try{user=await verifyTelegram(body.initData,env);}catch(e){return json({error:e instanceof Error?e.message:"Authentication failed"},401);}
  const db=dbFor(env);
  try{
    if(path==="/api/me")return json(view(await ensurePlayer(db,user,typeof body.startParam==="string"?body.startParam:"")));
    if(path==="/api/game/start"){
      const result=await txRun(db,async(tx)=>{
        const p=await playerRow(db,user.id,tx);if(!p)throw new Error("Player not found");
        const now=Date.now();
        const active=await tx.execute({sql:"SELECT id FROM game_sessions WHERE tg_id=? AND consumed_at IS NULL AND expires_at>? LIMIT 1",args:[user.id,now]});
        if(active.rows.length)throw new Error("A game is already active");
        const free=p.last_play_date!==today();let extra=0;
        if(free)await tx.execute({sql:"UPDATE players SET last_play_date=? WHERE tg_id=?",args:[today(),user.id]});
        else{
          if(Number(p.extra_plays)<=0)throw new Error("No plays left — watch an ad to play again");
          if(p.ad_ready_at!=null&&Number(p.ad_ready_at)>now)throw new Error("Next ad unlocks soon — please wait");
          const spent=await tx.execute({sql:"UPDATE players SET extra_plays=extra_plays-1 WHERE tg_id=? AND extra_plays>0",args:[user.id]});
          if(spent.rowsAffected!==1)throw new Error("No extra plays left");extra=1;
        }
        const gameId=crypto.randomUUID();
        const enemyTotal=MIN_ENEMIES+(crypto.getRandomValues(new Uint32Array(1))[0]!%(MAX_ENEMIES-MIN_ENEMIES+1));
        const expiresAt=now+GAME_TTL_MS;
        await tx.execute({sql:"INSERT INTO game_sessions (id,tg_id,enemy_total,uses_extra_play,created_at,expires_at) VALUES (?,?,?,?,?,?)",args:[gameId,user.id,enemyTotal,extra,now,expiresAt]});
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
        const used=await tx.execute({sql:"UPDATE game_sessions SET consumed_at=? WHERE id=? AND tg_id=? AND consumed_at IS NULL",args:[Date.now(),id,user.id]});
        if(used.rowsAffected!==1)throw new Error("Game result already submitted");
        const reward=kills*COINS_PER_KILL,sid=seasonId(),t=today();
        const cooldown=Number(session.uses_extra_play)===1?Date.now()+AD_COOLDOWN_MS:null;
        await tx.execute({sql:"UPDATE players SET coins=coins+?,season_coins=CASE WHEN season_id=? THEN season_coins+? ELSE ? END,season_id=?,games_played=games_played+1,best_score=MAX(best_score,?),daily_games=CASE WHEN daily_games_date=? THEN daily_games+1 ELSE 1 END,daily_games_date=?,ad_ready_at=? WHERE tg_id=?",
          args:[reward,sid,reward,reward,sid,score,t,t,cooldown,user.id]});
        let p=await playerRow(db,user.id,tx);
        if(p&&p.referred_by!=null&&Number(p.games_played)>=REFERRAL_GAMES_NEEDED&&Number(p.referral_paid)===0){
          const mark=await tx.execute({sql:"UPDATE players SET referral_paid=1 WHERE tg_id=? AND referral_paid=0",args:[user.id]});
          if(mark.rowsAffected===1){
            const referrer=Number(p.referred_by);
            await tx.execute({sql:"UPDATE players SET coins=coins+?,referral_count=referral_count+1 WHERE tg_id=?",args:[REFERRAL_REWARD,referrer]});
            await tx.execute({sql:"INSERT OR IGNORE INTO referral_rewards (referred_tg_id,referrer_tg_id,reward,created_at) VALUES (?,?,?,?)",args:[user.id,referrer,REFERRAL_REWARD,new Date().toISOString()]});
          }
        }
        p=await playerRow(db,user.id,tx);return {...view(p!),reward};
      });
      return json(result);
    }
    if(path==="/api/ad/start"){
      const result=await txRun(db,async(tx)=>{
        const p=await playerRow(db,user.id,tx);if(!p)throw new Error("Player not found");
        if(Number(p.extra_plays)>=MAX_EXTRA_PLAYS)throw new Error("You already have the maximum extra plays");
        if(p.ad_ready_at!=null&&Number(p.ad_ready_at)>Date.now())throw new Error("Next ad unlocks soon — please wait");
        const pending=await tx.execute({sql:"SELECT COUNT(*) AS total FROM ad_sessions WHERE tg_id=? AND status IN ('created','awaiting_postback') AND expires_at>?",args:[user.id,Date.now()]});
        if(Number(pending.rows[0]?.total??0)>=1)throw new Error("An ad session is already open");
        const adSessionId=crypto.randomUUID(),expiresAt=Date.now()+AD_TTL_MS;
        await tx.execute({sql:"INSERT INTO ad_sessions (id,tg_id,status,created_at,expires_at) VALUES (?,?,'created',?,?)",args:[adSessionId,user.id,Date.now(),expiresAt]});
        return {adSessionId,expiresAt};
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
          if(marked.rowsAffected===1)status="awaiting_postback";
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
    if(path==="/api/bonus/claim"){
      const result=await txRun(db,async(tx)=>{
        const p=await playerRow(db,user.id,tx);if(!p)throw new Error("Player not found");
        if(p.daily_games_date!==today()||Number(p.daily_games)<DAILY_GAMES_GOAL)throw new Error("Play 100 games today to claim");
        if(p.bonus_claimed_date===today())throw new Error("Daily bonus already claimed");
        const amount=randomBonus();
        await tx.execute({sql:"UPDATE players SET coins=coins+?,bonus_claimed_date=? WHERE tg_id=? AND (bonus_claimed_date IS NULL OR bonus_claimed_date<>?)",args:[amount,today(),user.id,today()]});
        return {...view((await playerRow(db,user.id,tx))!),bonus:amount};
      });
      return json(result);
    }
    if(path==="/api/leaderboard"){
      const sid=seasonId();
      const rows=await db.execute({sql:"SELECT tg_id,first_name,username,season_coins FROM players WHERE season_id=? AND season_coins>=500 ORDER BY season_coins DESC,created_at ASC LIMIT 50",args:[sid]});
      return json({list:rows.rows.map((r:any,i:number)=>({rank:i+1,tgId:Number(r.tg_id),name:String(r.first_name),username:r.username==null?null:String(r.username),coins:Number(r.season_coins),prize:prize(i+1),isMe:Number(r.tg_id)===user.id})),seasonEndsAt:(sid+1)*SEASON_MS});
    }
    if(path==="/api/withdrawals"){
      const rows=await db.execute({sql:"SELECT id,coins,usd,wallet,status,created_at FROM withdrawals WHERE tg_id=? ORDER BY created_at DESC LIMIT 50",args:[user.id]});
      return json(rows.rows.map((r:any)=>({...r,coins:Number(r.coins),usd:Number(r.usd)})));
    }
    if(path==="/api/withdrawals/request"){
      const usd=Math.floor(Number(body.usd)*100)/100,wallet=typeof body.wallet==="string"?body.wallet.trim().slice(0,120):"";
      if(!Number.isFinite(usd)||usd<0.02||!walletValid(wallet))return json({error:"Enter a valid wallet address and amount of at least $0.02"},400);
      const coins=Math.round(usd*100000),withdrawalId=crypto.randomUUID(),createdAt=new Date().toISOString();
      await txRun(db,async(tx)=>{
        const spent=await tx.execute({sql:"UPDATE players SET coins=coins-? WHERE tg_id=? AND coins>=?",args:[coins,user.id,coins]});
        if(spent.rowsAffected!==1)throw new Error("Not enough coins");
        await tx.execute({sql:"INSERT INTO withdrawals (id,tg_id,coins,usd,wallet,status,created_at) VALUES (?,?,?,?,?,'pending',?)",args:[withdrawalId,user.id,coins,usd,wallet,createdAt]});
      });
      if(env.PAYOUT_QUEUE)ctx.waitUntil(env.PAYOUT_QUEUE.send({withdrawalId,tgId:user.id,usd,coins,wallet,createdAt} satisfies PayoutMessage));
      return json({ok:true,id:withdrawalId,status:"pending"});
    }
    return json({error:"Not found"},404);
  }catch(e){
    console.error("API error",path,e);const message=e instanceof Error?e.message:"Request failed";
    const conflict=/not enough|no plays|already|expired|unlock|watch an ad|play 100|maximum|active/i.test(message);
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
  async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(cleanup(env));},
  async queue(batch:MessageBatch<PayoutMessage>,env:Env){
    const db=dbFor(env);try{
      for(const message of batch.messages){
        try{
          const p=message.body;
          await db.execute({sql:"INSERT OR IGNORE INTO payout_events (withdrawal_id,event_type,payload,created_at) VALUES (?,'queued',?,?)",args:[p.withdrawalId,JSON.stringify(p),new Date().toISOString()]});
          await db.execute({sql:"UPDATE withdrawals SET status='pending_review' WHERE id=? AND status='pending'",args:[p.withdrawalId]});
          message.ack();
        }catch(e){console.error("Payout queue event failed",e);message.retry();}
      }
    }finally{db.close();}
  }
};
