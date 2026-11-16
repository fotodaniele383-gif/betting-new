'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const enrichment=require('../backend/calcioSerieBApiFootballEnrichmentAudit16dR3R3bR2');
const hist=require('../backend/calcioSerieBHistoricalCalibrationAudit16dR3R3bR2R2');

const checks=[]; const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
function teamBlock(name, total, sot, inside, outside, blocked, possession=50) {
  return {team:{name},statistics:[
    {type:'Total Shots',value:total},{type:'Shots on Goal',value:sot},{type:'Shots insidebox',value:inside},
    {type:'Shots outsidebox',value:outside},{type:'Blocked Shots',value:blocked},{type:'Ball Possession',value:`${possession}%`}
  ]};
}
function baseModel(){return {teams:{A:{xG_for:1.2,xG_against:1.2},B:{xG_for:1.2,xG_against:1.2}},state:{status:'MODEL_READY',evidenceClass:'MODEL_ESTIMATED_XG',seasonStart:2026,authorityWeight:0.2}};}

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'audit16d-r2r2-'));
  try {
    add('R2_R2 enrichment revision exported', enrichment.AUDIT16D_R3_R3B_R2_R2_FREE_CALIBRATION_VERSION===hist.AUDIT16D_R3_R3B_R2_R2_HISTORICAL_VERSION, hist.AUDIT16D_R3_R3B_R2_R2_HISTORICAL_VERSION);
    add('Free historical seasons fenced to 2022-2024', JSON.stringify(hist.HISTORICAL_SEASONS)===JSON.stringify([2022,2023,2024]), hist.HISTORICAL_SEASONS);
    add('Plan error parser extracts available seasons', JSON.stringify(enrichment.parseAvailableSeasonsFromErrors(['plan: Free plans do not have access to this season, try from 2022 to 2024.']))===JSON.stringify([2022,2023,2024]));
    add('Plan error classified as season denial', enrichment.isPlanSeasonDeniedError(['plan: Free plans do not have access to this season, try from 2022 to 2024.']));

    let calls=0;
    const requestJson=async url=>{
      calls++;
      if(url.includes('/leagues?')) return {status:200,headers:{},json:{errors:[],response:[{league:{id:135,name:'Serie B'},country:{name:'Italy'},seasons:[{year:2026,coverage:{fixtures:{statistics_fixtures:true}}},{year:2024}]}]}};
      const e=new Error('API_FOOTBALL_API_ERRORS'); e.status=200; e.apiErrors=['plan: Free plans do not have access to this season, try from 2022 to 2024.']; throw e;
    };
    const first=await enrichment.enrichBaseModel(baseModel(),{env:{API_FOOTBALL_KEY:'TEST'},cacheDir:tmp,projectRoot:tmp,requestJson,now:new Date('2026-09-28T12:00:00Z')});
    add('Live free-plan denial is normalized', first.state.enrichmentStatus==='BASE_ONLY_SEASON_NOT_AVAILABLE_ON_PLAN', first.state.enrichmentStatus);
    const denial=enrichment.getCachedSeasonDenial(tmp,2026,new Date('2026-09-28T12:01:00Z'));
    add('Negative capability is persisted', denial?.allowed===false && denial.availableSeasons.join(',')==='2022,2023,2024', denial);
    const before=calls;
    const second=await enrichment.enrichBaseModel(baseModel(),{env:{API_FOOTBALL_KEY:'TEST'},cacheDir:tmp,projectRoot:tmp,requestJson:async()=>{calls++;throw new Error('SHOULD_NOT_CALL');},now:new Date('2026-09-28T12:02:00Z')});
    add('Negative capability cache suppresses repeat API calls', second.state.enrichmentStatus==='BASE_ONLY_SEASON_NOT_AVAILABLE_CACHED' && calls===before, {status:second.state.enrichmentStatus,callsBefore:before,callsAfter:calls});
    add('Cached denial does not escalate authority', second.state.authorityWeight<=0.2 && second.state.realXg===false && second.state.directStakeAuthority===false && second.state.directGateAuthority===false, second.state);

    const tmp2=fs.mkdtempSync(path.join(os.tmpdir(),'audit16d-r2r2-backfill-'));
    let hcalls=0;
    const hreq=async url=>{
      hcalls++;
      if(url.includes('/fixtures?')) return {status:200,headers:{},json:{errors:[],response:[
        {fixture:{id:1,date:'2022-08-01T00:00:00Z',status:{short:'FT'}},teams:{home:{name:'A'},away:{name:'B'}},goals:{home:1,away:0}},
        {fixture:{id:2,date:'2022-08-08T00:00:00Z',status:{short:'FT'}},teams:{home:{name:'B'},away:{name:'A'}},goals:{home:2,away:1}}
      ]}};
      const id=Number(new URL(url).searchParams.get('fixture'));
      return {status:200,headers:{},json:{errors:[],response:id===1?[teamBlock('A',10,4,7,3,2),teamBlock('B',8,2,5,3,2)]:[teamBlock('B',11,5,8,3,1),teamBlock('A',9,3,6,3,2)]}};
    };
    const back=await hist.backfillHistorical({env:{API_FOOTBALL_KEY:'TEST'},cacheDir:tmp2,projectRoot:tmp2,seasons:[2022],maxNewStatsPerRun:2,maxRuntimeMs:30000,requestJson:hreq,nowFn:()=>new Date('2026-09-28T12:00:00Z'),sleepFn:async()=>{}});
    add('Historical backfill caches fixture stats without touching live model', back.success && back.newStatsFetched===2 && back.coverage.complete===true && back.liveModelChanged===false, back);
    const hbefore=hcalls;
    const back2=await hist.backfillHistorical({env:{API_FOOTBALL_KEY:'TEST'},cacheDir:tmp2,projectRoot:tmp2,seasons:[2022],maxNewStatsPerRun:2,maxRuntimeMs:30000,requestJson:async()=>{hcalls++;throw new Error('SHOULD_NOT_CALL');},nowFn:()=>new Date('2026-09-28T12:00:00Z'),sleepFn:async()=>{}});
    add('Historical cache prevents duplicate API calls', back2.success && hcalls===hbefore && back2.coverage.complete===true, {before:hbefore,after:hcalls,coverage:back2.coverage});

    // Seed a deterministic 3-season local dataset so the shadow evaluator has rolling observations.
    const teams=['A','B','C','D']; let fid=1000;
    for(const season of [2022,2023,2024]) {
      const fixtures=[];
      for(let i=0;i<24;i++) {
        const h=teams[i%4], a=teams[(i+1+(i%2))%4]; if(h===a) continue;
        const id=fid++; const hg=(i+season)%3, ag=(i*2+season)%3;
        fixtures.push({id,date:`${season}-${String(1+(i%9)).padStart(2,'0')}-${String(1+(i%20)).padStart(2,'0')}T00:00:00Z`,status:'FT',home:h,away:a,homeGoals:hg,awayGoals:ag});
        const hs=teamBlock(h,9+(i%6),2+(i%4),6+(i%4),3,1+(i%3),48+(i%8));
        const as=teamBlock(a,8+((i+2)%6),2+((i+1)%4),5+((i+1)%4),3,1+((i+1)%3),47+((i+3)%8));
        hist._private.safeJsonWrite(hist._private.statFile(tmp2,season,id),{fixtureId:id,season,response:[hs,as],final:true});
      }
      hist._private.safeJsonWrite(hist._private.fixtureListFile(tmp2,season),{season,leagueId:135,fixtures});
    }
    const cal=hist.runShadowCalibration({cacheDir:tmp2,projectRoot:tmp2});
    add('Shadow calibration produces compact candidate with holdout metrics', cal.success && cal.compactCandidate?.config && cal.compactCandidate?.holdout?.observations>0, cal.compactCandidate);
    add('Calibration explicitly does not claim REAL_XG', cal.realXgGroundTruth===false && cal.calibrationTarget==='POST_MATCH_GOALS_AS_VALIDATION_TARGET', {target:cal.calibrationTarget,realXgGroundTruth:cal.realXgGroundTruth});
    add('Calibration cannot auto-promote production model', cal.liveModelChanged===false && cal.decision==='KEEP_LIVE_R1_UNCHANGED_PENDING_REVIEW', {liveModelChanged:cal.liveModelChanged,decision:cal.decision});

    fs.rmSync(tmp2,{recursive:true,force:true});
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
  const failures=checks.filter(x=>!x.ok);
  console.log(JSON.stringify({success:failures.length===0,patch:'AUDIT16D_R3_R3B_R2_R2',suite:'FREE_HISTORICAL_CALIBRATION',checks:checks.length,failures:failures.map(x=>x.name),details:checks},null,2));
  if(failures.length) process.exitCode=1;
})().catch(err=>{console.error(JSON.stringify({success:false,error:String(err?.stack||err)},null,2));process.exitCode=1;});
