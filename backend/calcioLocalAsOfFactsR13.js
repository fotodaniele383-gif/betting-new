'use strict';
// R13: local Football-Data CSV => factual, reproducible, pre-kickoff snapshots.
// It NEVER predicts odds, alters a probability, and NEVER writes to database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const team=require('./calcioTeamSnapshot');
const VERSION='BETTINGAPP_R13_ASOF_FACTS_V1';
const CACHE=new Map();
function fileForLeague(league=''){
 const s=String(league).toLowerCase();
 let code=null;
 if(/serie\s*a\b|italy\s*serie\s*a|italia\s*serie\s*a/.test(s))code='I1';
 else if(/serie\s*b\b/.test(s))code='I2';
 else if(/premier\s*league/.test(s))code='E0';
 else if(/bundesliga/.test(s))code='D1';
 else if(/la\s*liga/.test(s))code='SP1';
 else if(/ligue\s*1/.test(s))code='F1';
 return code?{code,file:path.resolve(__dirname,'data','calcio_football_data',code+'.csv')}:null;
}
function getIndex(config){
 if(!config || !fs.existsSync(config.file))return null;
 const info=fs.statSync(config.file);if(!info.isFile()||info.size>4*1024*1024)return null;
 const key=config.file+'|'+info.mtimeMs+'|'+info.size;
 if(CACHE.has(key))return CACHE.get(key);
 const csv=fs.readFileSync(config.file,'utf8');
 const index=team.getLeagueIndex({csvData:csv,code:config.code,leagueName:config.code,revisionToken:crypto.createHash('sha256').update(csv).digest('hex').slice(0,24)});
 CACHE.clear();CACHE.set(key,index);return index;
}
function validKickoff(k){const d=k instanceof Date?k:new Date(k);return Number.isFinite(d.getTime())&&d.getUTCFullYear()>=2000&&d.getUTCFullYear()<=2100?d:null}
function asOfFacts({home,away,league,kickoff}={}){
 const config=fileForLeague(league),cutoff=validKickoff(kickoff);
 if(!config||!cutoff)return {version:VERSION,status:'UNAVAILABLE',reason:'LEAGUE_OR_DATE_NOT_MAPPED'};
 try{
 const index=getIndex(config);if(!index||!index.matches.length)return {version:VERSION,status:'UNAVAILABLE',reason:'NO_VALID_LOCAL_CSV'};
 // Football-Data Date has day-level precision. Exclude the entire match-day
 // rather than assuming a fabricated match kickoff (prevents as-of leakage).
 const exclusiveDayStart=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth(),cutoff.getUTCDate(),0,0,0));
 const s=team.buildMatchSnapshots(index,String(home||''),String(away||''),exclusiveDayStart);
 if(!s.home.matched||!s.away.matched||s.home.resolvedTeam===s.away.resolvedTeam)return {version:VERSION,status:'UNAVAILABLE',reason:'TEAM_IDENTITY_NOT_MATCHED'};
 const project=(t,venue)=>({team:t.resolvedTeam,matched:t.matched,seasonSample:t.season.sample,seasonGoalsFor:t.season.goalsForPerMatch,seasonGoalsAgainst:t.season.goalsAgainstPerMatch,last10Sample:t.last10.sample,last10GoalsFor:t.last10.goalsForPerMatch,last10GoalsAgainst:t.last10.goalsAgainstPerMatch,venueSample:t[venue].sample,venueGoalsFor:t[venue].goalsForPerMatch,venueGoalsAgainst:t[venue].goalsAgainstPerMatch,venueOver25Pct:t[venue].over25Pct,observedXgSample:t.season.xgSample,observedXgFor:t.season.xgForPerMatch,observedXgAgainst:t.season.xgAgainstPerMatch,venueXgSample:t[venue].xgSample,venueXgFor:t[venue].xgForPerMatch,venueXgAgainst:t[venue].xgAgainstPerMatch,lastObservedAt:t.season.lastMatchAt});
 return {version:VERSION,status:'AS_OF_LOCAL_RESULTS_ONLY',leagueCode:config.code,source:'FOOTBALL_DATA_LOCAL_CSV',sourceRevision:index.revisionToken,cutoffAt:exclusiveDayStart.toISOString(),excludedFutureResults:true,home:project(s.home,'home'),away:project(s.away,'away'),note:'Only historical FT results and published HxG/AxG observations strictly BEFORE the kickoff calendar day; xG provider is SECONDARY Football-Data, NOT primary Understat certified, and NOT model calibration. Cache may be stale.'};
 }catch(e){return {version:VERSION,status:'UNAVAILABLE',reason:'LOCAL_CSV_INVALID',detail:String(e.message).slice(0,100)};}
}
module.exports={VERSION,asOfFacts,fileForLeague};
