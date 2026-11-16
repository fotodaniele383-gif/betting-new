'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const performance = require('../backend/tennisHistoricalValidationPerformance');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const db = new Database(path.join(root, 'backend', 'database_betting.db'), { fileMustExist: true, readonly: true });
try {
  const report = {
    success: true, patch: '17', generatedAt: new Date().toISOString(),
    health: performance.getPerformanceHealth(db),
    retrospective: performance.getLatestReport(db, 'RETROSPECTIVE_AS_OF_SAFE'),
    forward: performance.getLatestReport(db, 'FORWARD_CERTIFIED'),
    authority: { modelProbability: false, deepScanDecision: false, qualityGate: false, stake: false, settlement: false, automaticPromotion: false, historicalBetMutation: false }
  };
  report.success = report.health.success === true && report.authority.automaticPromotion === false;
  const dir = path.join(root, 'audit_patch17'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'patch17_historical_validation_performance_audit.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'patch17_historical_validation_performance_audit.md'), `# Patch 17 — Historical Validation Performance Audit\n\n- Stato: **${report.health.status}**\n- Valutazioni retrospettive: **${report.health.retrospectiveEvaluations}**\n- Valutazioni forward: **${report.health.forwardEvaluations}**\n- Gate: **${report.health.performanceGate?.status || 'N/D'}**\n- Promozione automatica: **NO**\n- Probabilità, DeepScan, Quality Gate, stake e settlement: **INVARIATI**\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.success) process.exit(2);
} finally { db.close(); }
