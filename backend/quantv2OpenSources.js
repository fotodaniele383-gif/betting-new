/**
 * Raccolta SOLO di dataset pubblicati per download senza account/key.
 * Nessuno scraping di siti editoriale (copyright/robots) o bypass WAF.
 * Non modifica il DB operativo, non avvia schedulers, nessun dato artificiale.
 */
'use strict';
const fs=require('node:fs');const path=require('node:path');const https=require('node:https');const crypto=require('node:crypto');
const VERSION='BETTINGAPP_QUANTV2_PUBLIC_DATA_R1';
const SOURCES=Object.freeze({
 openfootball_seriea:{sport:'CALCIO',licence:'CC0-1.0',access:'PUBLIC_DATASET',auto:true,
  url:'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/it.1.json',kind:'openfootball'},
 openfootball_seriea_previous:{sport:'CALCIO',licence:'CC0-1.0',access:'PUBLIC_DATASET',auto:true,
  url:'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/it.1.json',kind:'openfootball'},
 openfootball_epl:{sport:'CALCIO',licence:'CC0-1.0',access:'PUBLIC_DATASET',auto:true,
  url:'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/en.1.json',kind:'openfootball'},
 openfootball_epl_previous:{sport:'CALCIO',licence:'CC0-1.0',access:'PUBLIC_DATASET',auto:true,
  url:'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/en.1.json',kind:'openfootball'},
 statsbomb_competitions:{sport:'CALCIO',licence:'STATS_BOMB_OPEN_DATA_ATTRIBUTION',access:'RESEARCH_OPEN_DATA',auto:true,
  url:'https://raw.githubusercontent.com/hudl/open-data/master/data/competitions.json',kind:'statsbomb_competitions'},
 baseline_tennis_ratings:{sport:'TENNIS',licence:'CC-BY-SA-4.0_ATTRIBUTION_SHAREALIKE',access:'PUBLIC_DATASET',auto:false,
  url:'https://baseline-today.vercel.app/data/ratings.json',kind:'baseline_ratings'},
 // Pagine leggibili ma NON autorizzate automaticamente: solo import CSV/JSON ottenuto legalmente.
 besoccer:{sport:'CALCIO',access:'LICENSE_REQUIRED',auto:false,fields:['lineups','player_ratings']},
 aiscore:{sport:'CALCIO',access:'RIGHTS_UNVERIFIED',auto:false,fields:['lineups','ratings']},
 gazzetta:{sport:'CALCIO',access:'RIGHTS_UNVERIFIED',auto:false,fields:['predicted_lineups','injuries']},
 tuttomercatoweb:{sport:'CALCIO',access:'RIGHTS_UNVERIFIED',auto:false,fields:['ratings','formations']},
 goal:{sport:'CALCIO',access:'RIGHTS_UNVERIFIED',auto:false,fields:['ratings','formations']},
 sky_sport:{sport:'CALCIO',access:'RIGHTS_UNVERIFIED',auto:false,fields:['player_ratings']},
 pianetafanta:{sport:'CALCIO',access:'RIGHTS_UNVERIFIED',auto:false,fields:['predicted_lineups','ratings']},
 fantacalcio_online:{sport:'CALCIO',access:'RIGHTS_UNVERIFIED',auto:false,fields:['lineups','starter_probabilities','ratings']},
 soccerway:{sport:'CALCIO',access:'RIGHTS_UNVERIFIED',auto:false,fields:['match_lineups']},
  '11v11':{sport:'CALCIO',access:'RIGHTS_UNVERIFIED',auto:false,fields:['historical_lineups']},
 tennisexplorer:{sport:'TENNIS',access:'RIGHTS_UNVERIFIED',auto:false,fields:['h2h','surface','form']},
 tennistemple:{sport:'TENNIS',access:'RIGHTS_UNVERIFIED',auto:false,fields:['results','h2h']},
 tennisabstract:{sport:'TENNIS',access:'RIGHTS_UNVERIFIED',auto:false,fields:['elo','surface_elo']},
 flashscore:{sport:'CALCIO/TENNIS',access:'AUTOMATED_COLLECTION_RESTRICTED',auto:false},
 sofascore:{sport:'CALCIO/TENNIS',access:'AUTOMATED_COLLECTION_RESTRICTED',auto:false}
});
const ALLOW_HOSTS=new Set(['raw.githubusercontent.com','baseline-today.vercel.app']);
const MAX_BYTES=3*1024*1024;
function fetchJson(url,options={}){
 const request=options.request||https.request;
 const u=new URL(url);
 if(u.protocol!=='https:'||!ALLOW_HOSTS.has(u.hostname)||u.username||u.password)throw Error('UNAPPROVED_DATA_SOURCE_URL');
 return new Promise((resolve,reject)=>{
  const req=request(u,{method:'GET',timeout:options.timeoutMs||8000,headers:{'Accept':'application/json','User-Agent':'BettingApp-PublicDataset-Reader/1.0'}},res=>{
   const code=res.statusCode;
   if(code!==200){res.resume();const e=Error('HTTP_'+code);e.status=code;reject(e);return;}
   let size=0;let chunks=[];res.on('data',ch=>{size+=ch.length;if(size>MAX_BYTES){req.destroy(Error('SOURCE_TOO_LARGE'));return;}chunks.push(ch);});
   res.on('end',()=>{try{const body=Buffer.concat(chunks).toString('utf8');resolve(JSON.parse(body));}catch(e){reject(e);}});
   res.on('error',reject);
  });
  req.on('timeout',()=>req.destroy(Error('SOURCE_TIMEOUT')));
  req.on('error',reject);req.end();
 });
}
function parse(sourceId,raw){
 const source=SOURCES[sourceId];if(!source||!source.auto&&!['baseline_tennis_ratings'].includes(sourceId))throw Error('SOURCE_NOT_AUTOMATED');
 let rows=[];
 if(source.kind==='openfootball'){
  if(!raw||!Array.isArray(raw.matches))throw Error('INVALID_OPENFOOTBALL_FORMAT');
  rows=raw.matches.map(m=>({date:m.date,home:m.team1,away:m.team2,
   score:Array.isArray(m.score?.ft)?m.score.ft:(Array.isArray(m.score)?m.score:null),round:m.round})).filter(m=>
   /^\d{4}-\d\d-\d\d$/.test(String(m.date||''))&&typeof m.home==='string'&&typeof m.away==='string');
 }else if(source.kind==='statsbomb_competitions'){
  if(!Array.isArray(raw))throw Error('INVALID_STATSBOMB_FORMAT');
  rows=raw.map(c=>({competition_id:c.competition_id,season_id:c.season_id,
   competition_name:c.competition_name,season_name:c.season_name})).filter(x=>Number.isInteger(x.competition_id));
 }else if(source.kind==='baseline_ratings'){
  if(!Array.isArray(raw))throw Error('INVALID_BASELINE_FORMAT');
  rows=raw.map(v=>({tour:v.tour,player:v.player,elo:v.elo,elo_hard:v.elo_hard,
   elo_clay:v.elo_clay,elo_grass:v.elo_grass,source:v.source,license:v.license})).filter(v=>typeof v.player==='string'&&Number.isFinite(Number(v.elo)));
 }else throw Error('UNKNOWN_FORMAT');
 if(!rows.length)throw Error('EMPTY_SOURCE_DATA');
 return {version:VERSION,sourceId,sourceUrl:source.url,licence:source.licence,recordCount:rows.length,rows};
}
async function sync(sourceId,root=path.join(__dirname,'quantv2_data'),options={}){
 const source=SOURCES[sourceId];if(!source||source.auto!==true)throw Error('SOURCE_NOT_AUTOMATED');
 const raw=await fetchJson(source.url,options);const data=parse(sourceId,raw);
 const text=JSON.stringify({...data,fetchedAt:new Date().toISOString()},null,0);
 const integrity=crypto.createHash('sha256').update(text).digest('hex');
 fs.mkdirSync(root,{recursive:true});
 const target=path.join(root,sourceId+'.json');const temporary=target+'.tmp-'+process.pid;
 fs.writeFileSync(temporary,text,{flag:'wx'});fs.renameSync(temporary,target);
 return {sourceId,recordCount:data.recordCount,sha256:integrity,path:target,licence:data.licence};
}
function read(sourceId,root=path.join(__dirname,'quantv2_data')){
 if(!SOURCES[sourceId])throw Error('UNKNOWN_SOURCE');
 const target=path.join(root,sourceId+'.json');
 if(!fs.existsSync(target))return null;
 const data=JSON.parse(fs.readFileSync(target,'utf8'));
 if(data.sourceId!==sourceId||!Array.isArray(data.rows))throw Error('CORRUPT_CACHE');
 return data;
}
function parseStatsBombMatches(competitionId,seasonId,raw){
 if(!Array.isArray(raw))throw Error('INVALID_STATSBOMB_MATCHES');
 const rows=raw.map(m=>({match_id:m.match_id,match_date:m.match_date,
  kick_off:m.kick_off,home_team:m.home_team?.home_team_name,
  away_team:m.away_team?.away_team_name,home_score:m.home_score,away_score:m.away_score}))
  .filter(m=>Number.isInteger(m.match_id)&&m.home_team&&m.away_team);
 if(!rows.length)throw Error('EMPTY_STATSBOMB_MATCHES');
 return {version:VERSION,sourceId:`statsbomb_matches_${competitionId}_${seasonId}`,sourceUrl:`https://raw.githubusercontent.com/hudl/open-data/master/data/matches/${competitionId}/${seasonId}.json`,licence:'STATS_BOMB_OPEN_DATA_ATTRIBUTION',recordCount:rows.length,rows};
}
function parseStatsBombLineups(matchId,raw){
 if(!Array.isArray(raw)||raw.length<2)throw Error('INVALID_STATSBOMB_LINEUPS');
 const rows=raw.map(team=>({team_id:team.team_id,team_name:team.team_name,
  players:(team.lineup||[]).map(p=>({player_id:p.player_id,player_name:p.player_name,
   player_nickname:p.player_nickname,jersey_number:p.jersey_number,positions:p.positions||[]}))})).filter(v=>v.team_name&&v.players.length);
 if(rows.length!==2)throw Error('INCOMPLETE_STATSBOMB_LINEUPS');
 return {version:VERSION,sourceId:`statsbomb_lineups_${matchId}`,sourceUrl:`https://raw.githubusercontent.com/hudl/open-data/master/data/lineups/${matchId}.json`,licence:'STATS_BOMB_OPEN_DATA_ATTRIBUTION',recordCount:rows.length,rows};
}
function writeData(data,root=path.join(__dirname,'quantv2_data')){
 const text=JSON.stringify({...data,fetchedAt:new Date().toISOString()});
 const integrity=crypto.createHash('sha256').update(text).digest('hex');
 fs.mkdirSync(root,{recursive:true});const target=path.join(root,data.sourceId+'.json');
 const temporary=target+'.tmp-'+process.pid;fs.writeFileSync(temporary,text,{flag:'wx'});
 fs.renameSync(temporary,target);return {sourceId:data.sourceId,recordCount:data.recordCount,
   sha256:integrity,path:target,licence:data.licence};
}
async function syncStatsBomb(competitionId,seasonId,matchId,root,options={}){
 if(!Number.isSafeInteger(competitionId)||competitionId<1||!Number.isSafeInteger(seasonId)||seasonId<1)throw Error('INVALID_STATSBOMB_IDS');
 const kind=matchId==null?'matches':'lineups';
 if(matchId!=null&&(!Number.isSafeInteger(matchId)||matchId<1))throw Error('INVALID_STATSBOMB_MATCH_ID');
 const url=kind==='matches'?`https://raw.githubusercontent.com/hudl/open-data/master/data/matches/${competitionId}/${seasonId}.json`
  :`https://raw.githubusercontent.com/hudl/open-data/master/data/lineups/${matchId}.json`;
 const raw=await fetchJson(url,options);
 const data=kind==='matches'?parseStatsBombMatches(competitionId,seasonId,raw):parseStatsBombLineups(matchId,raw);
 return writeData(data,root);
}
function importLocal(sourceId,filename,root){
 // Solo file ottenuti o esportati direttamente dall'utente con diritti adeguati.
 // Non attiva scraping o scheduler; l'utente conserva gli obblighi di attribuzione.
 if(sourceId!=='baseline_tennis_ratings')throw Error('LOCAL_IMPORT_SOURCE_NOT_SUPPORTED');
 if(path.extname(filename).toLowerCase()!=='.json')throw Error('LOCAL_IMPORT_REQUIRES_JSON');
 const stats=fs.statSync(filename);if(stats.size>MAX_BYTES)throw Error('LOCAL_IMPORT_TOO_LARGE');
 const data=parse(sourceId,JSON.parse(fs.readFileSync(filename,'utf8')));
 return writeData(data,root);
}
function getHistoricalForm(sourceId,home,away,asOf,root){
 const data=read(sourceId,root);if(!data)return null;
 const date=String(asOf||'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const clean=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
 const summary=(team)=>{
   const rows=data.rows.filter(r=>r.date<date&&Array.isArray(r.score)&&r.score.length===2&&
        (clean(r.home)===clean(team)||clean(r.away)===clean(team))).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
   const points=rows.reduce((sum,m)=>{const isHome=clean(m.home)===clean(team),a=Number(m.score[isHome?0:1]),b=Number(m.score[isHome?1:0]);return sum+(a>b?3:a===b?1:0)},0);
   return {matches:rows.length,points,lastDate:rows[0]?.date||null};
 };
 return {sourceId,asOf:date,home:summary(home),away:summary(away),authority:'RESEARCH_CONTEXT_ONLY_NOT_MODEL_PROBABILITY'};
}
function report(){return Object.entries(SOURCES).map(([id,s])=>({id,sport:s.sport,
  automatic:s.auto===true,access:s.access,licence:s.licence||null,
  status:s.auto?'DOWNLOAD_SUPPORTED_NOT_LIVE_CERTIFIED':'MANUAL_OR_RIGHTS_REQUIRED'}));}
module.exports={VERSION,SOURCES,fetchJson,parse,sync,read,report,parseStatsBombMatches,parseStatsBombLineups,syncStatsBomb,importLocal,getHistoricalForm};
