#!/usr/bin/env node
'use strict';
const assert=require('assert'); const fs=require('fs'); const os=require('os'); const path=require('path');
const mod=require('../backend/tennisRejectedCaptureObservability'); const gate=require('../backend/tennisPrematchCaptureGate');
let DB; try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-p32-tx-')); const db=new DB(path.join(tmp,'tx.db')); const checks=[]; function check(n,f){try{f();checks.push({name:n,ok:true});}catch(e){checks.push({name:n,ok:false,error:e.message});}}
try{
 db.exec('CREATE TABLE ai_forward_test(id INTEGER PRIMARY KEY, home_team TEXT, away_team TEXT, status TEXT)'); mod.ensureSchema(db);
 let rejection=null; const row={id:1,canonical_match_datetime:'2026-08-02T20:30:00',home_team:'A',away_team:'B',league:'ATP',tennis_event_fingerprint:'e',tennis_market_fingerprint:'m',prediction:'1',odd:1.9,estimated_prob:55,model_version:'M',metric_version:'K',engine_version:'E'};
 try{
   db.exec('BEGIN IMMEDIATE'); db.prepare("INSERT INTO ai_forward_test(id,home_team,away_team,status) VALUES(1,'A','B','PENDING')").run();
   const decision=gate.buildGateDecision(row,{captureAt:'2026-08-02T18:31:00.000Z',checkedAt:'2026-08-02T18:31:00.000Z'}); if(!decision.allowed){rejection=decision; const e=new Error('blocked');e.code='PATCH29_R3_PREMATCH_CAPTURE_GATE_BLOCKED';throw e;} db.exec('COMMIT');
 }catch(e){try{db.exec('ROLLBACK');}catch(_){} if(e.code!=='PATCH29_R3_PREMATCH_CAPTURE_GATE_BLOCKED')throw e; mod.recordRejectedCapture(db,mod.buildAttemptContext({reference_market_source:'TX_TEST',home_team:'A',away_team:'B',tennis_event_fingerprint:'e',tennis_market_fingerprint:'m',provider_timestamp:'2026-08-02T18:27:00.000Z'}, {}, {operationId:'tx-op'}),rejection,{observedAt:'2026-08-02T18:31:01.000Z'});}
 check('prediction rollback completo',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,0));
 check('rifiuto osservabile fuori transazione',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM tennis_rejected_capture_ledger').get().n,1));
 check('ledger non crea previsione',()=>assert.equal(mod.buildObservabilityReport(db).authority.predictionPersistence,false));
 check('ledger non modifica stake',()=>assert.equal(mod.buildObservabilityReport(db).authority.stake,false));
 check('ledger non modifica quality gate',()=>assert.equal(mod.buildObservabilityReport(db).authority.qualityGate,false));
 check('ledger non modifica settlement',()=>assert.equal(mod.buildObservabilityReport(db).authority.settlement,false));
}finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
