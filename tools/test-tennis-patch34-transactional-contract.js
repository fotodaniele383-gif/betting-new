#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const schedule=require('../backend/tennisOfficialScheduleAuthority');const eventTime=require('../backend/tennisCanonicalEventTime');const rejected=require('../backend/tennisRejectedCaptureObservability');
let DB;try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-p34-tx-'));const db=new DB(path.join(tmp,'tx.db'));const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
try{
  db.exec('CREATE TABLE ai_forward_test(id INTEGER PRIMARY KEY,home_team TEXT,away_team TEXT,status TEXT)');eventTime.ensureSchema(db);schedule.ensureSchema(db);rejected.ensureSchema(db);
  const raw={home_team:'A',away_team:'B',league:'ATP',tennis_event_fingerprint:'evt-cancel',tennis_market_fingerprint:'mkt-cancel',prediction:'1',provider_event_id:'p-cancel',canonical_match_datetime:'2026-08-03T21:00:00',official_schedule_status:'cancelled',official_schedule_provider:'ATP_OFFICIAL'};
  let timeDecision,scheduleDecision,gateDecision;
  try{
    db.exec('BEGIN IMMEDIATE');db.prepare("INSERT INTO ai_forward_test(id,home_team,away_team,status) VALUES(1,'A','B','PENDING')").run();
    timeDecision=eventTime.resolveCanonicalEventTime(raw,raw,{observedAt:'2026-08-03T10:00:00Z',defaultTimeZone:'Europe/Rome'});
    scheduleDecision=schedule.resolveScheduleLifecycle(raw,raw,{observedAt:'2026-08-03T10:00:00Z',eventTimeDecision:timeDecision});
    if(!scheduleDecision.allowCapture){gateDecision=schedule.toGateBlockDecision(scheduleDecision,'2026-08-03T10:00:00Z');const error=new Error('blocked');error.code='PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCKED';throw error;}
    db.exec('COMMIT');
  }catch(error){
    try{db.exec('ROLLBACK');}catch(_){}if(error.code!=='PATCH34_OFFICIAL_SCHEDULE_LIFECYCLE_BLOCKED')throw error;
    const timeRev=eventTime.recordEventTimeRevision(db,timeDecision,{captureOutcome:'REJECTED'});
    const receipt=schedule.recordScheduleReceipt(db,scheduleDecision,{captureOutcome:'REJECTED',eventTimeRevisionId:timeRev.revision.revision_id});
    const context=rejected.buildAttemptContext(raw,{}, {operationId:'p34-cancel',eventTimeContract:timeDecision,eventTimeRevisionId:timeRev.revision.revision_id,scheduleLifecycle:scheduleDecision,scheduleReceiptId:receipt.receipt.receipt_id});
    rejected.recordRejectedCapture(db,context,gateDecision,{observedAt:'2026-08-03T10:00:01Z'});
  }
  check('cancelled rollback prediction',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,0));
  check('ricevuta rejected conservata',()=>assert.equal(db.prepare("SELECT COUNT(*) n FROM tennis_schedule_receipts WHERE capture_outcome='REJECTED'").get().n,1));
  check('ledger rifiuti conserva schedule',()=>assert.equal(db.prepare('SELECT schedule_status FROM tennis_rejected_capture_ledger LIMIT 1').get().schedule_status,'CANCELLED'));
  check('nessun settlement derivato',()=>assert.equal(schedule.buildScheduleHealthReport(db).authority.settlement,false));

  const acceptedRaw={home_team:'C',away_team:'D',league:'WTA',tennis_event_fingerprint:'evt-ok',tennis_market_fingerprint:'mkt-ok',prediction:'2',provider_event_id:'p-ok',canonical_match_datetime:'2026-08-03T22:00:00',official_schedule_status:'scheduled',official_schedule_provider:'WTA_OFFICIAL'};
  db.exec('BEGIN IMMEDIATE');
  db.prepare("INSERT INTO ai_forward_test(id,home_team,away_team,status) VALUES(2,'C','D','PENDING')").run();
  const acceptedTime=eventTime.resolveCanonicalEventTime(acceptedRaw,acceptedRaw,{observedAt:'2026-08-03T10:00:00Z',defaultTimeZone:'Europe/Rome'});
  const acceptedSchedule=schedule.resolveScheduleLifecycle(acceptedRaw,acceptedRaw,{observedAt:'2026-08-03T10:00:00Z',eventTimeDecision:acceptedTime});
  const timeRev=eventTime.recordEventTimeRevision(db,acceptedTime,{captureOutcome:'ACCEPTED'});
  const receipt=schedule.recordScheduleReceipt(db,acceptedSchedule,{captureOutcome:'ACCEPTED',eventTimeRevisionId:timeRev.revision.revision_id});
  const tokenResult=schedule.assertCaptureTokenStable(db,receipt.captureToken);
  db.exec('COMMIT');
  check('scheduled commit prediction',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,1));
  check('accepted receipt registrata',()=>assert.equal(db.prepare("SELECT COUNT(*) n FROM tennis_schedule_receipts WHERE capture_outcome='ACCEPTED'").get().n,1));
  check('race token stabile prima commit',()=>assert.equal(tokenResult.stable,true));
  check('catena schedule sana',()=>assert.equal(schedule.verifyReceiptChain(db).healthy,true));
  check('catena event time sana',()=>assert.equal(eventTime.verifyEventChain(db).healthy,true));
  check('catena rejected sana',()=>assert.equal(rejected.verifyLedgerChain(db).healthy,true));
}finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_34_R3_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE',checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
