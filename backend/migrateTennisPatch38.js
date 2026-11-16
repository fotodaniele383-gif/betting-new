#!/usr/bin/env node
'use strict';
const path=require('path');const crypto=require('crypto');
const PATCH='TENNIS_PATCH_38_FORWARD_HEALTH_DECISION_TRUTH_EXTERNAL_EVIDENCE_INTEGRITY';
const REVISION='R2_WINDOWS_NODE_LIVE_BASELINE_INVARIANT_CONTRACT';
const MIGRATION='ADDITIVE_PATCH38_SEMANTIC_AUDIT_NO_BUSINESS_BACKFILL';
const args=process.argv.slice(2);const apply=args.includes('--apply');const preview=args.includes('--preview')||!apply;const dbArg=args.find(v=>/\.db$/i.test(v));const dbPath=path.resolve(process.cwd(),dbArg||'backend/database_betting.db');
function openDb(file){try{const B=require('better-sqlite3');return{db:new B(file),adapter:'better-sqlite3'};}catch(_){const{DatabaseSync}=require('node:sqlite');return{db:new DatabaseSync(file),adapter:'node:sqlite'};}}
function sha(v){return crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');}
function table(db,n){return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(n));}
function tennisWhere(){return `(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')`;}
function counts(db){return{total:Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n),tennis:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()}`).get().n),pending:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()}`).get().n),positiveStake:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()} AND COALESCE(stake,0)>0`).get().n),stakeTotal:Number(db.prepare(`SELECT ROUND(COALESCE(SUM(stake),0),2) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()}`).get().n)};}
function schema(db){db.exec(`
CREATE TABLE IF NOT EXISTS tennis_patch38_semantic_audit_runs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 run_id TEXT NOT NULL UNIQUE,
 generated_at TEXT NOT NULL,
 version TEXT NOT NULL,
 expected_temporal_exclusions INTEGER NOT NULL DEFAULT 0,
 active_temporal_faults INTEGER NOT NULL DEFAULT 0,
 decision_rows INTEGER NOT NULL DEFAULT 0,
 external_receipt_rows INTEGER NOT NULL DEFAULT 0,
 report_json TEXT NOT NULL,
 report_hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_tennis_patch38_audit_no_update BEFORE UPDATE ON tennis_patch38_semantic_audit_runs BEGIN SELECT RAISE(ABORT,'TENNIS_PATCH38_AUDIT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_tennis_patch38_audit_no_delete BEFORE DELETE ON tennis_patch38_semantic_audit_runs BEGIN SELECT RAISE(ABORT,'TENNIS_PATCH38_AUDIT_APPEND_ONLY'); END;
`);}
function createRun(db,at){const cohortTable=table(db,'tennis_forward_cohort_members');let expected=0,active=0;if(cohortTable){const rows=db.prepare("SELECT maturity_status,leakage_status,exclusion_reasons FROM tennis_forward_cohort_members WHERE UPPER(COALESCE(leakage_status,''))='BLOCKED'").all();for(const row of rows){let reasons=[];try{reasons=JSON.parse(row.exclusion_reasons||'[]');}catch(_){}const ok=String(row.maturity_status||'').toUpperCase()==='TEMPORAL_LEAKAGE_BLOCKED'&&reasons.length>0&&reasons.every(r=>r==='SNAPSHOT_NOT_BEFORE_MATCH_START');if(ok)expected++;else active++;}}
const decisionRows=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${tennisWhere()}`).get().n);const externalRows=table(db,'tennis_external_intelligence_receipts')?Number(db.prepare('SELECT COUNT(*) n FROM tennis_external_intelligence_receipts').get().n):0;const report={version:'TENNIS_PATCH38_SEMANTIC_AUDIT_V1',generatedAt:at,expectedTemporalExclusions:expected,activeTemporalFaults:active,decisionRows,externalReceiptRows:externalRows,noBusinessBackfill:true,probabilityAuthority:false,stakeAuthority:false,settlementAuthority:false};const canonical={...report,generatedAt:null};const hash=sha(canonical);const runId=`TP38_${hash.slice(0,24)}`;if(!db.prepare('SELECT 1 ok FROM tennis_patch38_semantic_audit_runs WHERE run_id=?').get(runId))db.prepare('INSERT INTO tennis_patch38_semantic_audit_runs(run_id,generated_at,version,expected_temporal_exclusions,active_temporal_faults,decision_rows,external_receipt_rows,report_json,report_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(runId,at,report.version,expected,active,decisionRows,externalRows,JSON.stringify(report),hash);return{runId,reportHash:hash,report};}
const opened=openDb(dbPath);const db=opened.db;let output;try{const integrityBefore=Object.values(db.prepare('PRAGMA integrity_check').get())[0];const fkBefore=db.prepare('PRAGMA foreign_key_check').all();if(String(integrityBefore).toLowerCase()!=='ok'||fkBefore.length)throw new Error('PATCH38_DATABASE_PRECHECK_FAILED');const before=counts(db);let run=null;if(apply)db.exec('BEGIN IMMEDIATE');try{if(apply){schema(db);run=createRun(db,new Date().toISOString());db.exec('COMMIT');}const after=counts(db);output={success:true,patch:PATCH,revision:REVISION,mode:preview?'PREVIEW':'APPLY',migration:MIGRATION,adapter:opened.adapter,dbPath,before,after,businessRowsUnchanged:JSON.stringify(before)===JSON.stringify(after),noHistoricalBackfill:true,auditRows:table(db,'tennis_patch38_semantic_audit_runs')?Number(db.prepare('SELECT COUNT(*) n FROM tennis_patch38_semantic_audit_runs').get().n):0,run,integrity:Object.values(db.prepare('PRAGMA integrity_check').get())[0],foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all().length};}catch(e){if(apply)try{db.exec('ROLLBACK');}catch(_){}throw e;}}finally{db.close();}console.log(JSON.stringify(output,null,2));
