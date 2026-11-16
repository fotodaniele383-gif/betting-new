'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const diagnostics = require('../backend/runtimeDiagnostics');
const snapshots = require('../backend/tennisPredictionSnapshots');
const eligibility = require('../backend/tennisCalibrationEligibility');

const ROOT = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const db = new Database(dbPath);
const operation = diagnostics.startOperation('PATCH7_PREDICTION_SNAPSHOT_MIGRATION', { dbPath }, { component: 'TENNIS_PREDICTION' });
const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";

function ensureLedgerSchema() {
  const table = eligibility.TENNIS_CALIBRATION_LEDGER_TABLE;
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${eligibility.LEDGER_SCHEMA.map(([name, type]) => `${name} ${type}`).join(', ')})`);
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  const added = [];
  for (const [name, type] of eligibility.LEDGER_SCHEMA) {
    if (existing.has(name) || name === 'bet_id') continue;
    const additiveType = type
      .replace(/\s+PRIMARY KEY.*/i, '')
      .replace(/\s+NOT NULL/ig, '')
      .replace(/\s+DEFAULT\s+[^\s]+/ig, '');
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${additiveType}`);
    added.push(name);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_status ON ${table}(eligibility_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_segment ON ${table}(segment_key)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_dataset ON ${table}(dataset_version)`);
  return added;
}

try {
  const sourceRowsBefore = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`).get().n;
  const totalRowsBefore = db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
  snapshots.ensurePredictionSnapshotTable(db);
  const ledgerColumnsAdded = ensureLedgerSchema();
  const snapshotRowsBefore = db.prepare(`SELECT COUNT(*) n FROM ${snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE}`).get().n;
  const evaluatedAt = new Date().toISOString();
  const sourceRows = db.prepare(`SELECT * FROM ai_forward_test WHERE ${tennisWhere} ORDER BY id`).all();
  const anchors = db.prepare(`SELECT * FROM ${snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE is_calibration_anchor=1 ORDER BY bet_id`).all();
  const anchorsByBet = new Map(anchors.map(row => [Number(row.bet_id), row]));
  const records = sourceRows.map(row => eligibility.buildEligibilityRecord(
    eligibility.applyPredictionSnapshotToRow(row, anchorsByBet.get(Number(row.id)) || null),
    { evaluatedAt, operationId: operation.operationId, requirePredictionSnapshot: true }
  )).filter(Boolean);
  const names = eligibility.LEDGER_SCHEMA.map(([name]) => name);
  const update = names.filter(name => name !== 'bet_id').map(name => `${name}=excluded.${name}`).join(', ');
  const upsert = db.prepare(`INSERT INTO ${eligibility.TENNIS_CALIBRATION_LEDGER_TABLE} (${names.join(', ')}) VALUES (${names.map(name => `@${name}`).join(', ')}) ON CONFLICT(bet_id) DO UPDATE SET ${update}`);
  const tx = db.transaction(() => {
    for (const record of records) {
      upsert.run(Object.fromEntries(names.map(name => [name, record[name] ?? null])));
    }
    db.prepare(`DELETE FROM ${eligibility.TENNIS_CALIBRATION_LEDGER_TABLE} WHERE bet_id NOT IN (SELECT id FROM ai_forward_test WHERE ${tennisWhere})`).run();
  });
  tx();

  const sourceRowsAfter = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`).get().n;
  const totalRowsAfter = db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
  const ledgerRows = db.prepare(`SELECT * FROM ${eligibility.TENNIS_CALIBRATION_LEDGER_TABLE} ORDER BY bet_id`).all();
  const report = eligibility.buildCalibrationReadinessReport(sourceRows, ledgerRows, {
    evaluatedAt,
    operationId: operation.operationId,
    predictionSnapshots: anchors,
    requirePredictionSnapshot: true
  });
  const snapshotRowsAfter = db.prepare(`SELECT COUNT(*) n FROM ${snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE}`).get().n;
  const output = {
    success: sourceRowsBefore === sourceRowsAfter && totalRowsBefore === totalRowsAfter && report.ledger.fresh,
    patch: '7',
    snapshotVersion: snapshots.TENNIS_PREDICTION_SNAPSHOT_VERSION,
    datasetVersion: eligibility.TENNIS_CALIBRATION_DATASET_VERSION,
    dbPath,
    operationId: operation.operationId,
    sourceRowsBefore,
    sourceRowsAfter,
    totalRowsBefore,
    totalRowsAfter,
    sourceRowsModified: 0,
    snapshotRowsBefore,
    snapshotRowsAfter,
    historicalSnapshotBackfill: false,
    calibrationAnchors: anchors.length,
    ledgerRows: ledgerRows.length,
    ledgerColumnsAdded,
    eligibilityCounts: report.eligibilityCounts,
    eligible: report.eligible,
    readiness: report.readiness,
    timestamp: evaluatedAt
  };
  fs.mkdirSync(path.join(ROOT, 'audit_patch7'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'audit_patch7', 'patch7_snapshot_migration_report.json'), JSON.stringify(output, null, 2));
  operation.complete({ success: output.success, snapshotRows: snapshotRowsAfter, anchors: anchors.length, ledgerRows: ledgerRows.length });
  console.log(JSON.stringify(output, null, 2));
  db.close();
  if (!output.success) process.exit(2);
} catch (error) {
  operation.error('MIGRATION_FAILED', error);
  try { db.close(); } catch (_) {}
  console.error(error.stack || error.message);
  process.exit(2);
}
