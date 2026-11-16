'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const reporting=require('../backend/tennisTradingReportingPatch40');
const taxonomy=require('../backend/tennisDeepScanTaxonomyPatch40');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:'.');
function open(){try{const B=require(path.join(root,'node_modules','better-sqlite3'));return new B(path.join(root,'backend','database_betting.db'))}catch(_){const{DatabaseSync}=require('node:sqlite');return new DatabaseSync(path.join(root,'backend','database_betting.db'))}}
const db=open();let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++};
try{
 const report=reporting.buildDbReporting(db,'all',{rollingLimit:200});
 const t="(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')";
 const expected=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${t} AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0 AND UPPER(COALESCE(data_quality,'')) IN ('CURRENT','CURRENT_BOOTSTRAP')`).get().n);
 const inactive=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${t} AND COALESCE(paper_result_active,1)=0`).get().n);
 check(report.full.rowCount===expected,'full scope mismatch');
 check(report.inactiveDuplicates===inactive,'inactive duplicates mismatch');
 check(report.rolling.rowCount===Math.min(200,expected),'rolling scope mismatch');
 check(report.full.operational.placed<=report.full.signal.placed,'operational subset');
 check(report.full.paperAudit.rows+report.full.operational.placed===report.full.signal.placed,'signal split');
 check(report.full.clv.verified<=report.full.clv.eligible,'CLV denominator');
 check(report.full.clv.beaten<=report.full.clv.verified,'CLV beaten denominator');
 check(report.full.clv.missing===report.full.clv.eligible-report.full.clv.verified,'CLV missing');
 check(report.full.deepScan.every(x=>taxonomy.registry().some(c=>c.label===x.category)),'taxonomy coverage');
 check(Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='tennis_patch40_reporting_audit_runs'").get()),'audit table');
 check(Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_patch40_audit_no_update'").get()),'append update trigger');
 check(Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='trigger' AND name='trg_tennis_patch40_audit_no_delete'").get()),'append delete trigger');
 check(Number(db.prepare('SELECT COUNT(*) n FROM tennis_patch40_reporting_audit_runs').get().n)>=1,'audit run');
 check(String(Object.values(db.prepare('PRAGMA integrity_check').get())[0]).toLowerCase()==='ok','integrity');
 check(db.prepare('PRAGMA foreign_key_check').all().length===0,'foreign keys');
 console.log(JSON.stringify({success:true,checks,reportingVersion:report.version,rowCounts:{activeCurrent:expected,inactiveDuplicates:inactive},full:report.full,rolling:report.rolling,integrity:'ok',foreignKeyViolations:0}));
}finally{db.close()}
