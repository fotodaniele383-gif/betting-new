'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const snapshots = require('../backend/tennisPredictionSnapshots');
const eligibility = require('../backend/tennisCalibrationEligibility');

const ROOT = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";

try {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const snapshotTableExists = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE).n === 1;
  const snapshotColumns = snapshotTableExists ? new Set(db.prepare(`PRAGMA table_info(${snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE})`).all().map(row => row.name)) : new Set();
  const snapshotSchemaReady = snapshots.SNAPSHOT_SCHEMA.every(([name]) => snapshotColumns.has(name));
  const triggers = snapshotTableExists ? db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name").all(snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE) : [];
  const snapshotRows = snapshotTableExists ? db.prepare(`SELECT * FROM ${snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE} ORDER BY bet_id, snapshot_sequence`).all() : [];
  const chain = snapshots.verifyPredictionSnapshotRows(snapshotRows);
  const invalidAnchors = snapshotRows.filter(row => Number(row.is_calibration_anchor || 0) === 1 && (row.snapshot_type !== 'ORIGINAL' || row.snapshot_status !== 'VALID_PREMATCH')).length;
  const duplicateAnchors = snapshotTableExists ? db.prepare(`SELECT COUNT(*) n FROM (SELECT bet_id FROM ${snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE is_calibration_anchor=1 GROUP BY bet_id HAVING COUNT(*)>1)`).get().n : 0;

  const ledgerTable = eligibility.TENNIS_CALIBRATION_LEDGER_TABLE;
  const ledgerExists = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(ledgerTable).n === 1;
  const ledgerColumns = ledgerExists ? new Set(db.prepare(`PRAGMA table_info(${ledgerTable})`).all().map(row => row.name)) : new Set();
  const ledgerSchemaReady = eligibility.LEDGER_SCHEMA.every(([name]) => ledgerColumns.has(name));
  const sourceRows = db.prepare(`SELECT * FROM ai_forward_test WHERE ${tennisWhere} ORDER BY id`).all();
  const ledgerRows = ledgerExists ? db.prepare(`SELECT * FROM ${ledgerTable} ORDER BY bet_id`).all() : [];
  const anchors = snapshotRows.filter(row => Number(row.is_calibration_anchor || 0) === 1);
  const readiness = eligibility.buildCalibrationReadinessReport(sourceRows, ledgerRows, {
    predictionSnapshots: anchors,
    requirePredictionSnapshot: true
  });
  const eligibleWithoutSnapshot = ledgerRows.filter(row => Number(row.settlement_eligible || 0) === 1 && !row.prediction_snapshot_id).length;
  const success = integrity[0]?.integrity_check === 'ok' && snapshotTableExists && snapshotSchemaReady && triggers.length >= 2 && chain.valid && invalidAnchors === 0 && duplicateAnchors === 0 && ledgerExists && ledgerSchemaReady && readiness.ledger.fresh && eligibleWithoutSnapshot === 0;
  const result = {
    success,
    integrity,
    snapshotTableExists,
    snapshotSchemaReady,
    snapshotSchemaColumns: snapshots.SNAPSHOT_SCHEMA.filter(([name]) => snapshotColumns.has(name)).length,
    snapshotSchemaExpected: snapshots.SNAPSHOT_SCHEMA.length,
    immutableTriggers: triggers.map(row => row.name),
    snapshotRows: snapshotRows.length,
    calibrationAnchors: anchors.length,
    chain,
    invalidAnchors,
    duplicateAnchors,
    ledgerExists,
    ledgerSchemaReady,
    ledgerRows: ledgerRows.length,
    sourceRows: sourceRows.length,
    ledger: readiness.ledger,
    predictionSnapshots: readiness.predictionSnapshots,
    eligibilityCounts: readiness.eligibilityCounts,
    eligible: readiness.eligible,
    readiness: readiness.readiness,
    eligibleWithoutSnapshot,
    operationalModelChanged: readiness.operationalModelChanged,
    autoApplyCalibration: readiness.autoApplyCalibration
  };
  fs.mkdirSync(path.join(ROOT, 'audit_patch7'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'audit_patch7', 'patch7_db_verification_report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  db.close();
  if (!success) process.exit(2);
} catch (error) {
  try { db.close(); } catch (_) {}
  console.error(error.stack || error.message);
  process.exit(2);
}
