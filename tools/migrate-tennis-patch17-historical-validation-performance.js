'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const performance = require('../backend/tennisHistoricalValidationPerformance');
const historical = require('../backend/tennisHistoricalPlayerStats');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = path.join(root, 'backend', 'database_betting.db');
const datasetPath = path.join(root, 'data', 'tennisdb_historical_player_stats.json');
const auditDir = path.join(root, 'audit_patch17');
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sourceState(db) {
  const rows = db.prepare('SELECT * FROM ai_forward_test ORDER BY id').all();
  return { rows: rows.length, digest: sha(rows) };
}
if (!fs.existsSync(dbPath)) throw new Error(`DB mancante: ${dbPath}`);
if (!fs.existsSync(datasetPath)) throw new Error(`Dataset Patch 16 mancante: ${datasetPath}`);
historical.loadDataset(datasetPath, { force: true });
const db = new Database(dbPath, { fileMustExist: true });
try {
  const integrityBefore = db.pragma('integrity_check', { simple: true });
  if (integrityBefore !== 'ok') throw new Error(`Integrità DB pre-migrazione: ${integrityBefore}`);
  const before = sourceState(db);
  const schema = performance.ensureHistoricalValidationPerformanceSchema(db);
  const retrospective = performance.runRetrospectiveAudit(db, { datasetPath, persist: true, includeEvaluations: true });
  const forward = performance.refreshForwardPerformance(db, { persist: true, includeEvaluations: true });
  const after = sourceState(db);
  if (before.rows !== after.rows || before.digest !== after.digest) throw new Error('PATCH17_SOURCE_BETS_MODIFIED');
  const integrityAfter = db.pragma('integrity_check', { simple: true });
  if (integrityAfter !== 'ok') throw new Error(`Integrità DB post-migrazione: ${integrityAfter}`);
  const health = performance.getPerformanceHealth(db);
  const report = {
    success: true, patch: '17', migratedAt: new Date().toISOString(), dbPath,
    schema, sourceBefore: before, sourceAfter: after, sourceRowsModified: 0,
    retrospective: { candidateRows: retrospective.candidateRows, eligibleRows: retrospective.eligibleRows, coveredRows: retrospective.coveredRows, coveragePct: retrospective.coveragePct, metrics: retrospective.metrics, performanceGate: retrospective.performanceGate, persistence: retrospective.persistence },
    forward: { candidateRows: forward.candidateRows, eligibleRows: forward.eligibleRows, coveredRows: forward.coveredRows, coveragePct: forward.coveragePct, metrics: forward.metrics, performanceGate: forward.performanceGate, persistence: forward.persistence },
    health, authority: health.authority, integrityBefore, integrityAfter
  };
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'patch17_migration_report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
