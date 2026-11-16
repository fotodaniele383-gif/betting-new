'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const challenger = require('../backend/tennisStatisticalChallenger');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const db = new Database(path.join(root, 'backend', 'database_betting.db'), { fileMustExist: true, readonly: true });
try {
  const health = challenger.getStatisticalChallengerHealth(db);
  const latest = challenger.getLatestReport(db);
  const report = {
    success: health.success === true,
    patch: '18',
    generatedAt: new Date().toISOString(),
    health,
    latest,
    authority: { modelProbability: false, deepScanDecision: false, qualityGate: false, stake: false, settlement: false, automaticPromotion: false, historicalBetMutation: false }
  };
  const dir = path.join(root, 'audit_patch18'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'patch18_statistical_challenger_audit.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'patch18_statistical_challenger_audit.md'), `# Patch 18 — Statistical Challenger Audit\n\n- Stato: **${health.status}**\n- Valutazioni Patch 17: **${health.latest?.sourceEvaluations ?? 0}**\n- Warm-up: **${health.latest?.warmupRows ?? 0}**\n- Righe fuori campione: **${health.latest?.oosRows ?? 0}**\n- Peso storico medio: **${health.metrics?.averageHistoricalWeight ?? 'N/D'}**\n- Brier challenger: **${health.metrics?.challengerBrier ?? 'N/D'}**\n- Brier production: **${health.metrics?.productionBrier ?? 'N/D'}**\n- Miglioramento Brier: **${health.metrics?.brierImprovementVsProduction ?? 'N/D'}**\n- Bootstrap 95%: **[${health.bootstrap?.lower95 ?? 'N/D'}, ${health.bootstrap?.upper95 ?? 'N/D'}]**\n- Stability Guard: **${health.stabilityGuard?.status || 'N/D'}**\n- Promozione automatica: **NO**\n- Probabilità, DeepScan, Quality Gate, stake e settlement: **INVARIATI**\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.success) process.exit(2);
} finally { db.close(); }
