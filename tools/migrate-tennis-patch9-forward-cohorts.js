'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cohorts = require('../backend/tennisForwardCohorts');
const runtimeDiagnostics = require('../backend/runtimeDiagnostics');

const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch9');
const reportPath = path.join(auditDir, 'patch9_migration_report.json');
const operationId = runtimeDiagnostics.createOperationId('PATCH9_FORWARD_COHORT_MIGRATION');

function count(db, table) {
  const present = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n > 0;
  return present ? Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n || 0) : 0;
}

let db;
try {
  db = new Database(dbPath);
  const integrityBefore = db.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrityBefore !== 'ok') throw new Error(`DB_INTEGRITY_BEFORE:${integrityBefore}`);
  const sourceRowsBefore = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const tennisRowsBefore = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n || 0);
  const snapshotsBefore = count(db, 'tennis_prediction_snapshots');
  const membersBefore = count(db, cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE);
  const tablesBefore = count(db, cohorts.TENNIS_FORWARD_COHORT_TABLE);

  runtimeDiagnostics.writeDiagnostic({
    level: 'INFO', component: 'TENNIS_FORWARD_COHORT', operation: 'PATCH9_MIGRATION', operationId,
    phase: 'COHORT_SCHEMA_START', event: 'COHORT_SCHEMA_START',
    message: 'Avvio migrazione additiva delle coorti forward Patch 9.',
    context: { dbPath, snapshotsBefore, membersBefore }
  });

  const transaction = db.transaction(() => cohorts.ensureForwardCohortSchema(db));
  transaction();

  const sourceRowsAfter = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const tennisRowsAfter = Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n || 0);
  const membersAfter = count(db, cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE);
  const cohortRowsAfter = count(db, cohorts.TENNIS_FORWARD_COHORT_TABLE);
  const integrityAfter = db.prepare('PRAGMA integrity_check').get().integrity_check;
  if (sourceRowsAfter !== sourceRowsBefore || tennisRowsAfter !== tennisRowsBefore) throw new Error('PATCH9_SOURCE_ROWS_CHANGED');
  if (membersAfter !== membersBefore) throw new Error('PATCH9_HISTORICAL_COHORT_BACKFILL_FORBIDDEN');
  if (integrityAfter !== 'ok') throw new Error(`DB_INTEGRITY_AFTER:${integrityAfter}`);

  const report = {
    success: true,
    patch: '9',
    version: cohorts.TENNIS_FORWARD_COHORT_VERSION,
    operationId,
    dbPath,
    sourceRowsBefore,
    sourceRowsAfter,
    tennisRowsBefore,
    tennisRowsAfter,
    snapshotsBefore,
    membersBefore,
    membersAfter,
    cohortRowsBefore: tablesBefore,
    cohortRowsAfter,
    historicalBackfill: false,
    sourceRowsModified: 0,
    integrityBefore,
    integrityAfter,
    timestamp: new Date().toISOString()
  };
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  runtimeDiagnostics.writeDiagnostic({
    level: 'INFO', component: 'TENNIS_FORWARD_COHORT', operation: 'PATCH9_MIGRATION', operationId,
    phase: 'COHORT_SCHEMA_COMPLETE', event: 'COHORT_SCHEMA_COMPLETE',
    message: 'Migrazione Patch 9 completata senza backfill storico.', context: report
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  runtimeDiagnostics.captureError({
    component: 'TENNIS_FORWARD_COHORT', operation: 'PATCH9_MIGRATION', operationId,
    phase: 'COHORT_SCHEMA_FAILED', event: 'COHORT_SCHEMA_FAILED', error, context: { dbPath }
  });
  console.error(error.stack || error.message);
  process.exitCode = 2;
} finally {
  try { db?.close(); } catch (_) {}
}
