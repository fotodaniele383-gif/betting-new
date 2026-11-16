'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const diagnostics = require('../backend/runtimeDiagnostics');
const eligibility = require('../backend/tennisCalibrationEligibility');
const ROOT = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');
const db = new Database(dbPath);
const operation = diagnostics.startOperation('PATCH6_ELIGIBILITY_REFRESH', { dbPath }, { component: 'TENNIS_CALIBRATION' });
const table = eligibility.TENNIS_CALIBRATION_LEDGER_TABLE;
const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
try {
  const sourceBefore = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`).get().n;
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${eligibility.LEDGER_SCHEMA.map(([name,type]) => `${name} ${type}`).join(', ')})`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_status ON ${table}(eligibility_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_segment ON ${table}(segment_key)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_dataset ON ${table}(dataset_version)`);
  const rows = db.prepare(`SELECT * FROM ai_forward_test WHERE ${tennisWhere} ORDER BY id`).all();
  const evaluatedAt = new Date().toISOString();
  const records = rows.map(row => eligibility.buildEligibilityRecord(row, { evaluatedAt, operationId: operation.operationId })).filter(Boolean);
  const names = eligibility.LEDGER_SCHEMA.map(([name]) => name);
  const placeholders = names.map(name => `@${name}`).join(', ');
  const update = names.filter(name => name !== 'bet_id').map(name => `${name}=excluded.${name}`).join(', ');
  const upsert = db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) ON CONFLICT(bet_id) DO UPDATE SET ${update}`);
  const tx = db.transaction(() => {
    for (const record of records) {
      const clean = Object.fromEntries(names.map(name => [name, record[name]]));
      upsert.run(clean);
    }
    db.prepare(`DELETE FROM ${table} WHERE bet_id NOT IN (SELECT id FROM ai_forward_test WHERE ${tennisWhere})`).run();
  });
  tx();
  const sourceAfter = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere}`).get().n;
  const ledgerRows = db.prepare(`SELECT * FROM ${table} ORDER BY bet_id`).all();
  const report = eligibility.buildCalibrationReadinessReport(rows, ledgerRows, { evaluatedAt, operationId: operation.operationId });
  const output = {
    success: sourceBefore === sourceAfter && report.ledger.fresh,
    patch: '6',
    dbPath,
    operationId: operation.operationId,
    sourceRowsBefore: sourceBefore,
    sourceRowsAfter: sourceAfter,
    ledgerRows: ledgerRows.length,
    sourceRowsModified: 0,
    eligibilityCounts: report.eligibilityCounts,
    eligible: report.eligible,
    readiness: report.readiness,
    datasetVersion: eligibility.TENNIS_CALIBRATION_DATASET_VERSION,
    timestamp: evaluatedAt
  };
  fs.mkdirSync(path.join(ROOT, 'audit_patch6'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'audit_patch6', 'patch6_eligibility_migration_report.json'), JSON.stringify(output, null, 2));
  operation.complete({ success: output.success, ledgerRows: ledgerRows.length, readiness: report.readiness.status });
  console.log(JSON.stringify(output, null, 2));
  db.close();
  if (!output.success) process.exit(2);
} catch (error) {
  operation.error('MIGRATION', error);
  try { db.close(); } catch (_) {}
  console.error(error.stack || error.message);
  process.exit(2);
}
