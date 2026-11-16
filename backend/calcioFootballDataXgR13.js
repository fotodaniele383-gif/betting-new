'use strict';
// Secondary, publisher-observed xG: no fabricated values, no implied Understat
// certification. Source: official Football-Data season CSV HxG/AxG, metadata.
const fd=require('./calcioFootballDataProvider');
const fs=require('node:fs');
const snapshots=require('./calcioTeamSnapshot');
const VERSION='BETTINGAPP_R13_FOOTBALL_DATA_PUBLISHED_XG_V1';
function validMetadata(local,code,now){
 const m=local?.metadata||{};
 let stored={};
 try{stored=JSON.parse(fs.readFileSync(local?.paths?.metaPath,'utf8'))}catch(_){}
 if(!local?.valid||!stored.sha256||stored.sha256!==local.inspection.sha256
    || stored.source!=='NETWORK' || stored.url!==`https://www.football-data.co.uk/mmz4281/${stored.season}/${code}.csv`) return {ok:false,reason:'CSV_HASH_INVALID'};
 const expected=fd.formatSeasonKey(fd.inferEuropeanSeasonStartYear(now));
 if(stored.season!==expected)return {ok:false,reason:'SEASON_MISMATCH'};
 if(String(stored.code||'').toUpperCase()!==code)return {ok:false,reason:'LEAGUE_CODE_MISMATCH'};
 const fetched=Date.parse(stored.fetchedAt), latest=Date.parse(local.inspection.latestMatchAt);
 if(!Number.isFinite(fetched)||fetched>Date.parse(now)+60*60*1000||Date.parse(now)-fetched>8*86400000)return {ok:false,reason:'CSV_FETCH_STALE_OR_FUTURE'};
 if(!Number.isFinite(latest)||latest>Date.parse(now)+86400000||Date.parse(now)-latest>24*86400000)return {ok:false,reason:'MATCH_HISTORY_STALE_OR_FUTURE'};
 return {ok:true};
}
function fromLocal({leagueKey='',leagueName='',now=new Date(),minimumMatches=6}={}){
 const code=({'serie_a':'I1','serie_b':'I2','premier_league':'E0','la_liga':'SP1','bundesliga':'D1','ligue_1':'F1'})[String(leagueKey).toLowerCase()];
 if(!code)return {teams:{},state:{status:'UNAVAILABLE',reason:'LEAGUE_NOT_MAPPED'}};
 const local=fd.readLocalLeagueSnapshot({code});
 if(!local)return {teams:{},state:{status:'UNAVAILABLE',reason:'LOCAL_CSV_MISSING'}};
 const verdict=validMetadata(local,code,now);
 if(!verdict.ok)return {teams:{},state:{status:'UNAVAILABLE',reason:verdict.reason}};
 const index=snapshots.getLeagueIndex({csvData:local.csvData,code,leagueName,revisionToken:local.inspection.sha256.slice(0,24)});
 const ageCutoff=now instanceof Date?now:new Date(now);
 const teams={};
 let totalObservations=0;
 for(const name of index.teams){
  const t=snapshots.buildTeamSnapshot(index,name,ageCutoff);
  if(!t.matched||t.season.xgSample<minimumMatches)continue;
  const f=t.season.xgForPerMatch,a=t.season.xgAgainstPerMatch;
  if(!Number.isFinite(f)||!Number.isFinite(a)||f<0||a<0||f>6||a>6)continue;
  teams[name]={xG_for:f,xG_against:a,source:'FOOTBALL_DATA_SECONDARY_OBSERVED',sample:t.season.xgSample};
  totalObservations+=t.season.xgSample;
 }
 if(Object.keys(teams).length<8)return {teams:{},state:{status:'UNAVAILABLE',reason:'INSUFFICIENT_TEAMS_OR_REAL_XG',teamCount:Object.keys(teams).length}};
 return {teams,state:{status:'PUBLISHER_OBSERVED_LKG',sourceClass:'LKG_CERTIFIED',providerId:'FOOTBALL_DATA_XG',providerFamily:'FOOTBALL_DATA_SECONDARY_PUBLISHED_XG',seasonStart:fd.inferEuropeanSeasonStartYear(now),seasonName:fd.inferEuropeanSeasonStartYear(now)+'/'+(fd.inferEuropeanSeasonStartYear(now)+1),leagueName,teamCount:Object.keys(teams).length,totalObservations,fetchedAt:local.metadata.fetchedAt,latestMatchAt:local.inspection.latestMatchAt,sourceUrl:local.metadata.url,sourceSha256:local.inspection.sha256,selectionReason:'REAL_PUBLISHED_HXG_AXG_OBSERVATIONS_WITH_SECONDARY_MODEL_PROVENANCE',primaryAlgorithmCertified:false,directStakeAuthority:false,directGateAuthority:false}};
}
module.exports={VERSION,fromLocal,validMetadata};
