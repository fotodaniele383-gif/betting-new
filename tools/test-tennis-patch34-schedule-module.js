#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const mod=require('../backend/tennisOfficialScheduleAuthority');
let DB;try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-p34-schedule-'));const db=new DB(path.join(tmp,'test.db'));const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
function time(utc){return{version:'TENNIS_CANONICAL_EVENT_TIME_CONTRACT_V1_PATCH33',allowCapture:true,safetyStartEpochMs:Date.parse(utc),canonicalStartEpochMs:Date.parse(utc),qualityStatus:'CERTIFIED_HIGH'};}
try{
  const schema=mod.ensureSchema(db);
  check('self check completo',()=>assert.equal(mod.selfCheck().ok,true));
  check('schema sano',()=>assert.equal(schema.healthy,true));
  check('append-only attivo',()=>assert.equal(schema.appendOnly,true));
  const scheduled=mod.resolveScheduleLifecycle({tennis_event_fingerprint:'evt-1'},{official_schedule_status:'scheduled',official_schedule_provider:'ATP_OFFICIAL'},{observedAt:'2026-08-03T10:00:00Z',eventTimeDecision:time('2026-08-03T19:00:00Z')});
  const cancelled=mod.resolveScheduleLifecycle({tennis_event_fingerprint:'evt-2'},{official_schedule_status:'cancelled',official_schedule_provider:'WTA_OFFICIAL'},{observedAt:'2026-08-03T10:00:00Z',eventTimeDecision:time('2026-08-03T19:00:00Z')});
  const delayed=mod.resolveScheduleLifecycle({tennis_event_fingerprint:'evt-3'},{provider_schedule_status:'rain delay',provider_name:'PRIMARY_EVENT'},{observedAt:'2026-08-03T10:00:00Z',eventTimeDecision:time('2026-08-03T19:00:00Z')});
  const conflict=mod.resolveScheduleLifecycle({tennis_event_fingerprint:'evt-4'},{official_schedule_status:'scheduled',provider_schedule_status:'suspended'},{observedAt:'2026-08-03T10:00:00Z',eventTimeDecision:time('2026-08-03T19:00:00Z')});
  check('official scheduled consentito',()=>assert.equal(scheduled.allowCapture,true));
  check('official authority alta',()=>assert(scheduled.selected.authority>=95));
  check('cancelled bloccato',()=>assert.equal(cancelled.allowCapture,false));
  check('delayed futuro review',()=>assert.equal(delayed.disposition,mod.CAPTURE_DISPOSITIONS.ALLOW_WITH_REVIEW));
  check('conflitto credibile bloccato',()=>assert.equal(conflict.allowCapture,false));
  check('nessuna autorità settlement',()=>assert.equal(scheduled.authority.settlement,false));
  const first=mod.recordScheduleReceipt(db,scheduled,{captureOutcome:'ACCEPTED',eventTimeRevisionId:'TET33_A'});
  const laterDecision=mod.resolveScheduleLifecycle({tennis_event_fingerprint:'evt-1'},{official_schedule_status:'scheduled',official_schedule_provider:'ATP_OFFICIAL'},{observedAt:'2026-08-03T11:00:00Z',eventTimeDecision:time('2026-08-03T20:00:00Z')});
  const second=mod.recordScheduleReceipt(db,laterDecision,{captureOutcome:'ACCEPTED',eventTimeRevisionId:'TET33_B'});
  const duplicate=mod.recordScheduleReceipt(db,laterDecision,{captureOutcome:'ACCEPTED',eventTimeRevisionId:'TET33_B'});
  check('prima transizione initial',()=>assert.equal(first.receipt.transition_type,'INITIAL'));
  check('rinvio successivo rilevato',()=>assert.equal(second.receipt.transition_type,'RESCHEDULED_LATER'));
  check('deduplica osservazione',()=>assert.equal(duplicate.duplicate,true));
  check('catena hash sana',()=>assert.equal(mod.verifyReceiptChain(db,'evt-1').healthy,true));
  check('capture token ultimo stabile',()=>assert.equal(mod.assertCaptureTokenStable(db,second.captureToken).stable,true));
  check('capture token vecchio rileva race',()=>assert.throws(()=>mod.assertCaptureTokenStable(db,first.captureToken),/RACE_DETECTED/));
  check('update ledger bloccato',()=>assert.throws(()=>db.prepare("UPDATE tennis_schedule_receipts SET source_id='X' WHERE id=1").run(),/APPEND_ONLY/));
  check('delete ledger bloccato',()=>assert.throws(()=>db.prepare('DELETE FROM tennis_schedule_receipts WHERE id=1').run(),/APPEND_ONLY/));
  const report=mod.buildScheduleHealthReport(db,{limit:10});
  check('report sano',()=>assert.equal(report.healthy,true));
  check('race guard dichiarato',()=>assert.equal(report.captureRaceGuard,true));
  check('no historical backfill',()=>assert.equal(report.noHistoricalBackfill,true));
  check('settlement automatico assente',()=>assert.equal(report.automaticSettlement,false));
}finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_34_R3_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE',checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
