'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const challenger = require('../backend/tennisStatisticalChallenger');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch18');
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function tableState(db, table) { const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(); return { rows: rows.length, digest: sha(rows) }; }
if (!fs.existsSync(dbPath)) throw new Error(`DB mancante: ${dbPath}`);
const db = new Database(dbPath, { fileMustExist: true });
try {
  const integrityBefore = db.pragma('integrity_check', { simple: true });
  if (integrityBefore !== 'ok') throw new Error(`Integrità DB pre-migrazione: ${integrityBefore}`);
  const sourceBefore = tableState(db, 'ai_forward_test');
  const patch17Before = tableState(db, 'tennis_historical_validation_evaluations');
  const schema = challenger.ensureStatisticalChallengerSchema(db);
  const report = challenger.runStatisticalChallengerAudit(db, { persist: true, includePredictions: true });
  const sourceAfter = tableState(db, 'ai_forward_test');
  const patch17After = tableState(db, 'tennis_historical_validation_evaluations');
  if (sourceBefore.rows !== sourceAfter.rows || sourceBefore.digest !== sourceAfter.digest) throw new Error('PATCH18_SOURCE_BETS_MODIFIED');
  if (patch17Before.rows !== patch17After.rows || patch17Before.digest !== patch17After.digest) throw new Error('PATCH18_PATCH17_LEDGER_MODIFIED');
  const integrityAfter = db.pragma('integrity_check', { simple: true });
  if (integrityAfter !== 'ok') throw new Error(`Integrità DB post-migrazione: ${integrityAfter}`);
  const health = challenger.getStatisticalChallengerHealth(db);
  const output = {
    success: true,
    patch: '18',
    migratedAt: new Date().toISOString(),
    dbPath,
    schema,
    sourceBefore,
    sourceAfter,
    patch17Before,
    patch17After,
    sourceRowsModified: 0,
    patch17RowsModified: 0,
    challenger: {
      sourceEvaluations: report.sourceEvaluations,
      warmupRows: report.warmupRows,
      oosRows: report.oosRows,
      folds: report.folds,
      metrics: report.metrics,
      bootstrap: report.bootstrap,
      byTour: report.byTour,
      stabilityGuard: report.stabilityGuard,
      persistence: report.persistence
    },
    health,
    authority: health.authority,
    integrityBefore,
    integrityAfter
  };
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'patch18_migration_report.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} finally { db.close(); }
