#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const cp=require('child_process');
const root=path.resolve(__dirname,'..');const registry=require('../backend/tennisPatchRegistry');const mod=require('../backend/tennisCanonicalEventTime');const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
const files=['backend/server.tennis.js','backend/tennisCanonicalEventTime.js','backend/migrateTennisPatch33.js','backend/tennisRejectedCaptureObservability.js','backend/tennisPredictionSnapshots.js','backend/tennisProgramProgressionAudit.js','backend/tennisRuntimeHealthContract.js','backend/tennisPatchRegistry.js'];
for(const file of files)check(`syntax ${file}`,()=>{const r=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);});
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');const health=fs.readFileSync(path.join(root,'backend/tennisRuntimeHealthContract.js'),'utf8');const snapshots=fs.readFileSync(path.join(root,'backend/tennisPredictionSnapshots.js'),'utf8');
check('registry 33',()=>assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION,'33'));
check('registry V33',()=>assert.equal(registry.TENNIS_PATCH_REGISTRY_VERSION,'TENNIS_PATCH_REGISTRY_V33'));
check('Patch33 attiva',()=>assert(registry.PATCHES.some(x=>String(x.version)==='33'&&x.status==='ACTIVE')));
check('modulo event time importato',()=>assert(server.includes("require('./tennisCanonicalEventTime')")));
check('contratto eseguito prima del gate',()=>assert(server.indexOf('resolveCanonicalEventTime(')<server.indexOf('assertPrematchCaptureAllowed(certifiedPersistedRow')));
check('blocco Patch33 esplicito',()=>assert(server.includes('PATCH33_CANONICAL_EVENT_TIME_BLOCKED')));
check('revisione accepted dentro transazione',()=>{const txStart=server.indexOf('const transaction = db.transaction(() =>');const accepted=server.indexOf("captureOutcome: 'ACCEPTED'",txStart);const txRun=server.indexOf('const result = transaction();',accepted);assert(txStart>=0&&accepted>txStart&&txRun>accepted);});
check('revisione rejected post rollback',()=>assert(server.indexOf("captureOutcome: 'REJECTED'")>server.indexOf("try { db.exec('ROLLBACK'); }")));
check('endpoint health collegato',()=>assert(server.includes("router.get('/canonical-event-time-health'")));
check('health role required capture',()=>assert(health.includes('tennisCanonicalEventTime: COMPONENT_ROLES.REQUIRED_CAPTURE')));
check('snapshot usa safety UTC',()=>assert(snapshots.includes('canonical_event_time_safety_utc')));
check('self check modulo',()=>assert.equal(mod.selfCheck().ok,true));
check('nessuna chiamata rete modulo',()=>assert(!/axios|fetch\(|https?:\/\//i.test(fs.readFileSync(path.join(root,'backend/tennisCanonicalEventTime.js'),'utf8'))));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY',checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
