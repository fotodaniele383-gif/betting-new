'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const performance = require('../backend/tennisHistoricalValidationPerformance');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch17');

if (!fs.existsSync(dbPath)) throw new Error(`DB mancante: ${dbPath}`);
const db = new Database(dbPath, { fileMustExist: true });
try {
  const integrityBefore = db.pragma('integrity_check', { simple: true });
  if (integrityBefore !== 'ok') throw new Error(`Integrità DB pre-refresh: ${integrityBefore}`);
  performance.ensureHistoricalValidationPerformanceSchema(db);
  const report = performance.refreshForwardPerformance(db, { persist: true, includeEvaluations: true });
  const integrityAfter = db.pragma('integrity_check', { simple: true });
  if (integrityAfter !== 'ok') throw new Error(`Integrità DB post-refresh: ${integrityAfter}`);
  const output = {
    success: true,
    patch: '17',
    mode: 'FORWARD_CERTIFIED_ONLY',
    generatedAt: new Date().toISOString(),
    dbPath,
    candidateRows: report.candidateRows,
    eligibleRows: report.eligibleRows,
    coveredRows: report.coveredRows,
    coveragePct: report.coveragePct,
    metrics: report.metrics,
    performanceGate: report.performanceGate,
    persistence: report.persistence,
    authority: report.authority,
    integrityBefore,
    integrityAfter
  };
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'patch17_forward_performance_refresh.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} finally {
  db.close();
}
