'use strict';
const path=require('path');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));

async function main(){
  const base=require(path.join(ROOT,'backend','calcioSerieBEstimatedXgAudit16dR3R3b'));
  const enrichment=require(path.join(ROOT,'backend','calcioSerieBApiFootballEnrichmentAudit16dR3R3bR2'));
  let footballData;
  try { footballData=require(path.join(ROOT,'backend','calcioFootballDataProvider')); }
  catch(e){
    console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3B_R2_R1',error:'CALCIO_FOOTBALL_DATA_PROVIDER_NOT_AVAILABLE',details:e.message},null,2));
    process.exitCode=1;
    return;
  }
  try{
    const source=await footballData.getLeagueCsv({leagueKey:'serie_b',leagueName:'Serie B',code:'I2'});
    const built=base.buildFromFootballDataCsv(source?.csvData||'',{leagueName:'Serie B',season:source?.season||null,now:new Date()});
    const enriched=await enrichment.enrichBaseModel(built,{projectRoot:ROOT,seasonStart:built.state?.seasonStart,env:process.env,now:new Date()});
    const key=enrichment.resolveApiKey(process.env);
    const sample=Object.entries(enriched.teams||{}).slice(0,5).map(([team,v])=>({team,xG_for:v.xG_for,xG_against:v.xG_against,games:v.games,apiFootballEnriched:Boolean(v.apiFootballEnriched),apiFootballGames:v.apiFootballGames??0,blendWeight:v.apiFootballBlendWeight??0,avgShotsInsideBox:v.avgShotsInsideBox??null,avgBlockedShots:v.avgBlockedShots??null,evidenceClass:v.evidenceClass}));
    const out={
      success:enriched.state?.status==='MODEL_READY',patch:'AUDIT16D_R3_R3B_R2_R1',provider:'SERIE_B_ESTIMATED_XG',
      scopeRevision:enrichment.AUDIT16D_R3_R3B_R2_R1_SCOPE_VERSION||null,
      apiFootball:{configured:key.configured,envName:key.envName,status:enriched.state?.enrichmentStatus||null,tokenExposed:false,diagnostics:enriched.diagnostics?.apiFootball||null},
      source:{status:source?.degraded?'LKG':'LIVE_OR_CURRENT',season:source?.season||null,validRows:source?.validRows??null,source:source?.source||null},
      state:enriched.state,sample,directStakeAuthority:false,directGateAuthority:false
    };
    console.log(JSON.stringify(out,null,2));
    process.exitCode=out.success?0:1;
  }catch(e){
    console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3B_R2_R1',provider:'SERIE_B_ESTIMATED_XG',error:e.code||e.message,stack:e.stack},null,2));
    process.exitCode=1;
  }
}
main().catch(e=>{console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3B_R2_R1',error:e?.message||String(e)},null,2));process.exitCode=1;});
