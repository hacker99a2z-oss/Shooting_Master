import { createClient } from "@libsql/client";
const base=process.env.SUPABASE_URL?.replace(/\/+$/,""),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const url=process.env.TURSO_DATABASE_URL,token=process.env.TURSO_AUTH_TOKEN;
if(!base||!key||!url||!token){console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");process.exit(1);}
const db=createClient({url,authToken:token});
async function fetchRows(table){
 const rows=[];for(let offset=0;;offset+=1000){
  const response=await fetch(base+"/rest/v1/"+table+"?select=*",{headers:{apikey:key,authorization:"Bearer "+key,range:offset+"-"+(offset+999),"range-unit":"items"}});
  if(!response.ok)throw new Error("Supabase export failed for "+table+": "+response.status+" "+await response.text());
  const page=await response.json();if(!Array.isArray(page))throw new Error("Unexpected export response");
  rows.push(...page);if(page.length<1000)break;
 }return rows;
}
try{
 const players=await fetchRows("players");
 for(const p of players){
  await db.execute({sql:"INSERT INTO players (tg_id,first_name,username,photo_url,coins,season_coins,season_id,games_played,best_score,last_play_date,extra_plays,ad_ready_at,daily_games,daily_games_date,bonus_claimed_date,referred_by,referral_count,referral_paid,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tg_id) DO UPDATE SET first_name=excluded.first_name,username=excluded.username,photo_url=excluded.photo_url,coins=excluded.coins,season_coins=excluded.season_coins,season_id=excluded.season_id,games_played=excluded.games_played,best_score=excluded.best_score,last_play_date=excluded.last_play_date,extra_plays=MIN(3,excluded.extra_plays),ad_ready_at=excluded.ad_ready_at,daily_games=excluded.daily_games,daily_games_date=excluded.daily_games_date,bonus_claimed_date=excluded.bonus_claimed_date,referred_by=excluded.referred_by,referral_count=excluded.referral_count,referral_paid=excluded.referral_paid",
  args:[Number(p.tg_id),p.first_name??"",p.username??null,p.photo_url??null,Number(p.coins??0),Number(p.season_coins??0),Number(p.season_id??0),Number(p.games_played??0),Number(p.best_score??0),p.last_play_date??null,Math.max(0,Math.min(3,Number(p.extra_plays??0))),p.ad_ready_at?new Date(p.ad_ready_at).getTime():null,Number(p.daily_games??0),p.daily_games_date??null,p.bonus_claimed_date??null,p.referred_by??null,Number(p.referral_count??0),p.referral_paid?1:0,p.created_at??new Date().toISOString()]});
 }
 const withdrawals=await fetchRows("withdrawals");
 for(const w of withdrawals)await db.execute({sql:"INSERT OR IGNORE INTO withdrawals(id,tg_id,coins,usd,wallet,status,created_at) VALUES(?,?,?,?,?,?,?)",args:[String(w.id),Number(w.tg_id),Number(w.coins),Number(w.usd),String(w.wallet),String(w.status??"pending"),String(w.created_at??new Date().toISOString())]});
 console.log("Imported "+players.length+" players and "+withdrawals.length+" withdrawal records.");
}finally{db.close();}
