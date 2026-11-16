#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module'),assert=require('assert');
const ROOT=path.resolve(process.argv[process.argv.indexOf('--root')+1]||path.join(__dirname,'..'));
const checks=[];const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
let tmp=null,oldLoad=Module._load;
try{
  tmp=fs.mkdtempSync(path.join(os.tmpdir(),'audit16a-'));
  const backend=path.join(tmp,'backend'); fs.mkdirSync(backend,{recursive:true});
  const schedulerSrc=path.join(ROOT,'backend','calcioAutoScheduler.js');
  fs.copyFileSync(schedulerSrc,path.join(backend,'calcioAutoScheduler.js'));
  const configPath=path.join(backend,'calcio_cron_config.json');
  const initialConfig={enabled:false,type:'interval_hours',intervalHours:1,minute:0,days:[1,2,3,4,5],updateMode:'all',runOptimization:true,runAnalysis:true,runDeepScan:true,runPaperSettlement:true,runClvSniper:true,bankroll:1000,league:'all',deepScanDelayMs:4000,afterOptimizationDelayMs:5000,afterAnalysisDelayMs:10000};
  fs.writeFileSync(configPath,JSON.stringify(initialConfig,null,2)+'\n');
  const runtime=path.join(tmp,'backend','.scheduler_patch58_runtime'); fs.mkdirSync(runtime,{recursive:true});
  const statePath=path.join(runtime,'calcio_scheduler_state.json'),eventsPath=path.join(runtime,'calcio_scheduler_events.jsonl');
  const initialState={version:'TEST',sport:'CALCIO',state:'DISABLED',configEnabled:false,configFingerprint:'initial'};
  fs.writeFileSync(statePath,JSON.stringify(initialState,null,2)+'\n'); fs.writeFileSync(eventsPath,'INITIAL\n');
  let failNext=false,scheduleCount=0;
  const stubState={
    statePath:()=>statePath,eventsPath:()=>eventsPath,
    getState:()=>JSON.parse(fs.readFileSync(statePath,'utf8')),
    noteConfigChange:(sport,config)=>{
      const next={version:'TEST',sport,state:config.enabled?'SCHEDULED':'DISABLED',configEnabled:config.enabled===true,configFingerprint:'fp-'+String(config.enabled)};
      fs.writeFileSync(statePath,JSON.stringify(next,null,2)+'\n'); fs.appendFileSync(eventsPath,`EVENT:${config.enabled}\n`);
      if(failNext){failNext=false;throw Object.assign(new Error('INJECTED_STATE_FAILURE'),{code:'INJECTED_STATE_FAILURE'});} return next;
    },
    runManagedCycle:async(_sport,fn)=>fn()
  };
  Module._load=function(request,parent,isMain){
    if(request==='node-cron')return{schedule:()=>({start(){scheduleCount++;},stop(){}})};
    if(request==='axios')return{get:async()=>({data:{success:true}}),post:async()=>({data:{success:true}})};
    if(request==='./operationalSchedulerStateMachinePatch58')return stubState;
    return oldLoad.apply(this,arguments);
  };
  const scheduler=require(path.join(backend,'calcioAutoScheduler.js'));
  add('AUDIT16A version exported',scheduler.AUDIT16A_VERSION==='AUDIT16A_CALCIO_SCHEDULER_ATOMIC_PERSISTENCE_V1');
  let explicitBlocked=false; try{scheduler.saveCronConfig({...initialConfig,enabled:true});}catch(e){explicitBlocked=e.code==='PATCH58_CALCIO_EXPLICIT_ENABLE_REQUIRED';}
  add('Explicit enable guard preserved',explicitBlocked);
  const enabled=scheduler.saveCronConfig({...initialConfig,enabled:true,explicitEnable:true});
  add('Config enable persisted',enabled.enabled===true && JSON.parse(fs.readFileSync(configPath,'utf8')).enabled===true);
  add('Patch58 state persisted with config',JSON.parse(fs.readFileSync(statePath,'utf8')).configEnabled===true);
  const schedulerStatus=scheduler.getSchedulerStatus(); add('Scheduler armed after coherent persistence',schedulerStatus.hasActiveIntervalTimer===true||scheduleCount>0,{scheduleCount,schedulerStatus});
  const before={config:fs.readFileSync(configPath),state:fs.readFileSync(statePath),events:fs.readFileSync(eventsPath)};
  failNext=true; let injected=false; try{scheduler.saveCronConfig({...enabled,enabled:false});}catch(e){injected=e.code==='INJECTED_STATE_FAILURE';}
  add('Injected state failure propagated',injected);
  add('Config rolled back byte-exact after state failure',Buffer.compare(before.config,fs.readFileSync(configPath))===0);
  add('State rolled back byte-exact after state failure',Buffer.compare(before.state,fs.readFileSync(statePath))===0);
  add('Event ledger rolled back byte-exact after state failure',Buffer.compare(before.events,fs.readFileSync(eventsPath))===0);
  let invalid=false; try{scheduler.saveCronConfig({...enabled,type:'not_a_schedule',enabled:true,explicitEnable:true});}catch(e){invalid=e.code==='AUDIT16A_CALCIO_SCHEDULER_INVALID_CRON_CONFIG';}
  add('Invalid cron fails closed',invalid);
  add('Invalid cron rollback restores prior config',Buffer.compare(before.config,fs.readFileSync(configPath))===0);
  const schedulerSource=fs.readFileSync(schedulerSrc,'utf8'),serverSource=fs.readFileSync(path.join(ROOT,'backend','server.js'),'utf8');
  add('Silent Patch58 save catch removed',!schedulerSource.includes("try { schedulerStateMachinePatch58.noteConfigChange('CALCIO', merged") && !schedulerSource.includes("try { schedulerStateMachinePatch58.noteConfigChange('CALCIO', config"));
  add('Setup route verifies state readback',serverSource.includes('AUDIT16A_CALCIO_SCHEDULER_STATE_NOT_PERSISTED'));
  add('Global background API supports explicit Calcio request',serverSource.includes('calcioExplicitEnable')&&serverSource.includes('calcioEnabled'));
}catch(e){add('Unhandled test exception',false,{message:e.message,stack:e.stack});}
finally{Module._load=oldLoad;if(tmp)try{fs.rmSync(tmp,{recursive:true,force:true});}catch(_){}}
const failures=checks.filter(x=>!x.ok);const out={success:failures.length===0,patch:'AUDIT16A',checks:checks.length,failures,details:checks};console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
