'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const enrichment=require('../backend/calcioSerieBApiFootballEnrichmentAudit16dR3R3bR2');
const hist=require('../backend/calcioSerieBHistoricalCalibrationAudit16dR3R3bR2R2');
const checks=[]; const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
function seedLedger(dir,calls){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'quota_ledger.json'),JSON.stringify({version:1,calls},null,2));}
(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'audit16d-r2r2r1-'));
  try {
    add('R2_R2_R1 quota sync version exported', enrichment.AUDIT16D_R3_R3B_R2_R2_R1_QUOTA_SYNC_VERSION==='AUDIT16D_R3_R3B_R2_R2_R1_PROVIDER_QUOTA_HEADER_SYNC_V1' && hist.AUDIT16D_R3_R3B_R2_R2_R1_QUOTA_SYNC_VERSION===enrichment.AUDIT16D_R3_R3B_R2_R2_R1_QUOTA_SYNC_VERSION);
    add('Legacy conservative fallback budgets preserved', enrichment.DAILY_BUDGET===80 && enrichment.MINUTE_BUDGET===8, {daily:enrichment.DAILY_BUDGET,minute:enrichment.MINUTE_BUDGET});

    const d1=new Date('2026-09-28T23:59:50Z'), d2=new Date('2026-09-29T00:00:10Z');
    seedLedger(tmp,Array.from({length:79},(_,i)=>d1.getTime()-60000-i*1000));
    const afterReset=enrichment.quotaStatus(tmp,d2);
    add('Local daily ledger resets on UTC calendar day, not rolling 24h', afterReset.dayUsed===0 && afterReset.dayRemaining===80 && afterReset.canCall===true, afterReset);

    const sameDay=new Date('2026-09-29T07:30:00Z');
    seedLedger(tmp,Array.from({length:80},(_,i)=>sameDay.getTime()-120000-i*1000));
    enrichment.rememberProviderQuota(tmp,{
      'x-ratelimit-requests-limit':'100','x-ratelimit-requests-remaining':'50',
      'X-RateLimit-Limit':'10','X-RateLimit-Remaining':'9'
    },sameDay);
    const synced=enrichment.quotaStatus(tmp,new Date('2026-09-29T07:30:10Z'));
    add('Fresh provider daily header overrides stale local 80-call ceiling', synced.providerSyncActive===true && synced.mode==='PROVIDER_HEADER_SYNC' && synced.dayUsed===80 && synced.providerDailyRemaining===50 && synced.dayRemaining===40 && synced.canCall===true, synced);
    add('Provider quota keeps 10-request daily safety reserve', synced.providerDailyReserve===10 && synced.dayRemaining===40, {reserve:synced.providerDailyReserve,remaining:synced.dayRemaining});

    enrichment.rememberProviderQuota(tmp,{
      'x-ratelimit-requests-limit':'100','x-ratelimit-requests-remaining':'10',
      'X-RateLimit-Limit':'10','X-RateLimit-Remaining':'9'
    },sameDay);
    const dailyStop=enrichment.quotaStatus(tmp,new Date('2026-09-29T07:30:15Z'));
    add('Provider daily reserve fails closed at 10 remaining', dailyStop.canCall===false && dailyStop.dayRemaining===0, dailyStop);

    enrichment.rememberProviderQuota(tmp,{
      'x-ratelimit-requests-limit':'100','x-ratelimit-requests-remaining':'60',
      'X-RateLimit-Limit':'10','X-RateLimit-Remaining':'2'
    },sameDay);
    const minuteStop=enrichment.quotaStatus(tmp,new Date('2026-09-29T07:30:20Z'));
    add('Provider minute reserve fails closed at 2 remaining', minuteStop.canCall===false && minuteStop.providerMinuteFresh===true, minuteStop);
    const staleMinute=enrichment.quotaStatus(tmp,new Date('2026-09-29T07:32:00Z'));
    add('Stale provider minute snapshot falls back to local minute guard while daily sync stays active', staleMinute.providerSyncActive===true && staleMinute.providerMinuteFresh===false && staleMinute.canCall===true, staleMinute);

    const tmp2=fs.mkdtempSync(path.join(os.tmpdir(),'audit16d-r2r2r1-api-'));
    let calls=0;
    const req=async()=>{calls++;return {status:200,headers:{'x-ratelimit-requests-limit':'100','x-ratelimit-requests-remaining':'94','x-ratelimit-limit':'10','x-ratelimit-remaining':'7'},json:{errors:[],response:[]}}};
    await enrichment._private.apiCall({url:'https://v3.football.api-sports.io/test',apiKey:'SECRET',cacheDir:tmp2,now:sameDay,requestJson:req});
    const captured=enrichment.quotaStatus(tmp2,new Date('2026-09-29T07:30:01Z'));
    add('API call captures provider rate-limit headers without exposing token', calls===1 && captured.providerDailyRemaining===94 && captured.providerMinuteRemaining===7 && !JSON.stringify(captured).includes('SECRET'), captured);

    const status=hist.status({projectRoot:tmp2,cacheDir:tmp2,seasons:[2022]});
    add('Historical status exposes provider quota diagnostics without live-model mutation', status.liveModelChanged===false && status.localQuota.providerSyncActive===true && status.localQuota.providerDailyRemaining===94, status.localQuota);

    const tmp3=fs.mkdtempSync(path.join(os.tmpdir(),'audit16d-r2r2r1-backfill-'));
    const fixtureFile=hist._private.fixtureListFile(tmp3,2022);
    hist._private.safeJsonWrite(fixtureFile,{season:2022,leagueId:135,fixtures:[{id:777,date:'2022-08-01T00:00:00Z',status:'FT',home:'A',away:'B',homeGoals:1,awayGoals:0}]});
    seedLedger(tmp3,Array.from({length:80},(_,i)=>sameDay.getTime()-120000-i*1000));
    enrichment.rememberProviderQuota(tmp3,{
      'x-ratelimit-requests-limit':'100','x-ratelimit-requests-remaining':'50',
      'x-ratelimit-limit':'10','x-ratelimit-remaining':'9'
    },sameDay);
    const block=(name,total,sot)=>({team:{name},statistics:[{type:'Total Shots',value:total},{type:'Shots on Goal',value:sot},{type:'Shots insidebox',value:7},{type:'Shots outsidebox',value:3},{type:'Blocked Shots',value:2}]});
    const back=await hist.backfillHistorical({env:{API_FOOTBALL_KEY:'TEST'},cacheDir:tmp3,projectRoot:tmp3,seasons:[2022],maxNewStatsPerRun:1,maxRuntimeMs:30000,nowFn:()=>new Date('2026-09-29T07:30:20Z'),sleepFn:async()=>{},requestJson:async()=>({status:200,headers:{'x-ratelimit-requests-limit':'100','x-ratelimit-requests-remaining':'49','x-ratelimit-limit':'10','x-ratelimit-remaining':'8'},json:{errors:[],response:[block('A',10,4),block('B',8,2)]}})});
    add('Historical backfill resumes beyond local 80 when provider headers prove safe quota remains', back.newStatsFetched===1 && back.stopReason===null && back.localQuota.providerSyncActive===true && back.liveModelChanged===false, back);
    fs.rmSync(tmp3,{recursive:true,force:true});
    fs.rmSync(tmp2,{recursive:true,force:true});
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
  const failures=checks.filter(x=>!x.ok);
  console.log(JSON.stringify({success:failures.length===0,patch:'AUDIT16D_R3_R3B_R2_R2_R1',suite:'PROVIDER_QUOTA_HEADER_SYNC',checks:checks.length,failures:failures.map(x=>x.name),details:checks},null,2));
  if(failures.length) process.exitCode=1;
})().catch(err=>{console.error(JSON.stringify({success:false,error:String(err?.stack||err)},null,2));process.exitCode=1;});
