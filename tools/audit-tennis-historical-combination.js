'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const historical = require('../backend/tennisHistoricalCombinationEvidence');
const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root,'backend','database_betting.db');
const auditDir = path.join(root,'audit_patch13'); fs.mkdirSync(auditDir,{recursive:true});
const db = new Database(dbPath,{fileMustExist:true,readonly:true});
try {
  const before = db.prepare('PRAGMA data_version').get().data_version;
  const report = historical.buildCombinationMatrix(db,{limit:100000,asOf:new Date().toISOString()});
  const after = db.prepare('PRAGMA data_version').get().data_version;
  const result = {...report,readOnly:true,dataVersionBefore:before,dataVersionAfter:after,databaseUnchanged:before===after,generatedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(auditDir,'patch13_historical_combination_audit.json'),JSON.stringify(result,null,2));
  const lines=['# Patch 13 — Historical DeepScan × Quality Evidence','',`Resolved rows: ${result.resolvedRows}`,`Overall win rate: ${result.overallWinRatePct}%`,'','| DeepScan | Quality | n | Win rate | CI 95% | Reliability | Operational ROI |','|---|---|---:|---:|---:|---|---:|'];
  for (const item of result.combinations) lines.push(`| ${item.deepScan} | ${item.quality} | ${item.resolved} | ${item.winRatePct ?? 'N/D'}% | ${item.ci95LowPct ?? 'N/D'}–${item.ci95HighPct ?? 'N/D'}% | ${item.reliability} | ${item.operationalRoiPct ?? 'N/D'}% |`);
  lines.push('','> Il win rate storico è una frequenza empirica e non la probabilità matematica del singolo match. Nessuna autorità su stake.');
  fs.writeFileSync(path.join(auditDir,'patch13_historical_combination_audit.md'),lines.join('\n'));
  console.log(JSON.stringify(result,null,2));
  if (!result.success || !result.databaseUnchanged) process.exitCode=2;
} finally { db.close(); }
