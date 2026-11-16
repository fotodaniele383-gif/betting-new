#!/usr/bin/env node
'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const assert=require('assert');
const { openDatabase }=require('./patch15-db-adapter');
const forward=require('../backend/tennisForwardSampleIntake');
const core=require('../backend/tennisCoreContractAudit');
const release=require('../backend/tennisReleaseSecurity');
const settlement=require('../backend/tennisOfficialSettlementResolver');
const progression=require('../backend/tennisProgramProgressionAudit');

const PATCH='AUDIT16D_R3_T1_TENNIS_HEALTH_AND_FORWARD_DATA_V1';
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const dbPath=process.env.BETTING_DB_PATH||path.join(root,'backend','database_betting.db');
const checks=[];
function check(name,fn){try{const details=fn();checks.push({name,ok:true,details:details===undefined?null:details});}catch(e){checks.push({name,ok:false,error:e.message});}}
async function checkAsync(name,fn){try{const details=await fn();checks.push({name,ok:true,details:details===undefined?null:details});}catch(e){checks.push({name,ok:false,error:e.message});}}
(async()=>{
  check('T1 revision exported by forward intake',()=>{assert.equal(forward.AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,PATCH);return null;});
  check('Core audit ignores historical config/AUDIT payload trees',()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'t1-core-'));
    try{
      fs.mkdirSync(path.join(tmp,'config','AUDIT12','payload'),{recursive:true});
      fs.mkdirSync(path.join(tmp,'config','active'),{recursive:true});
      fs.writeFileSync(path.join(tmp,'config','AUDIT12','payload','legacy.js'),"require('./missing-old-module');\n");
      fs.writeFileSync(path.join(tmp,'config','active','dep.js'),'module.exports=1;\n');
      fs.writeFileSync(path.join(tmp,'config','active','runtime.js'),"require('./dep');\n");
      const r=core.inspectRuntimeDependencies(tmp);
      assert.equal(r.missing.length,0);
      assert(r.checked.some(x=>x.file==='config/active/runtime.js'));
      assert(!r.checked.some(x=>x.file.includes('AUDIT12')));
      return {fileCount:r.fileCount,dependencyCount:r.dependencyCount};
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
  });
  check('Release excludes audit history and Tennis runtime caches without raising size guard',()=>{
    const paths=['.audit_patches/A/state.json','AUDIT16D_R3_T1/payload/a.js','config/AUDIT12/payload/a.js','backend/sackmann_data/last_known_good_patch21/x.csv','backend/sackmann_data/.tennis_provider_cache/x.body','backend/cache_official_tennis_patch29/x.json','backend/audit16d-runtime/x.json','backend/api_usage_cache.json'];
    const classified=paths.map(p=>({path:p,reason:release.classifyExclusion(p)}));
    assert(classified.every(x=>x.reason));
    assert.equal(release.classifyExclusion('backend/server.tennis.js'),null);
    return classified;
  });
  const opened=openDatabase(dbPath,{projectRoot:root,readonly:true,fileMustExist:true});
  const db=opened.db;
  try{
    check('Real DB forward coverage uses distinct bet identity and has no false ledger gap',()=>{
      const r=forward.inspectForwardSampleIntake(db);
      assert.equal(r.coverage?.exactPerBetIdentity,true);
      assert.equal(r.coverage?.missing?.eligibilityLedger,0);
      assert(!r.structuralGaps.includes('ELIGIBILITY_LEDGER_COVERAGE_GAP'));
      assert(['CAPTURING_FORWARD_SAMPLE','READY_FOR_NEXT_PREDICTION'].includes(r.status));
      return {status:r.status,counts:r.counts,coverage:r.coverage,actionableRows:r.forwardSample?.actionableRows};
    });
    check('Core contract active runtime scope is healthy on baseline',()=>{
      const r=core.buildCoreContractAudit({projectRoot:root});
      assert.equal(r.healthy,true);
      assert.equal(r.runtimeDependencies.missing.length,0);
      return {status:r.status,fileCount:r.runtimeDependencies.fileCount,dependencyCount:r.runtimeDependencies.dependencyCount};
    });
    check('Release plan remains below 150 MiB after runtime/audit trimming',()=>{
      const r=release.buildReleasePlan(root,{withHashes:false});
      assert.equal(r.summary.withinSizeGuard,true);
      assert(r.summary.totalMiB<=150);
      return r.summary;
    });
    await checkAsync('Official HTTP 403 degrades provider and returns null so downstream settlement fallbacks can continue',async()=>{
      const match={home_team:'Alpha Player',away_team:'Beta Player',match_date:'2026-09-01',league:'ATP Grand Slam',tournament:'US Open'};
      let observed=null;
      const result=await settlement.resolveOfficialSettlement(match,{allowNetwork:true,seed:{records:[]},retirementEvidence:{records:[]},forceRefresh:true,fetchText:async()=>{throw new Error('OFFICIAL_HTTP_403');},onNetworkFailure:x=>{observed=x;}});
      assert.equal(result,null);assert(observed);assert.equal(observed.message,'OFFICIAL_HTTP_403');assert.equal(observed.fallbackAllowed,true);assert.equal(observed.settlementAuthority,false);
      const h=settlement.health();assert.equal(h.status,'READY_WITH_OFFICIAL_NETWORK_DEGRADED');
      return {status:h.status,lastFailure:h.lastOfficialNetworkFailure};
    });
    check('Program progression has no critical error after T1 health fixes',()=>{
      const r=progression.buildProgramProgressionAudit(db,{projectRoot:root,historicalDatasetPath:path.join(root,'data','tennisdb_historical_player_stats.json')});
      assert.equal(r.errors,0);
      assert.equal(r.healthy,true);
      return {status:r.status,errors:r.errors,warnings:r.warnings,failedChecks:r.checks.filter(x=>!x.ok).map(x=>({name:x.name,severity:x.severity}))};
    });
    check('T1 never enables model/stake/gate/automatic promotion authority',()=>{
      const r=forward.inspectForwardSampleIntake(db);
      assert.equal(r.authority.productionProbability,false);assert.equal(r.authority.qualityGate,false);assert.equal(r.authority.stake,false);assert.equal(r.authority.automaticPromotion,false);
      return r.authority;
    });
    check('Database opened read-only for T1 certification',()=>({adapter:opened.adapter,native:opened.native,readOnly:true}));
  } finally {db.close();}
  const failures=checks.filter(x=>!x.ok);
  const report={success:failures.length===0,patch:PATCH,suite:'TENNIS_HEALTH_AND_FORWARD_DATA',checks:checks.length,failures:failures.map(x=>x.name),details:checks};
  console.log(JSON.stringify(report,null,2));
  if(failures.length)process.exitCode=2;
})().catch(e=>{console.error(JSON.stringify({success:false,patch:PATCH,error:e.message,stack:e.stack},null,2));process.exitCode=2;});
