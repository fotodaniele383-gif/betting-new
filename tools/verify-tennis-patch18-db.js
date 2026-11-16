'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const challenger = require('../backend/tennisStatisticalChallenger');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const db = new Database(path.join(root,'backend','database_betting.db'), { fileMustExist:true, readonly:true });
try {
  const integrity = db.pragma('integrity_check', { simple:true });
  const health = challenger.getStatisticalChallengerHealth(db);
  const sourceRows = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n);
  const patch17Rows = Number(db.prepare("SELECT COUNT(*) n FROM tennis_historical_validation_evaluations WHERE evaluation_mode='RETROSPECTIVE_AS_OF_SAFE'").get().n);
  const report = { success: integrity === 'ok' && health.success === true && health.predictions > 0 && health.latest?.oosRows === health.predictions, patch:'18', integrity, sourceRows, patch17Rows, health, generatedAt:new Date().toISOString() };
  const dir=path.join(root,'audit_patch18');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'patch18_db_verification_report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2)); if(!report.success) process.exit(2);
} finally { db.close(); }
