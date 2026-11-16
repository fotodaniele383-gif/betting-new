'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const perf = require('../backend/tennisHistoricalValidationPerformance');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const db = new Database(path.join(root,'backend','database_betting.db'), { fileMustExist:true, readonly:true });
try {
  const integrity = db.pragma('integrity_check', { simple:true });
  const health = perf.getPerformanceHealth(db);
  const sourceRows = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n);
  const tennisRows = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n);
  const report = { success: integrity === 'ok' && health.success === true && health.retrospectiveEvaluations > 0, patch:'17', integrity, sourceRows, tennisRows, health, generatedAt:new Date().toISOString() };
  const dir=path.join(root,'audit_patch17');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'patch17_db_verification_report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2)); if(!report.success) process.exit(2);
} finally { db.close(); }
