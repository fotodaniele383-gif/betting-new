#!/usr/bin/env node
'use strict';
const assert=require('assert');const path=require('path');const schedule=require('../backend/tennisOfficialScheduleAuthority');
let DB;try{DB=require('../node_modules/better-sqlite3');}catch(_){DB=require('node:sqlite').DatabaseSync;}
const root=path.resolve(__dirname,'..'),db=new DB(path.join(root,'backend','database_betting.db')),checks=[];function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
const tennisWhere="UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'";
try{
 const cols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));const required=['official_schedule_contract_version','official_schedule_receipt_id','official_schedule_source_kind','official_schedule_source_id','official_schedule_status','official_schedule_transition_type','official_schedule_effective_start_at_utc','official_schedule_capture_disposition','official_schedule_observation_hash','official_schedule_checked_at'];
 const rejectedCols=new Set(db.prepare('PRAGMA table_info(tennis_rejected_capture_ledger)').all().map(r=>r.name));const rejectedRequired=['schedule_contract_version','schedule_receipt_id','schedule_status','schedule_transition_type','schedule_capture_disposition','schedule_block_reason'];
 check('integrità SQLite',()=>assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok'));
 check('foreign key zero',()=>assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0));
 check('righe totali 1161',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,1161));
 check('righe Tennis 878',()=>assert.equal(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`).get().n,878));
 check('snapshot 195',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots').get().n,195));
 check('anchor 72',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE is_calibration_anchor=1').get().n,72));
 check('snapshot invalidi zero',()=>assert.equal(db.prepare("SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE snapshot_status IN ('POST_START_INVALID','INCOMPLETE')").get().n,0));
 check('colonne ai Patch34 complete',()=>assert.deepEqual(required.filter(x=>!cols.has(x)),[]));
 check('colonne rejected Patch34 complete',()=>assert.deepEqual(rejectedRequired.filter(x=>!rejectedCols.has(x)),[]));
 check('schema schedule sano',()=>assert.equal(schedule.schemaHealth(db).healthy,true));
 check('ledger schedule vuoto',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM tennis_schedule_receipts').get().n,0));
 check('nessun backfill ai',()=>assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_forward_test WHERE official_schedule_contract_version IS NOT NULL').get().n,0));
 check('catena schedule sana',()=>assert.equal(schedule.verifyReceiptChain(db).healthy,true));
}finally{db.close();}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
