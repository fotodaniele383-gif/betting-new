'use strict';
// R27: public fixture-level published xG, deliberately bounded to xG evidence only.
// Third-party Sportmonks totals republished by xGTables: NOT an official source and
// never an independent stake/quality authorization. No unofficial Understat scraping.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const VERSION = 'BETTINGAPP_R27_XGTABLES_PUBLISHED_XG_READTHROUGH_V1';
const HOST = 'www.xgtables.io';
const LEAGUES = Object.freeze({
  'Serie A': 'serie-a', 'Premier': 'epl', 'Premier League':'epl',
  'La Liga':'la-liga', 'Bundesliga':'bundesliga', 'Ligue 1':'ligue-1'
});
const MIN_TEAM_COUNT = 8;
const MIN_TEAM_MATCHES = 4;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const FRESH_TTL_MS = 6 * 3600 * 1000;
const MAX_CACHE_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_PUBLISHER_AGE_MS = 4 * 24 * 3600 * 1000;
const round=(n)=>Math.round(n*1000)/1000;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function seasonYear(now = new Date()) { const d=new Date(now); return d.getUTCMonth()>=6?d.getUTCFullYear():d.getUTCFullYear()-1; }
function normalize(s) {return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function nullableNumber(x){if(x === undefined || x === null || String(x).trim()==='' || String(x).trim()==='-')return null;const v=Number(x);return Number.isFinite(v)?v:null;}
function splitCsv(text){
 const records=[];let row=[],field='',quoted=false;
 const s=String(text||'').replace(/^\uFEFF/,'');
 for(let i=0;i<s.length;i++){
  const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){field+='"';i++}else quoted=!quoted}
  else if(c===','&&!quoted){row.push(field);field=''}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))records.push(row);row=[];field=''}
  else field+=c;
 }
 if(quoted)throw Error('XG_CSV_UNCLOSED_QUOTE');
 if(field||row.length){row.push(field);if(row.some(x=>x.trim()))records.push(row)}
 return records;
}
function value(row, headers, choices){for(const c of choices){const i=headers.indexOf(normalize(c));if(i>=0)return row[i]}return undefined}
function parseFixtureCsv(csv,{ league, year, now = new Date() }={}){
 const rows=splitCsv(csv);if(rows.length<2)throw Error('XG_CSV_NO_ROWS');
 const heads=rows[0].map(normalize);
 const get=(r,choices)=>value(r,heads,choices);
 const HOME=['home_team','home_name','home_team_name','hometeam','home','localteam','homeparticipant'];
 const AWAY=['away_team','away_name','away_team_name','awayteam','away','visitorteam','awayparticipant'];
 const HXG=['home_xg','home_expected_goals','home_xg_total','xg_home','homexg','expectedgoalshome','home_expected_goals_value'];
 const AXG=['away_xg','away_expected_goals','away_xg_total','xg_away','awayxg','expectedgoalsaway','away_expected_goals_value'];
 const DATE=['date','match_date','kickoff','kickoff_utc','starting_at','start_at','start_time','match_time','match_datetime'];
 const HG=['home_score','home_goals','home_ft','ft_home','home_score_ft','score_home','fulltime_home','home_result'];
 const AG=['away_score','away_goals','away_ft','ft_away','away_score_ft','score_away','fulltime_away','away_result'];
 const ID=['fixture_id','match_id','fixtureid','id'];
 for(const [name,alts] of Object.entries({HOME,AWAY,HXG,AXG,DATE,HG,AG})) if(alts.every(k=>!heads.includes(normalize(k)))) throw Error(`XG_CSV_SCHEMA_MISSING_${name}:`+rows[0].join('|').slice(0,350));
 const fixtures=[];const seen=new Set();const invalidReasons={};
 for(const r of rows.slice(1)){
  const reject=k=>{invalidReasons[k]=(invalidReasons[k]||0)+1};
  const home=String(get(r,HOME)||'').trim(),away=String(get(r,AWAY)||'').trim();
  const hxg=nullableNumber(get(r,HXG)),axg=nullableNumber(get(r,AXG));
  const hg=nullableNumber(get(r,HG)),ag=nullableNumber(get(r,AG));
  const dateStr=String(get(r,DATE)||'').trim(),dateMs=Date.parse(dateStr);
  if(!home||!away||normalize(home)===normalize(away)){reject('BAD_TEAMS');continue}
  if(hxg===null||axg===null){reject('MISSING_XG');continue}
  if(hxg<0||axg<0||hxg>7||axg>7){reject('IMPLAUSIBLE_XG');continue}
  if(hg===null||ag===null||!Number.isInteger(hg)||!Number.isInteger(ag)||hg<0||ag<0){reject('UNPLAYED_NO_SCORE');continue}
  if(!Number.isFinite(dateMs)||dateMs>new Date(now).getTime()-60*60*1000){reject('FUTURE_OR_INVALID_DATE');continue}
  const d=new Date(dateMs), y=d.getUTCFullYear(),mon=d.getUTCMonth();
  if((mon>=6?y:y-1)!==year){reject('WRONG_SEASON');continue}
  const key=String(get(r,ID)||'').trim()||(`${dateStr}|${normalize(home)}|${normalize(away)}`);
  if(seen.has(key)){reject('DUPLICATE');continue}seen.add(key);
  fixtures.push({home,away,homeXg:hxg,awayXg:axg,kickoff:d.toISOString(),fixtureId:key,homeGoals:hg,awayGoals:ag});
 }
 if(!fixtures.length)throw Error('XG_CSV_NO_COMPLETED_XG_FIXTURES');
 // A fixture contains xG for both teams, each side gives xG for and against.
 const teams={};for(const f of fixtures){for(const [name,xgf,xga] of [[f.home,f.homeXg,f.awayXg],[f.away,f.awayXg,f.homeXg]]){
  if(!teams[name])teams[name]={games:0,for:0,against:0,lastMatchAt:null};
  const t=teams[name];t.games++;t.for+=xgf;t.against+=xga;
  if(!t.lastMatchAt||t.lastMatchAt<f.kickoff)t.lastMatchAt=f.kickoff;
 }}
 const valid={};for(const [name,t] of Object.entries(teams))if(t.games>=MIN_TEAM_MATCHES)valid[name]={xG_for:round(t.for/t.games),xG_against:round(t.against/t.games),games:t.games,source:'XGTABLES_SPORTMONKS_PUBLISHED_FIXTURE_XG'};
 if(Object.keys(valid).length<MIN_TEAM_COUNT)throw Error('XG_CSV_COVERAGE_INSUFFICIENT:teams='+Object.keys(valid).length);
 const last=fixtures.reduce((best,f)=>best>f.kickoff?best:f.kickoff,'');
 return {teams:valid,fixtureCount:fixtures.length,teamCount:Object.keys(valid).length,lastObservedAt:last,invalidReasons,league,year,sourceSchemaSha256:hash(rows[0].join(','))};
}
function requestText(url,{timeoutMs=5000,requestText:mock}={}){
 if(mock){return mock(url)}
 return new Promise((resolve,reject)=>{
  let u;try{u=new URL(url)}catch{return reject(Error('XG_URL_INVALID'))}
  if(u.protocol!=='https:'||u.hostname!==HOST||u.port||u.username||u.password||!/^\/data\/v1\/[a-z0-9-]+\/20\d{2}\/fixtures\.csv$/.test(u.pathname))return reject(Error('XG_URL_NOT_ALLOWED'));
  const req=https.get(u,{timeout:timeoutMs,headers:{Accept:'text/csv, text/plain;q=0.8','User-Agent':'BettingApp-R27-XG-Research-ReadOnly/1.0'}},res=>{
   if(res.statusCode!==200){res.resume();return reject(Error('XG_HTTP_'+res.statusCode))}
   if(!/^(text\/csv|text\/plain|application\/csv)/i.test(String(res.headers['content-type']||''))){res.resume();return reject(Error('XG_NOT_CSV_CONTENT_TYPE'))}
   const out=[];let size=0;res.on('data',c=>{size+=c.length;if(size>MAX_RESPONSE_BYTES)req.destroy(Error('XG_CSV_TOO_LARGE'));else out.push(c)});
   res.on('end',()=>resolve(Buffer.concat(out).toString('utf8')));
  });req.on('timeout',()=>req.destroy(Error('XG_TIMEOUT')));req.on('error',reject);
 });
}
function cacheFile(slug,opts={}){return path.join(opts.cacheDir||path.join(__dirname,'data','calcio_xg_xgtables_r27'),slug+'.json')}
function safeRead(p){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return null}}
function checkedCache(c,{slug,year,now,allowStale=false}={}){
 if(!c||c.version!==VERSION||c.slug!==slug||c.year!==year||c.provenance!=='xGTables (Sportmonks published)'||!c.payload||!c.sha256)return null;
 const age=new Date(now).getTime()-Date.parse(c.fetchedAt||'');
 if(!Number.isFinite(age)||age<0||age>(allowStale?MAX_CACHE_AGE_MS:FRESH_TTL_MS))return null;
 if(hash(c.csv)!==c.sha256)return null;
 try{const parsed=parseFixtureCsv(c.csv,{league:slug,year,now});if(parsed.teamCount!==c.payload.teamCount)return null;return {parsed,age}}catch{return null}
}
function atomicStore(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data)+'\n',{flag:'wx'});try{fs.renameSync(tmp,file)}finally{try{fs.unlinkSync(tmp)}catch{}}}
function result(parsed,{year,slug,status,fetchedAt,fromCache,error}={}){return {
 teams:parsed.teams,state:{version:VERSION,providerId:'XGTABLES_PUBLIC',providerFamily:'SPORTMONKS_PUBLISHED_XG',
 status,sourceClass:'LKG_CERTIFIED',evidenceClass:'PUBLISHED_CURRENT_SEASON_XG_THIRD_PARTY',
 sourceUrl:`https://${HOST}/data/v1/${slug}/${year}/fixtures.csv`,sourceAttribution:'xGTables / Sportmonks',
 seasonStart:year,seasonName:`${year}/${year+1}`,teamCount:parsed.teamCount,observedFixtures:parsed.fixtureCount,
 lastObservedAt:parsed.lastObservedAt,fetchedAt,fromCache:!!fromCache,error:error||null,
 sourceSchemaSha256:parsed.sourceSchemaSha256,qualityScope:'PUBLISHED_POST_MATCH_REFERENCE_NOT_OFFICIAL',
 directStakeAuthority:false,directGateAuthority:false}
}}
async function getLeagueXg(leagueName, opts={}){
 const slug=LEAGUES[leagueName],now=opts.now||new Date(),year=seasonYear(now);
 if(!slug)return {teams:{},state:{version:VERSION,status:'UNSUPPORTED_LEAGUE',sourceClass:'NONE',providerId:'XGTABLES_PUBLIC',leagueName}};
 const file=cacheFile(slug,opts),cache=safeRead(file),fresh=checkedCache(cache,{slug,year,now});
 if(fresh&&!opts.force)return result(fresh.parsed,{year,slug,status:'PUBLISHED_CURRENT_CACHE',fetchedAt:cache.fetchedAt,fromCache:true});
 try{
  const url=`https://${HOST}/data/v1/${slug}/${year}/fixtures.csv`;
  const csv=await requestText(url,opts);
  const parsed=parseFixtureCsv(csv,{league:leagueName,year,now});
  const fetchedAt=new Date(now).toISOString();
  const c={version:VERSION,slug,year,provenance:'xGTables (Sportmonks published)',fetchedAt,sha256:hash(csv),csv,payload:{teamCount:parsed.teamCount,fixtureCount:parsed.fixtureCount}};
  if(opts.persistCache!==false)atomicStore(file,c);
  return result(parsed,{year,slug,status:'PUBLISHED_CURRENT_FETCH',fetchedAt,fromCache:false});
 }catch(e){
  const stale=checkedCache(cache,{slug,year,now,allowStale:true});
  if(stale)return result(stale.parsed,{year,slug,status:'PUBLISHED_LKG_AFTER_ERROR',fetchedAt:cache.fetchedAt,fromCache:true,error:String(e.message).slice(0,220)});
  return {teams:{},state:{version:VERSION,providerId:'XGTABLES_PUBLIC',status:'UNAVAILABLE',sourceClass:'NONE',leagueName,seasonStart:year,error:String(e.message).slice(0,220),directStakeAuthority:false,directGateAuthority:false}};
 }
}
module.exports={VERSION,LEAGUES,MIN_TEAM_COUNT,parseFixtureCsv,splitCsv,requestText,getLeagueXg,cacheFile,checkedCache,seasonYear};
