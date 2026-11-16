'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const historical = require('../backend/tennisHistoricalCombinationEvidence');
const progression = require('../backend/tennisProgramProgressionAudit');
const root = path.resolve(__dirname,'..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root,'backend','database_betting.db');
const auditDir = path.join(root,'audit_patch13'); fs.mkdirSync(auditDir,{recursive:true});
const sha256File=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const expectedColumns=[
  'historical_combo_key','historical_combo_deepscan','historical_combo_quality','historical_combo_resolved','historical_combo_wins','historical_combo_losses',
  'historical_combo_win_rate_pct','historical_combo_adjusted_rate_pct','historical_combo_ci_low_pct','historical_combo_ci_high_pct',
  'historical_combo_operational_resolved','historical_combo_operational_roi_pct','historical_combo_reliability','historical_combo_source_max_id',
  'historical_combo_evidence_hash','historical_combo_version','historical_combo_calculated_at'
];
const hashBefore=sha256File(dbPath);
const db=new Database(dbPath,{fileMustExist:true,readonly:true});
try {
  const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;
  const columns=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row=>row.name));
  const missingColumns=expectedColumns.filter(column=>!columns.has(column));
  const totalRows=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);
  const tennisRows=Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n||0);
  const populated=missingColumns.length?[]:db.prepare(`SELECT id,historical_combo_resolved,historical_combo_wins,historical_combo_losses,historical_combo_win_rate_pct,historical_combo_reliability,historical_combo_evidence_hash,historical_combo_version FROM ai_forward_test WHERE historical_combo_version IS NOT NULL`).all();
  const invalidPopulated=populated.filter(row=>Number(row.historical_combo_resolved)!==Number(row.historical_combo_wins)+Number(row.historical_combo_losses)||!/^[a-f0-9]{64}$/.test(String(row.historical_combo_evidence_hash||''))||row.historical_combo_version!==historical.TENNIS_HISTORICAL_COMBINATION_VERSION);
  const matrix=historical.buildCombinationMatrix(db,{limit:100000,asOf:new Date().toISOString()});
  const exactSamples=matrix.combinations.filter(item=>item.resolved>0 && Number.isFinite(Number(item.winRatePct)) && Number.isFinite(Number(item.ci95LowPct)) && Number.isFinite(Number(item.ci95HighPct)));
  const progressionReport=progression.buildProgramProgressionAudit(db,{projectRoot:root});
  const result={
    success:integrity==='ok'&&missingColumns.length===0&&totalRows>0&&tennisRows>0&&invalidPopulated.length===0&&matrix.success&&matrix.resolvedRows>0&&exactSamples.length>0&&progressionReport.healthy,
    patch:'13',integrity,totalRows,tennisRows,expectedColumns,missingColumns,populatedRows:populated.length,invalidPopulated,
    historicalMatrix:{resolvedRows:matrix.resolvedRows,overallWinRatePct:matrix.overallWinRatePct,combinations:matrix.combinations.length,top:matrix.combinations.slice(0,12)},
    progression:{status:progressionReport.status,errors:progressionReport.errors,warnings:progressionReport.warnings},
    readOnly:true,hashBefore,hashAfter:null
  };
  fs.writeFileSync(path.join(auditDir,'patch13_db_verification_report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(!result.success) process.exitCode=2;
} finally { db.close(); }
const reportPath=path.join(auditDir,'patch13_db_verification_report.json');
if(fs.existsSync(reportPath)){
  const result=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  result.hashAfter=sha256File(dbPath);
  result.databaseUnchanged=result.hashBefore===result.hashAfter;
  if(!result.databaseUnchanged){result.success=false;process.exitCode=2;}
  fs.writeFileSync(reportPath,JSON.stringify(result,null,2));
}
