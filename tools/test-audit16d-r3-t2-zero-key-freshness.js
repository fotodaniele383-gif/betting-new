#!/usr/bin/env node
'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const assert=require('assert');
const multi=require('../backend/tennisMultiProviderData');
const refresh=require('../backend/tennisPlayerDataRefresh');

const PATCH='AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_AND_RECURRING_REFRESH_V1';
const checks=[];
function check(name,fn){try{const details=fn();checks.push({name,ok:true,details:details===undefined?null:details});}catch(e){checks.push({name,ok:false,error:e.message});}}
async function checkAsync(name,fn){try{const details=await fn();checks.push({name,ok:true,details:details===undefined?null:details});}catch(e){checks.push({name,ok:false,error:e.message});}}
function csv(rows=1000,prefix='P',date='20260928'){
  const headers=multi.CANONICAL_HEADERS; const body=[];
  for(let i=0;i<rows;i++){
    const row=Object.fromEntries(headers.map(h=>[h,'']));
    row.tourney_id=`${prefix}${Math.floor(i/16)}`; row.tourney_name=`Tournament ${prefix}`; row.surface='Hard'; row.draw_size='32'; row.tourney_level='A'; row.tourney_date=date; row.match_num=String(i+1); row.winner_id=String(1000+i); row.loser_id=String(5000+i); row.winner_name=`Winner ${prefix} ${i}`; row.loser_name=`Loser ${prefix} ${i}`; row.score='6-4 6-4'; row.best_of='3'; row.round='R32'; body.push(headers.map(h=>row[h]).join(','));
  }
  return `${headers.join(',')}\n${body.join('\n')}\n`;
}
function seed(dir){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'atp_matches_2026.csv'),csv(550,'OA','20260803'));fs.writeFileSync(path.join(dir,'atp_matches_challenger_2026.csv'),csv(1100,'OC','20260803'));fs.writeFileSync(path.join(dir,'wta_matches_2026.csv'),csv(550,'OW','20260525'));}
(async()=>{
  check('T2 revision exported by provider and recurring scheduler',()=>{
    assert.equal(multi.AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_REVISION,PATCH);
    assert.equal(refresh.AUDIT16D_R3_T2_RECURRING_REFRESH_REVISION,PATCH);
    return {provider:multi.AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_REVISION,scheduler:refresh.AUDIT16D_R3_T2_RECURRING_REFRESH_REVISION};
  });
  check('TennisMyLife zero-key provider now explicitly supports WTA_MAIN',()=>{
    const p=multi.providerRegistry({apiEnabled:false,apiKey:''}).find(x=>x.id==='TENNISMYLIFE_BULK');
    assert(p); assert(p.supports.includes('WTA_MAIN')); assert.equal(p.apiKeyRequired,false); assert.equal(p.costClass,'ZERO');
    return p;
  });
  check('WTA 2026 resource is allowlisted TennisMyLife bulk CSV',()=>{
    const r=multi.tmlResources('WTA_MAIN',2026);
    assert.deepEqual(r,[{id:'TML_WTA_2026',url:'https://stats.tennismylife.org/data/2026_wta.csv'}]);
    assert(multi.ALLOWED_NETWORK_HOSTS.has('stats.tennismylife.org'));
    return r;
  });
  await checkAsync('Fresh WTA TennisMyLife candidate is selected before legacy WTA fallback',async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'t2-wta-live-'));
    try{
      seed(dir); let calls=[];
      const requester=async(url)=>{calls.push(url); if(url.includes('_challenger'))return{statusCode:200,text:csv(1100,'TC'),headers:{},url}; if(url.includes('atp_quali'))return{statusCode:200,text:csv(300,'TQ'),headers:{},url}; if(url.includes('_wta.csv'))return{statusCode:200,text:csv(650,'TW'),headers:{},url}; return{statusCode:200,text:csv(650,'TA'),headers:{},url};};
      const b=await multi.resolveBundle({dataDir:dir,projectRoot:dir,year:2026,now:new Date('2026-09-29T15:00:00Z'),requester,retryDelaysMs:[0],githubRetryDelaysMs:[0],sleepFn:async()=>{},force:true,apiEnabled:false,apiKey:''});
      const selected=Object.fromEntries(b.selected.map(x=>[x.targetId,x.providerId]));
      assert.equal(selected.WTA_MAIN,'TENNISMYLIFE_BULK'); assert.equal(selected.ATP_MAIN,'TENNISMYLIFE_BULK'); assert.equal(selected.ATP_QUAL_CHALL,'TENNISMYLIFE_BULK');
      assert(calls.some(x=>x.includes('/2026_wta.csv'))); assert(!calls.some(x=>x.includes('api.api-tennis.com')));
      return {selected,wtaCalls:calls.filter(x=>x.includes('_wta.csv')).length,paidApiCalls:0};
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
  await checkAsync('WTA failures fail closed to existing LKG without paid API',async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'t2-wta-fallback-'));
    try{
      seed(dir); let calls=[];
      const requester=async(url)=>{calls.push(url); if(url.includes('_challenger'))return{statusCode:200,text:csv(1100,'FC'),headers:{},url}; if(url.includes('atp_quali'))return{statusCode:200,text:csv(300,'FQ'),headers:{},url}; if(url.includes('_wta.csv'))return{statusCode:404,text:'',headers:{},url}; if(url.includes('github'))return{statusCode:404,text:'',headers:{},url}; return{statusCode:200,text:csv(650,'FA'),headers:{},url};};
      const b=await multi.resolveBundle({dataDir:dir,projectRoot:dir,year:2026,now:new Date('2026-09-29T15:00:00Z'),requester,retryDelaysMs:[0],githubRetryDelaysMs:[0],sleepFn:async()=>{},force:true,apiEnabled:false,apiKey:'',allowStaleCache:false});
      const wta=b.selected.find(x=>x.targetId==='WTA_MAIN'); assert(wta); assert.equal(wta.providerId,'LAST_KNOWN_GOOD');
      assert(!calls.some(x=>x.includes('api.api-tennis.com')));
      return {providerId:wta.providerId,diagnostics:b.diagnostics.filter(x=>x.targetId==='WTA_MAIN').map(x=>({providerId:x.providerId,status:x.status,error:x.error||null})),paidApiCalls:0};
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
  check('Provider plan preserves no production/gate/stake authority',()=>{
    const p=multi.providerPlan({apiEnabled:false,apiKey:''});
    assert.equal(p.productionAuthority,false);assert.equal(p.qualityGateAuthority,false);assert.equal(p.stakeAuthority,false);assert.equal(p.hardExclusion,false);
    return {productionAuthority:p.productionAuthority,qualityGateAuthority:p.qualityGateAuthority,stakeAuthority:p.stakeAuthority,hardExclusion:p.hardExclusion};
  });
  await checkAsync('Auto refresh is recurring and enforces minimum six-hour interval',async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'t2-scheduler-'));
    const saved=global.__TENNIS_PATCH20_AUTO_REFRESH_SCHEDULED;
    const savedTimer=global.__TENNIS_PATCH20_AUTO_REFRESH_TIMER;
    try{
      seed(dir); delete global.__TENNIS_PATCH20_AUTO_REFRESH_SCHEDULED; delete global.__TENNIS_PATCH20_AUTO_REFRESH_TIMER;
      const timers=[]; const fakeSet=(fn,ms)=>{const h={fn,ms,unref(){}};timers.push(h);return h;}; let refreshCalls=0;
      const plan=refresh.scheduleAutoRefresh({dataDir:dir,delayMs:25,intervalHours:1,setTimeoutFn:fakeSet,refreshFn:async()=>{refreshCalls+=1;return{success:true};}});
      assert.equal(plan.scheduled,true);assert.equal(plan.recurring,true);assert.equal(plan.intervalHours,6);assert.equal(timers.length,1);assert.equal(timers[0].ms,25);
      await timers[0].fn();
      assert.equal(refreshCalls,1);assert.equal(timers.length,2);assert.equal(timers[1].ms,6*3600000);
      return {plan,refreshCalls,nextDelayMs:timers[1].ms};
    } finally {
      fs.rmSync(dir,{recursive:true,force:true});
      if(saved===undefined) delete global.__TENNIS_PATCH20_AUTO_REFRESH_SCHEDULED; else global.__TENNIS_PATCH20_AUTO_REFRESH_SCHEDULED=saved;
      if(savedTimer===undefined) delete global.__TENNIS_PATCH20_AUTO_REFRESH_TIMER; else global.__TENNIS_PATCH20_AUTO_REFRESH_TIMER=savedTimer;
    }
  });
  check('Health reports recurring scheduler without changing probability/gate/stake authority',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'t2-health-'));
    try{seed(dir);const h=refresh.getPlayerDataHealth({dataDir:dir});assert.equal(h.autoRefreshRecurring,true);assert.equal(h.autoRefreshRevision,PATCH);assert(h.autoRefreshIntervalHours>=6);assert.equal(h.probabilityWeightsChanged,false);assert.equal(h.qualityGateAuthority,false);assert.equal(h.stakeAuthority,false);return{autoRefreshRecurring:h.autoRefreshRecurring,autoRefreshIntervalHours:h.autoRefreshIntervalHours,probabilityWeightsChanged:h.probabilityWeightsChanged,qualityGateAuthority:h.qualityGateAuthority,stakeAuthority:h.stakeAuthority};}
    finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  check('No secret/token is embedded in WTA bulk resource',()=>{const u=multi.tmlResources('WTA_MAIN',2026)[0].url;assert(!/[?&](?:key|token|apikey)=/i.test(u));return u;});
  const failures=checks.filter(x=>!x.ok);const report={success:failures.length===0,patch:'AUDIT16D_R3_T2',suite:'ZERO_KEY_WTA_FRESHNESS_AND_RECURRING_REFRESH',checks:checks.length,failures:failures.map(x=>x.name),details:checks};console.log(JSON.stringify(report,null,2));if(failures.length)process.exitCode=2;
})().catch(e=>{console.error(JSON.stringify({success:false,patch:'AUDIT16D_R3_T2',error:e.message,stack:e.stack},null,2));process.exitCode=2;});
