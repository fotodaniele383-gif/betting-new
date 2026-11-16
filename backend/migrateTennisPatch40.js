#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const reporting=require('./tennisTradingReportingPatch40');
const taxonomy=require('./tennisDeepScanTaxonomyPatch40');
const h2h=require('./tennisH2HWeightPolicyPatch40');
const VERSION='TENNIS_PATCH40_ADDITIVE_REPORTING_AUDIT_V1';
function arg(name, fallback=null){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]?process.argv[i+1]:fallback}
const root=path.resolve(arg('--root','.')||'.');
const preview=process.argv.includes('--preview');
const dbPath=path.join(root,'backend','database_betting.db');
function openDb(){try{const B=require(path.join(root,'node_modules','better-sqlite3'));return new B(dbPath)}catch(_){const{DatabaseSync}=require('node:sqlite');return new DatabaseSync(dbPath)}}
function hash(v){return crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex')}
function businessFingerprint(db){return hash(db.prepare(`SELECT id,status,prediction,estimated_prob,odd,closing_odd,clv,clv_edge,stake,profit,home_team,away_team,match_date,paper_result_active,paper_result_conflict FROM ai_forward_test ORDER BY id`).all())}
function table(db,n){return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(n))}
function counts(db){const t="(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')";return{total:Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n),tennisAll:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${t}`).get().n),tennisActiveCurrent:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${t} AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0 AND UPPER(COALESCE(data_quality,'')) IN ('CURRENT','CURRENT_BOOTSTRAP')`).get().n),inactiveTennis:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${t} AND COALESCE(paper_result_active,1)=0`).get().n)}}
function createSchema(db){db.exec(`
CREATE TABLE IF NOT EXISTS tennis_patch40_reporting_audit_runs (
 run_id TEXT PRIMARY KEY,
 version TEXT NOT NULL,
 generated_at TEXT NOT NULL,
 row_counts_json TEXT NOT NULL,
 full_report_json TEXT NOT NULL,
 rolling_report_json TEXT NOT NULL,
 taxonomy_json TEXT NOT NULL,
 h2h_policy_json TEXT NOT NULL,
 report_hash TEXT NOT NULL UNIQUE,
 previous_hash TEXT,
 chain_hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_tennis_patch40_audit_no_update BEFORE UPDATE ON tennis_patch40_reporting_audit_runs BEGIN SELECT RAISE(ABORT,'PATCH40_AUDIT_APPEND_ONLY_UPDATE_BLOCKED'); END;
CREATE TRIGGER IF NOT EXISTS trg_tennis_patch40_audit_no_delete BEFORE DELETE ON tennis_patch40_reporting_audit_runs BEGIN SELECT RAISE(ABORT,'PATCH40_AUDIT_APPEND_ONLY_DELETE_BLOCKED'); END;
`)}
const db=openDb();
try{
 const beforeCounts=counts(db), beforeFingerprint=businessFingerprint(db);
 const report=reporting.buildDbReporting(db,'all',{rollingLimit:200});
 const rows=report.rows; delete report.rows;
 const payload={version:VERSION,rowCounts:beforeCounts,full:report.full,rolling:report.rolling,taxonomy:taxonomy.registry(),h2hPolicy:h2h.POLICY,inactiveDuplicates:report.inactiveDuplicates};
 const reportHash=hash(payload);
 let inserted=false;
 if(!preview){
  createSchema(db);
  const existing=db.prepare('SELECT run_id FROM tennis_patch40_reporting_audit_runs WHERE report_hash=?').get(reportHash);
  if(!existing){
   const previous=Number(db.prepare('SELECT COUNT(*) n FROM tennis_patch40_reporting_audit_runs').get().n)>0?db.prepare('SELECT chain_hash FROM tennis_patch40_reporting_audit_runs ORDER BY generated_at DESC,run_id DESC LIMIT 1').get().chain_hash:null;
   const generatedAt=new Date().toISOString(); const runId=`TP40_${generatedAt.replace(/[-:.TZ]/g,'')}_${reportHash.slice(0,12)}`; const chainHash=hash({previous,reportHash,runId,generatedAt});
   db.prepare(`INSERT INTO tennis_patch40_reporting_audit_runs (run_id,version,generated_at,row_counts_json,full_report_json,rolling_report_json,taxonomy_json,h2h_policy_json,report_hash,previous_hash,chain_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(runId,VERSION,generatedAt,JSON.stringify(beforeCounts),JSON.stringify(report.full),JSON.stringify(report.rolling),JSON.stringify(taxonomy.registry()),JSON.stringify(h2h.POLICY),reportHash,previous,chainHash); inserted=true;
  }
 }
 const afterCounts=counts(db), afterFingerprint=businessFingerprint(db);
 const auditRows=table(db,'tennis_patch40_reporting_audit_runs')?Number(db.prepare('SELECT COUNT(*) n FROM tennis_patch40_reporting_audit_runs').get().n):0;
 const integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];
 const fk=db.prepare('PRAGMA foreign_key_check').all().length;
 console.log(JSON.stringify({success:true,preview,version:VERSION,inserted,rowCounts:afterCounts,rowCountsUnchanged:JSON.stringify(beforeCounts)===JSON.stringify(afterCounts),businessFingerprintBefore:beforeFingerprint,businessFingerprintAfter:afterFingerprint,businessFingerprintUnchanged:beforeFingerprint===afterFingerprint,auditRows,full:report.full,rolling:report.rolling,inactiveDuplicates:report.inactiveDuplicates,taxonomyVersion:taxonomy.VERSION,h2hWeightPolicyVersion:h2h.VERSION,integrity,foreignKeyViolations:fk,noBusinessBackfill:true,noStakeChanges:true,noClvReconstruction:true},null,2));
}finally{db.close()}
