'use strict';
const path=require('path');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const model=require(path.join(ROOT,'backend','calcioSerieBEstimatedXgAudit16dR3R3b'));
let footballData;
try{footballData=require(path.join(ROOT,'backend','calcioFootballDataProvider'));}
catch(e){console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3B',provider:'SERIE_B_ESTIMATED_XG',error:'CALCIO_FOOTBALL_DATA_PROVIDER_NOT_AVAILABLE',details:e.message},null,2));process.exit(1);}
(async()=>{
 try{
  const source=await footballData.getLeagueCsv({leagueKey:'serie_b',leagueName:'Serie B',code:'I2'});
  const built=model.buildFromFootballDataCsv(source?.csvData||'',{leagueName:'Serie B',season:source?.season||null,now:new Date()});
  const sample=Object.entries(built.teams||{}).slice(0,5).map(([team,v])=>({team,xG_for:v.xG_for,xG_against:v.xG_against,games:v.games,avgShots:v.avgShots,avgShotsOnTarget:v.avgShotsOnTarget,evidenceClass:v.evidenceClass}));
  const out={success:built.state?.status==='MODEL_READY',patch:'AUDIT16D_R3_R3B',provider:'SERIE_B_ESTIMATED_XG',source:{status:source?.degraded?'LKG':'LIVE_OR_CURRENT',season:source?.season||null,validRows:source?.validRows??null,source:source?.source||null},state:built.state,sample,directStakeAuthority:false,directGateAuthority:false};
  console.log(JSON.stringify(out,null,2)); process.exit(out.success?0:1);
 }catch(e){console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3B',provider:'SERIE_B_ESTIMATED_XG',error:e.code||e.message,stack:e.stack},null,2));process.exit(1);}
})();
