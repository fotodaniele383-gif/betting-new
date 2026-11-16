#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const PATCH_ID = 'AUDIT12_SETTLEMENT_RESOLUTION_PROOF_HARDENING_V1';
const AUDIT_DIR_NAME = 'AUDIT12';
const SUITE_TIMEOUT_MS = 60000;

const FILES = Object.freeze({
  queue: 'backend/tennisSettlementExceptionQueuePatch51.js',
  paper: 'backend/paperTrading.tennis.js',
  gate: 'backend/settlementResolutionEvidenceGateAudit12.js',
  queueTest: 'tools/test-tennis-patch51-settlement-exception-queue.js',
  audit12Test: 'tools/test-tennis-audit12-settlement-resolution-evidence.js'
});

const BASELINE_HASHES = Object.freeze({
  [FILES.queue]: 'b8711b0c258f04b989500cf1dae2ebfaccce82994a9c527af387f44c4a0cd3ba',
  [FILES.paper]: '879d5a5ca884aa4bcae04876de2be34a69c2c13bb4559daed3ea4456a0f1fd92',
  [FILES.queueTest]: '18b63595eb865cace88c8982fa1ba805d917a230620c08cc3b8bda668d63c9fe',
  'tools/test-tennis-patch51-runtime-idempotency.js': '70dcca36574a2c35abe6073e341288868ffec79e202af1ae22b70468299577ab',
  'backend/controlledCanaryActivationPatch59.js': '9b6d76c2c6ffd45d3ac4657a49f916e71ea18cdf85d39b7d11c62683b00bff10',
  'tools/audit-tennis-patch59.js': 'd45c3adfb32e0e6f930c10b57e399131768b5ddc663db93983652ba28f6f2d63',
  'backend/statisticalProductionReadinessGatePatch55.js': '5b6998070893179050f686b2a442da0798afa6b1a9d0a8cb48f51ad5ae378c42',
  'backend/certifiedMetricsEvidenceGateAudit08.js': '8fbec3b5cf1e43b3c1a171eaa866efe88e9521aba44d60347013f4406c151fcd',
  'backend/certifiedClvEvidenceGateAudit09.js': '31fd655e5fcc5319b23194bf2ac403c870f51202520127993fee926d9afb8a5c',
  'backend/settlementExceptionScopeGateAudit10.js': '6b888b40493dc8e5b93baa74de056eeed2b8418d462661b0fe37fece198430df',
  'backend/calcioUnifiedStakeAuthority.js': 'f074170692ad0b9693c484c8565db4872ca8cf340905ff0badc41883aa37328f',
  'backend/server.js': 'fa86a8f4e85578b0e347c3be629dd0337d656e4b923638ed73d1318ef80f7a34',
  'backend/server.tennis.js': '4284e908e4d38288300a7a28d5d06571de80544878620217e57d3ae91f62f04f',
  'Avvia_Betting.bat': '4d796d1863b0db223358a15003397d5ce4e7cc4f5eb0aed10358f04b85804d7e'
});

const PAYLOAD_HASHES = Object.freeze({
  [FILES.gate]: '02a919a4d26c9b004e68e0f8d6e1f10a41974b8ff30ce464829d5b87319ad919',
  [FILES.queue]: '772fca3eb0609e54a3b8d5c3bd59b080f3fe2ba19e90ea2d9ca423d0efed8f8a',
  [FILES.paper]: 'a0da896b5fd435e87f1a031f8fc9bf5f4447be0cdf53db7358221499741ab3e7',
  [FILES.queueTest]: '98ec097db7aaef0defe10888c7f9695331f76b8382a3bee83cf96f2eb7e5de22',
  [FILES.audit12Test]: '1d0b6630a123250a9011ca4ffd22d9a91ac7838b5039f6e8520cddf9e396d6c3'
});

