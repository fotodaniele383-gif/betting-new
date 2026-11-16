'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const lifecycle = require('../backend/tennisForwardLifecycle');
const snapshots = require('../backend/tennisPredictionSnapshots');
const eligibility = require('../backend/tennisCalibrationEligibility');

const ROOT = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });

function tableExists(name) {
  return db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(name).n === 1;
}

try {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const snapshotTableExists = tableExists(snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE);
  const ledgerTableExists = tableExists(eligibility.TENNIS_CALIBRATION_LEDGER_TABLE);
  const lifecycleReport = snapshotTableExists && ledgerTableExists
    ? lifecycle.scanForwardLifecycle(db, { includeDetails: true, limit: 1000 })
    : {
        success: false,
        trackedBets: 0,
        healthyBets: 0,
        driftBets: 0,
        counts: {},
        details: [],
        missingTables: {
          snapshotTable: !snapshotTableExists,
          ledgerTable: !ledgerTableExists
        }
      };
  const snapshotRows = snapshotTableExists
    ? db.prepare(`SELECT COUNT(*) n FROM ${snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE}`).get().n
    : 0;
  const anchorRows = snapshotTableExists
    ? db.prepare(`SELECT COUNT(*) n FROM ${snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE is_calibration_anchor=1`).get().n
    : 0;
  const ledgerRows = ledgerTableExists
    ? db.prepare(`SELECT COUNT(*) n FROM ${eligibility.TENNIS_CALIBRATION_LEDGER_TABLE}`).get().n
    : 0;
  const sourceRows = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'`).get().n;
  const success = integrity[0]?.integrity_check === 'ok' && snapshotTableExists && ledgerTableExists && lifecycleReport.success && lifecycleReport.driftBets === 0;
  const output = {
    success,
    patch: '8',
    lifecycleVersion: lifecycle.TENNIS_FORWARD_LIFECYCLE_VERSION,
    dbPath,
    integrity,
    sourceRows,
    snapshotRows,
    calibrationAnchors: anchorRows,
    ledgerRows,
    lifecycle: lifecycleReport,
    invariants: {
      verificationMode: 'READ_ONLY',
      sourceRowsModified: 0,
      snapshotsModified: 0,
      ledgerModified: 0
    },
    timestamp: new Date().toISOString()
  };
  const outputDir = path.join(ROOT, 'audit_patch8');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'patch8_db_verification_report.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  db.close();
  if (!success) process.exit(2);
} catch (error) {
  try { db.close(); } catch (_) {}
  console.error(error.stack || error.message);
  process.exit(2);
}
