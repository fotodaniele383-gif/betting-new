'use strict';

const fs = require('fs');
const path = require('path');
const { openDatabase } = require('./patch15-db-adapter');
const historical = require('../backend/tennisHistoricalPlayerStats');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch16');
fs.mkdirSync(auditDir, { recursive: true });
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tennisdb_historical_player_stats.json'), 'utf8'));
const { db, adapter, native } = openDatabase(dbPath, { projectRoot: root, fileMustExist: true });
let report;
try {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const health = historical.getDatabaseHealth(db);
  const imported = db.prepare(`SELECT * FROM ${historical.TABLE_IMPORTS} WHERE dataset_id=?`).get(dataset.datasetId);
  const counts = db.prepare(`SELECT COUNT(*) records, SUM(CASE WHEN record_status='ACTIVE' THEN 1 ELSE 0 END) active, SUM(CASE WHEN record_status<>'ACTIVE' THEN 1 ELSE 0 END) quarantined FROM ${historical.TABLE_RECORDS} WHERE dataset_id=?`).get(dataset.datasetId);
  let updateBlocked = false; let deleteBlocked = false;
  db.exec('BEGIN');
  try {
    try { db.prepare(`UPDATE ${historical.TABLE_IMPORTS} SET version='X' WHERE dataset_id=?`).run(dataset.datasetId); } catch (_) { updateBlocked = true; }
    try { db.prepare(`DELETE FROM ${historical.TABLE_RECORDS} WHERE dataset_id=? LIMIT 1`).run(dataset.datasetId); } catch (_) { deleteBlocked = true; }
  } finally { db.exec('ROLLBACK'); }
  const sourceRows = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const activeExpected = Number(dataset.quality.activeRecords || 0);
  const rawExpected = Number(dataset.quality.rawRecords || dataset.records.length);
  report = {
    success: integrity === 'ok' && health.success && Boolean(imported) && Number(counts.records || 0) === rawExpected && Number(counts.active || 0) === activeExpected && updateBlocked && deleteBlocked,
    patch: '16', adapter, native, integrity, sourceRows,
    datasetId: dataset.datasetId,
    imported: Boolean(imported),
    expected: { records: rawExpected, active: activeExpected, quarantined: Number(dataset.quality.quarantinedRecords || 0) },
    actual: { records: Number(counts.records || 0), active: Number(counts.active || 0), quarantined: Number(counts.quarantined || 0) },
    immutableCanary: { updateBlocked, deleteBlocked, transactionRolledBack: true },
    health,
    historicalBetBackfill: false,
    modelProbabilityAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false,
    generatedAt: new Date().toISOString()
  };
} finally { db.close(); }
fs.writeFileSync(path.join(auditDir, 'patch16_db_verification_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exitCode = 2;