const BASE_REGRESSION_SUITES = Object.freeze([
  'tools/audit-tennis-patch59.js',
  'tools/test-calcio-patch26ec-standalone.js',
  'tools/test-tennis-patch55-gate-policy.js',
  'tools/test-tennis-patch55-real-db.js',
  'tools/test-tennis-patch59-policy.js',
  'tools/test-tennis-patch59-integration.js',
  'tools/test-tennis-patch58-state-machine-policy.js',
  'tools/test-tennis-patch57-security-policy.js',
  'tools/test-calcio-patch54-registry-inventory.js',
  'tools/test-tennis-patch51-runtime-idempotency.js',
  'tools/test-tennis-patch51-settlement-exception-queue.js'
]);
const POST_REGRESSION_SUITES = Object.freeze([...BASE_REGRESSION_SUITES, FILES.audit12Test]);

function normalizeRoot(v){ return path.resolve(v || path.join(__dirname,'..')); }
function sha256File(file){ return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function ensureDir(d){ fs.mkdirSync(d,{recursive:true}); }
function nowId(){ return new Date().toISOString().replace(/[:.]/g,'-'); }
function auditDir(root){ return path.join(root,AUDIT_DIR_NAME); }
function evidenceDir(root){ const d=path.join(auditDir(root),'evidence'); ensureDir(d); return d; }
function stateDir(root){ const d=path.join(root,'.audit_patches',AUDIT_DIR_NAME); ensureDir(d); return d; }
function activePath(root){ return path.join(stateDir(root),'ACTIVE.json'); }
function jsonWrite(file,obj){ ensureDir(path.dirname(file)); fs.writeFileSync(file,JSON.stringify(obj,null,2)+'\n','utf8'); }
function logJson(root,name,obj){ jsonWrite(path.join(evidenceDir(root),name),obj); }
function exists(root,p){ return fs.existsSync(path.join(root,p)); }
function readText(root,p){ return fs.readFileSync(path.join(root,p),'utf8'); }
function nodeVersionOk(){ const m=/^v(\d+)\./.exec(process.version); return !!m && Number(m[1])>=20; }
function dbHash(root){ const f=path.join(root,'backend','database_betting.db'); return fs.existsSync(f)?sha256File(f):null; }

function runtimeSafety(){
  if(process.platform!=='win32') return {serverListening3000:false,ngrokRunning:false,platformCheck:'SKIPPED_NON_WINDOWS'};
  const ns=cp.spawnSync('netstat',['-ano','-p','tcp'],{encoding:'utf8',windowsHide:true});
  const serverListening3000=String(ns.stdout||'').split(/\r?\n/).some(line=>/:3000\s+.*LISTENING/i.test(line));
  const tl=cp.spawnSync('tasklist',['/FI','IMAGENAME eq ngrok.exe'],{encoding:'utf8',windowsHide:true});
  return {serverListening3000,ngrokRunning:/ngrok\.exe/i.test(String(tl.stdout||'')),platformCheck:'WINDOWS_NETSTAT_TASKLIST'};
}

function command(root,file,timeoutMs=SUITE_TIMEOUT_MS){
  const started=Date.now();
  const r=cp.spawnSync(process.execPath,[path.join(root,file),'--root',root],{
    cwd:root,encoding:'utf8',timeout:timeoutMs,maxBuffer:64*1024*1024,
    env:{...process.env,NODE_NO_WARNINGS:'1',TERM:'dumb'},windowsHide:true
  });
  let parsed=null; try{parsed=JSON.parse(String(r.stdout||'').trim())}catch(_){}
  const timedOut=Boolean(r.error&&r.error.code==='ETIMEDOUT');
  return {file,exitCode:r.status,signal:r.signal||null,passed:!timedOut&&r.status===0&&parsed?.success!==false,timedOut,durationMs:Date.now()-started,parsed,stdoutTail:String(r.stdout||'').slice(-10000),stderrTail:String(r.stderr||'').slice(-6000)};
}

function runSuites(root,suites){
  return suites.map(file=>exists(root,file)?command(root,file):({file,exitCode:null,signal:null,passed:false,timedOut:false,missing:true,durationMs:0,parsed:null,stdoutTail:'',stderrTail:'MISSING_SUITE'}));
}

function baselineHashChecks(root){
  return Object.entries(BASELINE_HASHES).map(([p,expected])=>{
    const f=path.join(root,p); if(!fs.existsSync(f)) return {file:p,ok:false,reason:'MISSING',expected,actual:null};
    const actual=sha256File(f); return {file:p,ok:actual===expected,expected,actual};
  });
}

function isPatched(root){
  try{return Object.entries(PAYLOAD_HASHES).every(([p,h])=>exists(root,p)&&sha256File(path.join(root,p))===h);}catch(_){return false;}
}

function preflight(root,{recordBaseline=true}={}){
  const checks=[];
  const add=(name,ok,value)=>checks.push({name,ok:Boolean(ok),...(value!==undefined?{value}: {})});
  add('Node >=20',nodeVersionOk(),process.version);
  add('package.json',exists(root,'package.json'));
  add('No active AUDIT12 transaction',!fs.existsSync(activePath(root)));
  const safety=runtimeSafety(); add('BettingApp/server port 3000 stopped',!safety.serverListening3000,safety); add('ngrok stopped before patch',!safety.ngrokRunning,safety);
  for(const p of [FILES.queue,FILES.paper,FILES.queueTest,'tools/test-tennis-patch51-runtime-idempotency.js']) add(`Target ${p}`,exists(root,p));
  add(`New module ${FILES.gate} not present`,!exists(root,FILES.gate));
  add(`New test ${FILES.audit12Test} not present`,!exists(root,FILES.audit12Test));
  for(const suite of BASE_REGRESSION_SUITES) add(`Regression suite ${suite}`,exists(root,suite));
  for(const h of baselineHashChecks(root)) checks.push({name:`Baseline hash ${h.file}`,ok:h.ok,expected:h.expected,actual:h.actual,reason:h.reason});
  add('AUDIT12 not already applied',!isPatched(root));
  const failures=checks.filter(x=>!x.ok);
  let baseline=[];
  if(!failures.length){
    baseline=runSuites(root,BASE_REGRESSION_SUITES);
    for(const s of baseline) checks.push({name:`Baseline regression ${s.file}`,ok:s.passed,value:{exitCode:s.exitCode,timedOut:s.timedOut,durationMs:s.durationMs}});
  }
  const allFailures=checks.filter(x=>!x.ok);
  const out={success:allFailures.length===0,patch:PATCH_ID,action:'preflight',root,node:process.version,checks,failures:allFailures,databaseSha256:dbHash(root),at:new Date().toISOString()};
  logJson(root,'preflight.json',out);
  if(recordBaseline&&out.success) logJson(root,'regression_baseline.json',{patch:PATCH_ID,at:out.at,databaseSha256:out.databaseSha256,suites:baseline});
  return out;
}

function createBackup(root){
  const dir=path.join(stateDir(root),`backup-${nowId()}`); ensureDir(dir);
  const files=[];
  for(const p of [FILES.queue,FILES.paper,FILES.queueTest,FILES.gate,FILES.audit12Test]){
    const src=path.join(root,p),dst=path.join(dir,p),existed=fs.existsSync(src);
    if(existed){ensureDir(path.dirname(dst));fs.copyFileSync(src,dst);}
    files.push({path:p,existedBefore:existed,beforeSha256:existed?sha256File(src):null,backupSha256:existed?sha256File(dst):null});
  }
  const manifest={patch:PATCH_ID,createdAt:new Date().toISOString(),root,backupDir:dir,files,databaseSha256Before:dbHash(root),status:'BACKUP_CREATED'};
  jsonWrite(path.join(dir,'backup_manifest.json'),manifest); return manifest;
}

function restoreBackup(root,manifest,reason='manual'){
  const restored=[];
  for(const item of manifest.files||[]){
    const dst=path.join(root,item.path);
    if(item.existedBefore){
      const src=path.join(manifest.backupDir,item.path); if(!fs.existsSync(src))throw new Error(`Backup mancante: ${src}`);
      ensureDir(path.dirname(dst)); fs.copyFileSync(src,dst); const actual=sha256File(dst);
      if(actual!==item.beforeSha256)throw new Error(`Rollback hash mismatch: ${item.path}`);
      restored.push({file:item.path,action:'RESTORED',sha256:actual,ok:true});
    }else{
      if(fs.existsSync(dst))fs.unlinkSync(dst); restored.push({file:item.path,action:'REMOVED_NEW_FILE',ok:!fs.existsSync(dst)});
    }
  }
  if(fs.existsSync(activePath(root)))fs.unlinkSync(activePath(root));
  const out={success:true,patch:PATCH_ID,action:'rollback',reason,restored,databaseSha256After:dbHash(root),databaseUnchanged:!manifest.databaseSha256Before||manifest.databaseSha256Before===dbHash(root),at:new Date().toISOString()};
  logJson(root,'rollback.json',out); return out;
}

function recordedPreflightStillValid(root){
  try{
    const pf=JSON.parse(fs.readFileSync(path.join(evidenceDir(root),'preflight.json'),'utf8'));
    const baseline=JSON.parse(fs.readFileSync(path.join(evidenceDir(root),'regression_baseline.json'),'utf8'));
    if(pf?.success!==true||pf?.root!==root||!pf?.at)return false;
    if((Date.now()-Date.parse(pf.at))>30*60*1000)return false;
    if(fs.existsSync(activePath(root))||isPatched(root))return false;
    if(baselineHashChecks(root).some(x=>!x.ok))return false;
    const h=dbHash(root);return pf.databaseSha256===h&&baseline.databaseSha256===h&&Array.isArray(baseline.suites)&&baseline.suites.every(x=>x.passed===true);
  }catch(_){return false;}
}

function payloadSource(name){return path.join(__dirname,'payload',name);}
function installPayload(root){
  const mapping=[
    [FILES.gate,'settlementResolutionEvidenceGateAudit12.js'],
    [FILES.queue,'tennisSettlementExceptionQueuePatch51.js'],
    [FILES.paper,'paperTrading.tennis.js'],
    [FILES.queueTest,'test-tennis-patch51-settlement-exception-queue.js'],
    [FILES.audit12Test,'test-tennis-audit12-settlement-resolution-evidence.js']
  ];
  for(const [target,name] of mapping){
    const src=payloadSource(name),dst=path.join(root,target),expected=PAYLOAD_HASHES[target];
    if(!fs.existsSync(src))throw new Error(`Payload mancante: ${src}`);
    const actual=sha256File(src);if(actual!==expected)throw new Error(`Payload hash mismatch ${target}: ${actual}`);
    ensureDir(path.dirname(dst));fs.copyFileSync(src,dst);
  }
}

function syntaxCheck(root){
  return [FILES.gate,FILES.queue,FILES.paper,FILES.queueTest,FILES.audit12Test].map(p=>{
    const r=cp.spawnSync(process.execPath,['--check',path.join(root,p)],{cwd:root,encoding:'utf8',windowsHide:true});
    return{file:p,ok:r.status===0,exitCode:r.status,stderr:String(r.stderr||'').slice(-3000)};
  });
}

function staticInvariants(root){
  const queue=readText(root,FILES.queue),paper=readText(root,FILES.paper),gate=readText(root,FILES.gate),test=readText(root,FILES.audit12Test);
  return [
    {name:'AUDIT12 gate version',ok:gate.includes("AUDIT12_SETTLEMENT_RESOLUTION_EVIDENCE_GATE_V1")},
    {name:'Official tiers restricted',ok:gate.includes("new Set(['CERTIFIED', 'PROVIDER'])")},
    {name:'Manual exceptions fail closed',ok:gate.includes("reasons.push('MANUAL_ACTION_REQUIRED')")},
    {name:'Fingerprint coherence enforced',ok:gate.includes('EVENT_FINGERPRINT_MISMATCH')&&gate.includes('MARKET_FINGERPRINT_MISMATCH')},
    {name:'Evidence timestamp coherence enforced',ok:gate.includes('EVIDENCE_BEFORE_EVENT_START')&&gate.includes('SETTLED_BEFORE_EVIDENCE_OBSERVED')},
    {name:'Queue imports AUDIT12 gate',ok:queue.includes("require('./settlementResolutionEvidenceGateAudit12')")},
    {name:'Queue exposes resolution blocked action',ok:queue.includes("RESOLUTION_BLOCKED: 'RESOLUTION_BLOCKED'")},
    {name:'Queue resolves only after inspection',ok:queue.includes('const inspection = inspectResolution(db, betId')&&queue.includes('if (inspection.action === ACTIONS.RESOLUTION_BLOCKED)')},
    {name:'Resolved queue stores resolution proof',ok:queue.includes('gate.resolutionEvidenceHash')&&queue.includes('resolutionPolicyVersion')},
    {name:'Atomic paper lifecycle aborts blocked resolution',ok:paper.includes('AUDIT12_SETTLEMENT_EXCEPTION_RESOLUTION_BLOCKED')},
    {name:'No automatic real-money activation introduced',ok:!gate.includes('automaticProductionActivation: true')&&!queue.includes('automaticProductionActivation: true')&&!paper.includes('automaticProductionActivation: true')},
    {name:'AUDIT12 regression test installed',ok:test.includes("patch:'AUDIT12'")&&test.includes('official evidence resolves')}
  ];
}

function targetedTests(root){return [FILES.audit12Test,FILES.queueTest,'tools/test-tennis-patch51-runtime-idempotency.js'].map(f=>command(root,f,30000));}

function apply(root){
  const pf=recordedPreflightStillValid(root)?JSON.parse(fs.readFileSync(path.join(evidenceDir(root),'preflight.json'),'utf8')):preflight(root,{recordBaseline:true});
  if(!pf.success)return{success:false,patch:PATCH_ID,action:'apply',reason:'PREFLIGHT_FAILED',preflight:pf};
  const backup=createBackup(root);jsonWrite(activePath(root),backup);
  try{
    installPayload(root);
    const syntax=syntaxCheck(root);if(syntax.some(x=>!x.ok))throw new Error(`Syntax check fallito: ${JSON.stringify(syntax.filter(x=>!x.ok))}`);
    const checks=staticInvariants(root),failed=checks.filter(x=>!x.ok);if(failed.length)throw new Error(`Invariant statico fallito: ${JSON.stringify(failed)}`);
    const tests=targetedTests(root),testFailures=tests.filter(x=>!x.passed);if(testFailures.length)throw new Error(`Targeted tests falliti: ${JSON.stringify(testFailures.map(x=>({file:x.file,exitCode:x.exitCode,timedOut:x.timedOut,stderr:x.stderrTail})))}`);
    const afterDb=dbHash(root);if(backup.databaseSha256Before&&backup.databaseSha256Before!==afterDb)throw new Error('DATABASE_CHANGED_DURING_APPLY');
    const out={success:true,patch:PATCH_ID,action:'apply',backupDir:backup.backupDir,syntax,checks,targetedTests:tests,hashesAfter:Object.keys(PAYLOAD_HASHES).map(p=>({file:p,sha256:sha256File(path.join(root,p))})),database:{before:backup.databaseSha256Before,after:afterDb,unchanged:backup.databaseSha256Before===afterDb},at:new Date().toISOString()};
    logJson(root,'apply.json',out);return out;
  }catch(error){const rb=restoreBackup(root,backup,`apply-failure: ${error.message}`);const out={success:false,patch:PATCH_ID,action:'apply',error:error.message,rollback:rb,at:new Date().toISOString()};logJson(root,'apply_failed.json',out);return out;}
}

function verify(root){
  const syntax=syntaxCheck(root),checks=staticInvariants(root),tests=targetedTests(root);
  let before=null;try{before=JSON.parse(fs.readFileSync(activePath(root),'utf8')).databaseSha256Before||null}catch(_){}
  const after=dbHash(root);checks.push({name:'Database untouched by AUDIT12 apply',ok:!before||before===after,before,after});
  const failed=[...syntax.filter(x=>!x.ok),...checks.filter(x=>!x.ok),...tests.filter(x=>!x.passed).map(x=>({name:`Targeted ${x.file}`,ok:false,value:x}))];
  const out={success:failed.length===0,patch:PATCH_ID,action:'verify',syntax,checks,targetedTests:tests,failed,at:new Date().toISOString()};logJson(root,'verify.json',out);return out;
}

function regression(root){
  const baselineFile=path.join(evidenceDir(root),'regression_baseline.json');if(!fs.existsSync(baselineFile))return{success:false,patch:PATCH_ID,action:'regression',reason:'BASELINE_MISSING'};
  const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8')),post=runSuites(root,POST_REGRESSION_SUITES);
  const comparisons=post.map(after=>{const before=baseline.suites.find(x=>x.file===after.file);return{file:after.file,beforePresent:Boolean(before),beforePassed:Boolean(before?.passed),afterPassed:Boolean(after.passed),newRegression:Boolean(before?.passed&&!after.passed),newAudit12Suite:!before,beforeExit:before?.exitCode??null,afterExit:after.exitCode??null,beforeTimedOut:Boolean(before?.timedOut),afterTimedOut:Boolean(after.timedOut),beforeDurationMs:before?.durationMs??null,afterDurationMs:after.durationMs??null};});
  const newRegressions=comparisons.filter(x=>x.newRegression),postFailures=post.filter(x=>!x.passed);
  const invariants=staticInvariants(root),invariantFailures=invariants.filter(x=>!x.ok);
  const afterHash=dbHash(root),unchanged=!baseline.databaseSha256||baseline.databaseSha256===afterHash;
  const success=newRegressions.length===0&&postFailures.length===0&&invariantFailures.length===0&&unchanged;
  const out={success,patch:PATCH_ID,action:'regression',at:new Date().toISOString(),policy:'Tutte le suite verdi pre-AUDIT12 devono restare verdi; la nuova suite AUDIT12 deve essere verde; DB byte-identico. Nessuna exception viene risolta dalla patch.',comparisons,newRegressions,postFailures:postFailures.map(x=>({file:x.file,timedOut:x.timedOut,exitCode:x.exitCode})),invariantFailures,database:{before:baseline.databaseSha256||null,after:afterHash,unchanged},post};
  logJson(root,'regression_post.json',out);return out;
}

function rollback(root){if(!fs.existsSync(activePath(root)))return{success:false,patch:PATCH_ID,action:'rollback',reason:'NO_ACTIVE_BACKUP'};return restoreBackup(root,JSON.parse(fs.readFileSync(activePath(root),'utf8')),'requested');}
function status(root){return{patch:PATCH_ID,root,applied:isPatched(root),activeBackup:fs.existsSync(activePath(root)),hashes:Object.keys(PAYLOAD_HASHES).map(p=>({file:p,exists:exists(root,p),sha256:exists(root,p)?sha256File(path.join(root,p)):null})),databaseSha256:dbHash(root),at:new Date().toISOString()};}

const action=String(process.argv[2]||'status').toLowerCase();
const root=normalizeRoot(process.argv[3]||path.join(__dirname,'..'));
let result;
try{
  if(action==='preflight')result=preflight(root,{recordBaseline:true});
  else if(action==='apply')result=apply(root);
  else if(action==='verify')result=verify(root);
  else if(action==='regression')result=regression(root);
  else if(action==='rollback')result=rollback(root);
  else if(action==='status')result=status(root);
  else throw new Error(`Azione sconosciuta: ${action}`);
}catch(error){result={success:false,patch:PATCH_ID,action,root,error:error.stack||error.message,at:new Date().toISOString()};}
console.log(JSON.stringify(result,null,2));
process.exit(result.success===false?1:0);
