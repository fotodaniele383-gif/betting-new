"use strict";
// Monitor di sola lettura avviabile su richiesta. NON avvia trading, scheduler sportivo o settlement.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const root=path.resolve(process.argv[3]||'C:\\Users\\pc-user\\Documents\\Personale\\BettingApp\\BettingApp v2');
const policy=require('./policy.cjs');
const allowed=new Set(['status','run']);
const action=process.argv[2]||'status';
if(!allowed.has(action))throw Error('R8_ACTION_NOT_ALLOWED');
const status=policy.check(root);
console.log('SAFE13_R8_POLICY='+JSON.stringify(status));
if(action==='status')process.exit(0);
const interval=Number(process.env.R8_MONITOR_INTERVAL_MINUTES||60);
if(!Number.isSafeInteger(interval)||interval<30||interval>1440)throw Error('R8_MONITOR_INTERVAL_OUT_OF_RANGE');
const destination=path.join(root,'.bettingapp_safe13_r8','monitor-log.jsonl');
function health(){return new Promise((resolve)=>{
 let data='';const req=http.get('http://127.0.0.1:3188/api/health',{timeout:3000},res=>{
  res.on('data',c=>{if(data.length<100000)data+=c});res.on('end',()=>{let h={};try{h=JSON.parse(data)}catch{}resolve({ok:res.statusCode===200&&h.success===true,code:res.statusCode})});
 });req.on('timeout',()=>req.destroy());req.on('error',()=>resolve({ok:false,code:null}));
})}
async function tick(){
 const h=await health();const report={time:new Date().toISOString(),kind:'R8_HEALTH_READ_ONLY',health:h,disabledLiveBetting:true,disabledAutoSettlement:true};
 // R7 report can be calculated locally read-only; no external source is promoted to official.
 const f=path.join(root,'addons/reliability-r7/core.cjs');
 if(fs.existsSync(f))try{const r=require(f).report(root);report.r7={calcioPending:r.calcioSettlement?.stalePending??null,tennisSchedulePending:r.tennisOfficialSchedule?.requiresReview??null,decisionContractBlocked:r.tennisForwardCapture?.decisionContractBlocked??null}}catch(e){report.r7={error:String(e.message).slice(0,150)}};
 const line=JSON.stringify(report)+'\n';fs.mkdirSync(path.dirname(destination),{recursive:true});
 fs.appendFileSync(destination,line,{encoding:'utf8',flag:'a'});console.log('R8_READONLY_CHECK '+JSON.stringify(report));
}
tick().catch(e=>console.error('R8_MONITOR_ERROR='+String(e.message)));
setInterval(()=>tick().catch(e=>console.error('R8_MONITOR_ERROR='+String(e.message))),interval*60*1000);
