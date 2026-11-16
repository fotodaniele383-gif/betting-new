#!/usr/bin/env node
'use strict';
const assert=require('assert');const path=require('path');const mod=require('../backend/tennisCanonicalEventTime');
const root=path.resolve(__dirname,'..');let DB;try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}const db=new DB(path.join(root,'backend','database_betting.db'));const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
try{
 const total=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0),tennis=Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n||0),snapshots=Number(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots').get().n||0),anchors=Number(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE is_calibration_anchor=1').get().n||0),invalid=Number(db.prepare("SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE snapshot_status IN ('POST_START_INVALID','INCOMPLETE')").get().n||0);
 const aiCols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));const rejectedCols=new Set(db.prepare('PRAGMA table_info(tennis_rejected_capture_ledger)').all().map(r=>r.name));
 const requiredAi=['canonical_event_time_contract_version','canonical_event_time_revision_id','canonical_event_time_source_kind','canonical_event_time_source_id','canonical_event_time_source_field','canonical_event_time_source_timezone','canonical_event_time_canonical_utc','canonical_event_time_safety_utc','canonical_event_time_confidence','canonical_event_time_quality_status','canonical_event_time_conflict_ms','canonical_event_time_checked_at'];
 const requiredRejected=['event_time_contract_version','event_time_quality_status','event_time_confidence','event_time_revision_id','event_time_safety_start_at_utc'];
 const schema=mod.schemaHealth(db),ledger=Number(db.prepare('SELECT COUNT(*) n FROM tennis_event_time_revisions').get().n||0),backfill=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test WHERE canonical_event_time_contract_version IS NOT NULL').get().n||0);
 check('integrità ok',()=>assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok'));
 check('foreign key zero',()=>assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0));
 check('righe totali 1161',()=>assert.equal(total,1161));check('righe Tennis 878',()=>assert.equal(tennis,878));check('snapshot 195',()=>assert.equal(snapshots,195));check('anchor 72',()=>assert.equal(anchors,72));check('invalidi zero',()=>assert.equal(invalid,0));
 check('colonne ai_forward complete',()=>assert.deepEqual(requiredAi.filter(x=>!aiCols.has(x)),[]));
 check('colonne rejected complete',()=>assert.deepEqual(requiredRejected.filter(x=>!rejectedCols.has(x)),[]));
 check('schema ledger sano',()=>assert.equal(schema.healthy,true));check('ledger forward vuoto',()=>assert.equal(ledger,0));check('nessun backfill storico',()=>assert.equal(backfill,0));check('chain vuota sana',()=>assert.equal(mod.verifyEventChain(db).healthy,true));
 check('trigger update presente',()=>assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_event_time_no_update'").get().n),1));
 check('trigger delete presente',()=>assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_event_time_no_delete'").get().n),1));
}finally{db.close();}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY',checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
