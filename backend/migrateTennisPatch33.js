#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const eventTime=require('./tennisCanonicalEventTime');
const args=process.argv.slice(2);const apply=args.includes('--apply');const preview=args.includes('--preview')||!apply;
const dbArg=args.find(x=>/\.db$/i.test(x));const dbPath=path.resolve(process.cwd(),dbArg||'backend/database_betting.db');
function openDb(){try{const B=require('better-sqlite3');return new B(dbPath);}catch(_){const{DatabaseSync}=require('node:sqlite');return new DatabaseSync(dbPath);}}
function cols(db,table){return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name));}
const AI_COLUMNS=[
 ['canonical_event_time_contract_version','TEXT'],['canonical_event_time_revision_id','TEXT'],['canonical_event_time_source_kind','TEXT'],
 ['canonical_event_time_source_id','TEXT'],['canonical_event_time_source_field','TEXT'],['canonical_event_time_source_timezone','TEXT'],
 ['canonical_event_time_canonical_utc','TEXT'],['canonical_event_time_safety_utc','TEXT'],['canonical_event_time_confidence','TEXT'],
 ['canonical_event_time_quality_status','TEXT'],['canonical_event_time_conflict_ms','INTEGER'],['canonical_event_time_checked_at','TEXT']
];
const REJECTED_COLUMNS=[
 ['event_time_contract_version','TEXT'],['event_time_quality_status','TEXT'],['event_time_confidence','TEXT'],
 ['event_time_revision_id','TEXT'],['event_time_safety_start_at_utc','TEXT']
];
if(!fs.existsSync(dbPath)){console.log(JSON.stringify({success:false,code:'DATABASE_NOT_FOUND',dbPath},null,2));process.exit(1);}
const db=openDb();let out;
try{
 const beforeAi=cols(db,'ai_forward_test');const missingAi=AI_COLUMNS.filter(([n])=>!beforeAi.has(n));
 const rejectedExists=Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='tennis_rejected_capture_ledger'").get());
 const beforeRejected=rejectedExists?cols(db,'tennis_rejected_capture_ledger'):new Set();const missingRejected=REJECTED_COLUMNS.filter(([n])=>!beforeRejected.has(n));
 const tableExists=Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='tennis_event_time_revisions'").get());
 const historicalRows=tableExists?Number(db.prepare('SELECT COUNT(*) n FROM tennis_event_time_revisions').get().n||0):0;
 if(apply){
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const [name,type] of missingAi)db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
   if(rejectedExists)for(const [name,type] of missingRejected)db.exec(`ALTER TABLE tennis_rejected_capture_ledger ADD COLUMN ${name} ${type}`);
   eventTime.ensureSchema(db);
   db.exec('COMMIT');
  }catch(e){try{db.exec('ROLLBACK')}catch(_){}throw e;}
 }
 const afterAi=cols(db,'ai_forward_test');const afterRejected=rejectedExists?cols(db,'tennis_rejected_capture_ledger'):new Set();
 const ledgerRows=apply?(Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='tennis_event_time_revisions'").get())?Number(db.prepare('SELECT COUNT(*) n FROM tennis_event_time_revisions').get().n||0):null):historicalRows;
 out={success:true,patch:'TENNIS_PATCH_33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY',mode:preview?'PREVIEW':'APPLY',dbPath,
  migration:'ADDITIVE_FORWARD_ONLY_CANONICAL_EVENT_TIME_LEDGER',
  aiForwardColumns:{required:AI_COLUMNS.map(x=>x[0]),missingBefore:missingAi.map(x=>x[0]),missingAfter:AI_COLUMNS.map(x=>x[0]).filter(n=>!afterAi.has(n))},
  rejectedLedgerColumns:{tableExists:rejectedExists,required:REJECTED_COLUMNS.map(x=>x[0]),missingBefore:missingRejected.map(x=>x[0]),missingAfter:rejectedExists?REJECTED_COLUMNS.map(x=>x[0]).filter(n=>!afterRejected.has(n)):[]},
  eventTimeLedger:{existedBefore:tableExists,rowsBefore:historicalRows,rowsAfter:ledgerRows,noHistoricalBackfill:ledgerRows===historicalRows},
  businessRowsChanged:false,schemaChanged:apply&&(missingAi.length>0||missingRejected.length>0||!tableExists)};
}finally{db.close();}
console.log(JSON.stringify(out,null,2));
