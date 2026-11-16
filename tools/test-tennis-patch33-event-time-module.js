#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const mod=require('../backend/tennisCanonicalEventTime');
let DB;try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-p33-time-'));const db=new DB(path.join(tmp,'test.db'));const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
try{
  const self=mod.selfCheck();
  check('self-check completo',()=>assert.equal(self.ok,true));
  check('estate Roma convertita in UTC',()=>assert.equal(mod.parseTime('2026-08-03T21:00:00',{timeZone:'Europe/Rome'}).epochMs,Date.parse('2026-08-03T19:00:00Z')));
  const fold=mod.parseTime('2026-10-25T02:30:00',{timeZone:'Europe/Rome'});
  check('ora solare ambigua bloccata',()=>assert.equal(fold.dstStatus,'AMBIGUOUS'));
  check('fold DST ha due istanti',()=>assert.equal(fold.candidates.length,2));
  check('ora primaverile inesistente bloccata',()=>assert.equal(mod.parseTime('2026-03-29T02:30:00',{timeZone:'Europe/Rome'}).dstStatus,'NONEXISTENT'));
  const conflict=mod.resolveCanonicalEventTime(
    {official_match_start_at:'2026-08-03T19:00:00Z',provider_event_id:'evt-1',tennis_event_fingerprint:'fp-1'},
    {commence_time:'2026-08-03T18:30:00Z',event_time_source_id:'ODDS_X'},
    {observedAt:'2026-08-03T10:00:00Z'}
  );
  check('fonte ufficiale resta canonica',()=>assert.equal(conflict.selected.sourceKind,'OFFICIAL_SCHEDULE'));
  check('conflitto materiale rilevato',()=>assert.equal(conflict.qualityStatus,mod.QUALITY_STATES.REVIEW_PROVIDER_CONFLICT));
  check('sicurezza usa orario più anticipato',()=>assert.equal(conflict.safetyStartAtUtc,'2026-08-03T18:30:00.000Z'));
  check('nessuna autorità su modello',()=>assert.equal(conflict.authority.productionProbability,false));
  check('nessuna autorità su stake',()=>assert.equal(conflict.authority.stake,false));
  const schema=mod.ensureSchema(db);
  check('schema ledger sano',()=>assert.equal(mod.schemaHealth(db).healthy,true));
  check('trigger append-only presenti',()=>assert.equal(mod.schemaHealth(db).appendOnly,true));
  const initial=mod.resolveCanonicalEventTime({canonical_match_datetime:'2026-08-03T21:00:00',provider_event_id:'evt-2',tennis_event_fingerprint:'fp-2'},{},{observedAt:'2026-08-03T10:00:00Z'});
  const first=mod.recordEventTimeRevision(db,initial,{captureOutcome:'ACCEPTED'});
  const delayed=mod.resolveCanonicalEventTime({official_match_start_at:'2026-08-03T20:00:00Z',provider_event_id:'evt-2',tennis_event_fingerprint:'fp-2'},{},{observedAt:'2026-08-03T11:00:00Z'});
  const second=mod.recordEventTimeRevision(db,delayed,{captureOutcome:'ACCEPTED'});
  check('prima revisione initial',()=>assert.equal(first.revision.revision_type,'INITIAL'));
  check('rinvio successivo classificato',()=>assert.equal(second.revision.revision_type,'RESCHEDULED_LATER'));
  check('catena hash sana',()=>assert.equal(mod.verifyEventChain(db,'fp-2').healthy,true));
  check('update ledger bloccato',()=>assert.throws(()=>db.prepare("UPDATE tennis_event_time_revisions SET source_id='X' WHERE id=1").run(),/APPEND_ONLY/));
  check('delete ledger bloccato',()=>assert.throws(()=>db.prepare('DELETE FROM tennis_event_time_revisions WHERE id=1').run(),/APPEND_ONLY/));
  const report=mod.buildProviderTimeQualityReport(db,{limit:10});
  check('report provider sano',()=>assert.equal(report.healthy,true));
  check('forward-only dichiarato',()=>assert.equal(report.noHistoricalBackfill,true));
  check('nessun override automatico',()=>assert.equal(report.automaticGateOverride,false));
  check('authority capture separata',()=>assert.equal(report.authority.captureTime,true));
}finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY',checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
