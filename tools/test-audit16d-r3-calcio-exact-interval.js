#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const checks=[];const add=(n,o,d=null)=>checks.push({name:n,ok:Boolean(o),details:d});
let tmp=null;const oldLoad=Module._load;
try{
  tmp=fs.mkdtempSync(path.join(os.tmpdir(),'audit16d-r3-sched-'));const backend=path.join(tmp,'backend');fs.mkdirSync(backend,{recursive:true});
  fs.copyFileSync(path.join(ROOT,'backend','calcioAutoScheduler.js'),path.join(backend,'calcioAutoScheduler.js'));
  fs.writeFileSync(path.join(backend,'calcio_cron_config.json'),JSON.stringify({enabled:true,type:'interval_hours',intervalHours:20,minute:0,days:[0,1,2,3,4,5,6],updateMode:'all',runOptimization:true,runAnalysis:true,runDeepScan:true,runPaperSettlement:true,runClvSniper:true,bankroll:1000,league:'all',deepScanDelayMs:4000,afterOptimizationDelayMs:5000,afterAnalysisDelayMs:10000},null,2));
  const state={version:'TEST',sport:'CALCIO',state:'SCHEDULED',configEnabled:true};
  Module._load=function(req,parent,isMain){
    if(req==='node-cron')return{validate:()=>true,schedule:()=>({start(){},stop(){}})};
    if(req==='axios')return{get:async()=>({data:{success:true}}),post:async()=>({data:{success:true,valueBets:[]}})};
    if(req==='./operationalSchedulerStateMachinePatch58')return{statePath:()=>path.join(backend,'state.json'),eventsPath:()=>path.join(backend,'events.jsonl'),getState:()=>state,noteConfigChange:()=>state,runManagedCycle:async(_s,fn)=>fn()};
    return oldLoad.apply(this,arguments);
  };
  const m=require(path.join(backend,'calcioAutoScheduler.js'));
  add('R3 scheduler version',m.AUDIT16D_R3_SCHEDULER_VERSION==='AUDIT16D_R3_CALCIO_EXACT_INTERVAL_AND_CLV_CENTRALIZATION_V1');
  add('Interval hours no legacy cron',m.buildCronExpression({type:'interval_hours',intervalHours:20,days:[0,1,2,3,4,5,6]})==='');
  const base=new Date('2026-09-25T12:00:00Z');
  const next=m.calculateNextRunAt({type:'interval_hours',intervalHours:20,days:[0,1,2,3,4,5,6],intervalAnchorAt:base.toISOString()},base.getTime());
  add('20h cadence is exact elapsed interval',(new Date(next)-base)===20*3600000,{base:base.toISOString(),next});
  const timer=m.applySchedule({skipStateSync:true});
  const status=m.getSchedulerStatus();
  add('Exact interval timer armed',Boolean(timer)&&status.hasActiveIntervalTimer===true&&status.hasActiveCronJob===false,status);
  add('Duplicate Calcio CLV cron removed',status.hasActiveClvJob===false&&status.clvAuthority==='SERVER_STEP103_STEP104_GLOBAL_TRACKER',status);
  add('Misleading cron explicitly blocked',status.legacyMisleadingCronBlocked===true&&status.cronExpression===null,status);
  m.stopSchedule();
}catch(e){add('Unhandled',false,{message:e.message,stack:e.stack});}
finally{Module._load=oldLoad;if(tmp)try{fs.rmSync(tmp,{recursive:true,force:true})}catch(_){}}
const failures=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failures.length,patch:'AUDIT16D_R3',suite:'CALCIO_EXACT_INTERVAL',checks:checks.length,failures,details:checks},null,2));process.exit(failures.length?1:0);
