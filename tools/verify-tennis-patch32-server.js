#!/usr/bin/env node
'use strict';
const assert=require('assert'); const fs=require('fs'); const path=require('path'); const cp=require('child_process');
const root=path.resolve(__dirname,'..'); const registry=require('../backend/tennisPatchRegistry'); const mod=require('../backend/tennisRejectedCaptureObservability'); const checks=[];
function check(n,f){try{f();checks.push({name:n,ok:true});}catch(e){checks.push({name:n,ok:false,error:e.message});}}
const files=['backend/server.tennis.js','backend/tennisRejectedCaptureObservability.js','backend/migrateTennisPatch32.js','backend/tennisProgramProgressionAudit.js','backend/tennisRuntimeHealthContract.js','backend/tennisPatchRegistry.js'];
for(const file of files)check(`syntax ${file}`,()=>{const r=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);});
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8'); const health=fs.readFileSync(path.join(root,'backend/tennisRuntimeHealthContract.js'),'utf8');
check('registry 32',()=>assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION,'32'));
check('registry V32',()=>assert.equal(registry.TENNIS_PATCH_REGISTRY_VERSION,'TENNIS_PATCH_REGISTRY_V32'));
check('Patch32 attiva',()=>assert(registry.PATCHES.some(x=>String(x.version)==='32'&&x.status==='ACTIVE')));
check('modulo importato',()=>assert(server.includes("require('./tennisRejectedCaptureObservability')")));
check('endpoint collegato',()=>assert(server.includes("router.get('/rejected-capture-observability'")));
check('record dopo catch gate',()=>assert(server.indexOf('recordRejectedCapture(')>server.indexOf("error.code === 'PATCH29_R3_PREMATCH_CAPTURE_GATE_BLOCKED'")));
check('rollback previsione dichiarato',()=>assert(server.includes('predictionPersistenceRolledBack: true')));
check('errore ledger non riabilita giocata',()=>assert(server.includes('rejectedCaptureLedgerAppendFailed')));
check('health role observability',()=>assert(health.includes('tennisRejectedCaptureObservability: COMPONENT_ROLES.OBSERVABILITY')));
check('self check modulo',()=>assert.equal(mod.selfCheck().ok,true));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
