'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const intake = require(path.join(root, 'backend', 'tennisForwardSampleIntake.js'));
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const before = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const integrity = db.pragma('integrity_check', { simple: true });
  const report = intake.inspectForwardSampleIntake(db);
  const after = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const result = { success: integrity === 'ok' && before === after && report.structuralReady === true, patch: '25', adapter: 'better-sqlite3', readOnly: true, integrity, sourceRowsBefore: before, sourceRowsAfter: after, databaseRowsModified: after - before, firstMatchReadiness: report };
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exit(2);
} finally { db.close(); }
