'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cohorts = require('../backend/tennisForwardCohorts');

const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch9');
const reportPath = path.join(auditDir, 'patch9_db_verification_report.json');
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  cohorts.assertForwardCohortSchema(db);
  const cohortColumns = db.prepare(`PRAGMA table_info(${cohorts.TENNIS_FORWARD_COHORT_TABLE})`).all().map(row => row.name);
  const memberColumns = db.prepare(`PRAGMA table_info(${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE})`).all().map(row => row.name);
  const cohortMissing = cohorts.COHORT_SCHEMA.map(([name]) => name).filter(name => !cohortColumns.includes(name));
  const memberMissing = cohorts.MEMBER_SCHEMA.map(([name]) => name).filter(name => !memberColumns.includes(name));
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_patch9_%' ORDER BY name").all().map(row => row.name);
  const orphanMembers = Number(db.prepare(`SELECT COUNT(*) n FROM ${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE} m LEFT JOIN ai_forward_test a ON a.id=m.bet_id WHERE a.id IS NULL`).get().n || 0);
  const missingAnchors = Number(db.prepare(`SELECT COUNT(*) n FROM ${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE} m LEFT JOIN tennis_prediction_snapshots s ON s.snapshot_id=m.snapshot_id AND s.bet_id=m.bet_id AND s.is_calibration_anchor=1 WHERE s.snapshot_id IS NULL`).get().n || 0);
  const report = cohorts.scanForwardCohorts(db, { limit: 200 });
  const success = integrity === 'ok' && cohortMissing.length === 0 && memberMissing.length === 0 && triggers.length >= 4 && orphanMembers === 0 && missingAnchors === 0 && report.success && report.healthy;
  const output = {
    success,
    patch: '9',
    version: cohorts.TENNIS_FORWARD_COHORT_VERSION,
    integrity,
    cohortColumns: cohortColumns.length,
    memberColumns: memberColumns.length,
    cohortMissing,
    memberMissing,
    triggers,
    orphanMembers,
    missingAnchors,
    cohortHealth: report,
    timestamp: new Date().toISOString()
  };
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  if (!success) process.exitCode = 2;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 2;
} finally {
  try { db?.close(); } catch (_) {}
}
