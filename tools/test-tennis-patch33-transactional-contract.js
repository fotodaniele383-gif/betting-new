#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const eventTime=require('../backend/tennisCanonicalEventTime');const rejected=require('../backend/tennisRejectedCaptureObservability');
let DB;try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-p33-tx-'));const db=new DB(path.join(tmp,'tx.db'));const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
try{
  db.exec('CREATE TABLE ai_forward_test(id INTEGER PRIMARY KEY, home_team TEXT, away_team TEXT, status TEXT)');
  eventTime.ensureSchema(db);rejected.ensureSchema(db);
  const raw={home_team:'A',away_team:'B',league:'ATP',tennis_event_fingerprint:'evt-amb',tennis_market_fingerprint:'mkt-amb',prediction:'1',provider_event_id:'p-amb',canonical_match_datetime:'2026-10-25T02:30:00'};
  let decision=null,gateDecision=null;
  try{
    db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO ai_forward_test(id,home_team,away_team,status) VALUES(1,'A','B','PENDING')").run();
    decision=eventTime.resolveCanonicalEventTime(raw,raw,{observedAt:'2026-10-24T20:00:00Z',defaultTimeZone:'Europe/Rome'});
    if(!decision.allowCapture){gateDecision=eventTime.toGateBlockDecision(decision,'2026-10-24T20:00:00Z');const error=new Error('blocked');error.code='PATCH33_CANONICAL_EVENT_TIME_BLOCKED';throw error;}
    db.exec('COMMIT');
  }catch(error){
    try{db.exec('ROLLBACK');}catch(_){}
    if(error.code!=='PATCH33_CANONICAL_EVENT_TIME_BLOCKED')throw error;
    const rev=eventTime.recordEventTimeRevision(db,decision,{captureOutcome:'REJECTED'});
    const context=rejected.buildAttemptContext(raw,{}, {operationId:'p33-tx',eventTimeContract:decision,eventTimeRevisionId:rev.revision.revision_id});
    rejected.recordRejectedCapture(db,context,gateDecision,{observedAt:'2026-10-24T20:00:01Z'});
  }
  check('DST ambiguo blocca capture',()=>assert.equal(decision.qualityStatus,eventTime.QUALITY_STATES.BLOCK_DST_AMBIGUOUS));
  check('prediction rollback completo',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,0));
  check('revisione rejected osservabile',()=>assert.equal(db.prepare("SELECT COUNT(*) n FROM tennis_event_time_revisions WHERE capture_outcome='REJECTED'").get().n,1));
  check('ledger rifiuto osservabile',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM tennis_rejected_capture_ledger').get().n,1));
  const row=db.prepare('SELECT * FROM tennis_rejected_capture_ledger LIMIT 1').get();
  check('rifiuto conserva contratto Patch33',()=>assert.equal(row.event_time_contract_version,eventTime.TENNIS_CANONICAL_EVENT_TIME_VERSION));
  check('rifiuto conserva revisione',()=>assert(/^TET33_/.test(row.event_time_revision_id)));
  check('rifiuto non ha autorità prediction',()=>assert.equal(rejected.buildObservabilityReport(db).authority.predictionPersistence,false));
  const accepted=eventTime.resolveCanonicalEventTime({canonical_match_datetime:'2026-08-03T21:00:00',provider_event_id:'p-ok',tennis_event_fingerprint:'evt-ok'},{},{observedAt:'2026-08-03T10:00:00Z'});
  db.exec('BEGIN IMMEDIATE');db.prepare("INSERT INTO ai_forward_test(id,home_team,away_team,status) VALUES(2,'C','D','PENDING')").run();eventTime.recordEventTimeRevision(db,accepted,{captureOutcome:'ACCEPTED'});db.exec('COMMIT');
  check('capture certificata può committare',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,1));
  check('revisione accepted registrata',()=>assert.equal(db.prepare("SELECT COUNT(*) n FROM tennis_event_time_revisions WHERE capture_outcome='ACCEPTED'").get().n,1));
  check('catena globale sana',()=>assert.equal(eventTime.verifyEventChain(db).healthy,true));
}finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY',checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
