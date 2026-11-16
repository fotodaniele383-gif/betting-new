#!/usr/bin/env node
'use strict';
const assert=require('assert'); const fs=require('fs'); const os=require('os'); const path=require('path');
const mod=require('../backend/tennisRejectedCaptureObservability'); const gate=require('../backend/tennisPrematchCaptureGate');
let DB; try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-p32-module-')); const dbPath=path.join(tmp,'test.db'); const db=new DB(dbPath);
const checks=[]; function check(name,fn){try{fn();checks.push({name,ok:true});}catch(e){checks.push({name,ok:false,error:e.message});}}
try{
 const schema=mod.ensureSchema(db);
 check('schema sano',()=>assert.equal(schema.healthy,true));
 check('self check',()=>assert.equal(mod.selfCheck().ok,true));
 const context=mod.buildAttemptContext({reference_market_source:'PROVIDER_X',home_team:'A',away_team:'B',tour_type:'ATP',tennis_event_fingerprint:'event-x',tennis_market_fingerprint:'market-x',prediction:'1',provider_timestamp:'2026-08-02T18:27:00.000Z'}, {}, {operationId:'op-x'});
 const decision=gate.buildGateDecision({id:9,canonical_match_datetime:'2026-08-02T20:30:00',home_team:'A',away_team:'B',league:'ATP',tennis_event_fingerprint:'event-x',tennis_market_fingerprint:'market-x',prediction:'1',odd:1.9,estimated_prob:55,model_version:'M',metric_version:'K',engine_version:'E'}, {captureAt:'2026-08-02T18:31:00.000Z',checkedAt:'2026-08-02T18:31:00.000Z'});
 const first=mod.recordRejectedCapture(db,context,decision,{observedAt:'2026-08-02T18:31:01.000Z'});
 const second=mod.recordRejectedCapture(db,{...context,operationId:'op-y'},decision,{observedAt:'2026-08-02T18:31:02.000Z'});
 const report=mod.buildObservabilityReport(db,{limit:10}); const chain=mod.verifyLedgerChain(db);
 check('due eventi registrati',()=>assert.equal(report.counts.total,2));
 check('catena hash sana',()=>assert.equal(chain.healthy,true));
 check('secondo hash collegato',()=>assert.equal(second.payload.eventId!==first.payload.eventId,true));
 check('provider normalizzato',()=>assert.equal(report.providers[0].provider,'PROVIDER_X'));
 check('drift rilevato',()=>assert(report.counts.driftSuspects>=1));
 check('false rejection solo review',()=>assert(report.counts.suspectedFalseRejections>=1));
 check('nessun override automatico',()=>assert.equal(report.authority.automaticReactivation,false));
 check('append only update',()=>assert.throws(()=>db.prepare('UPDATE tennis_rejected_capture_ledger SET provider_id=? WHERE id=1').run('X'),/APPEND_ONLY/));
 check('append only delete',()=>assert.throws(()=>db.prepare('DELETE FROM tennis_rejected_capture_ledger WHERE id=1').run(),/APPEND_ONLY/));
 check('payload non contiene token',()=>assert(!/token|secret|password/i.test(JSON.stringify(report.recent))));
}finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
const failed=checks.filter(x=>!x.ok); console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_32_REJECTED_CAPTURE_OBSERVABILITY_CLOCK_DRIFT_LEDGER',checks,passed:checks.length-failed.length,failed:failed.length},null,2)); process.exit(failed.length?1:0);
