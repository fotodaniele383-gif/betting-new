'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const cohorts = require('../backend/tennisForwardCohorts');
const runtimeDiagnostics = require('../backend/runtimeDiagnostics');

const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const operationId = runtimeDiagnostics.createOperationId('PATCH9_FORWARD_COHORT_AUDIT');
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
  cohorts.assertForwardCohortSchema(db);
  const report = cohorts.scanForwardCohorts(db, { limit: 100 });
  console.log(JSON.stringify({ ...report, operationId, readOnly: true }, null, 2));
  if (!report.success || !report.healthy) process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ success: false, operationId, error: error.message }, null, 2));
  process.exitCode = 2;
} finally {
  try { db?.close(); } catch (_) {}
}
