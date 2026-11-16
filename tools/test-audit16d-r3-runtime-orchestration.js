#!/usr/bin/env node
'use strict';
const path=require('path');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const m=require(path.join(ROOT,'backend','runtimeWorkloadCoordinatorAudit16dR3'));
const checks=[];const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
try{
  m.resetForTests();
  add('Version',m.VERSION==='AUDIT16D_R3_RUNTIME_WORKLOAD_COORDINATOR_V1');
  const end=m.beginCalcioAnalysis();
  add('Calcio analysis lock active',m.snapshot().calcioAnalysisRunning===true);
  const nonUrgent=m.beginClv({source:'TEST_NON_URGENT',urgent:false});
  add('Non urgent CLV deferred during Calcio',nonUrgent.allowed===false&&nonUrgent.deferred===true&&nonUrgent.reason==='CALCIO_ANALYSIS_ACTIVE_NON_URGENT_CLV',nonUrgent);
  const urgent=m.beginClv({source:'TEST_URGENT',urgent:true});
  add('Urgent closing CLV allowed during Calcio',urgent.allowed===true&&urgent.reason==='URGENT_CLOSING_WINDOW_ALLOWED',urgent);
  const duplicate=m.beginClv({source:'DUPLICATE',urgent:true});
  add('Second CLV single-flight blocked',duplicate.allowed===false&&duplicate.skipped===true&&duplicate.reason==='CLV_ALREADY_RUNNING',duplicate);
  urgent.release();
  end();
  const free=m.beginClv({source:'FREE',urgent:false});
  add('CLV allowed after analysis completes',free.allowed===true,free);
  free.release();
  const snap=m.snapshot();
  add('Counters visible',snap.clvDeferredCount===1&&snap.clvSkipAlreadyRunningCount===1,snap);
}catch(e){add('Unhandled',false,{message:e.message,stack:e.stack});}
const failures=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failures.length,patch:'AUDIT16D_R3',suite:'RUNTIME_ORCHESTRATION',checks:checks.length,failures,details:checks},null,2));process.exit(failures.length?1:0);
