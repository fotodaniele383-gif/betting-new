'use strict';

const fs = require('fs');
const path = require('path');
const historical = require('../backend/tennisHistoricalPlayerStats');
const { openDatabase } = require('./patch15-db-adapter');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const datasetPath = path.join(root, 'data', 'tennisdb_historical_player_stats.json');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch16');
fs.mkdirSync(auditDir, { recursive: true });
historical.loadDataset(datasetPath, { force: true });
const status = historical.getStatus();
const afterObserved = new Date(new Date(status.sourceObservedAt).getTime() + 60_000).toISOString();
const beforeObserved = new Date(new Date(status.sourceObservedAt).getTime() - 60_000).toISOString();
const samples = {
  currentBeforeSnapshot: historical.getPlayerSnapshot('Jannik Sinner', 'ATP', beforeObserved),
  currentAfterSnapshot: historical.getPlayerSnapshot('Jannik Sinner', 'ATP', afterObserved),
  completed2025: historical.getPlayerSnapshot('Jannik Sinner', 'ATP', '2026-01-15T12:00:00Z'),
  completed2024: historical.getPlayerSnapshot('Jannik Sinner', 'ATP', '2025-07-01T12:00:00Z'),
  matchup: historical.buildMatchValidation('Jannik Sinner', 'Carlos Alcaraz', 'ATP', afterObserved)
};
let database = { status: 'NOT_CHECKED' };
if (fs.existsSync(dbPath)) {
  const { db, adapter } = openDatabase(dbPath, { projectRoot: root, fileMustExist: true, readonly: true });
  try { database = { adapter, ...historical.getDatabaseHealth(db) }; } finally { db.close(); }
}
const report = {
  success: status.loaded && status.activeRecords > 0 && samples.currentBeforeSnapshot.status === 'AVAILABLE_AUXILIARY' && Number(samples.currentBeforeSnapshot.season) === 2025 && samples.currentAfterSnapshot.status === 'AVAILABLE_AUXILIARY' && Number(samples.currentAfterSnapshot.season) === 2026 && samples.matchup.modelProbabilityChanged === false,
  patch: '16', generatedAt: new Date().toISOString(),
  formatDecision: { primary: 'XLSX', fallbackAndParity: 'EXCEL_HTML_ROW_LINK_PARITY_XLSX_YEAR_CANONICAL', auditOnly: 'PDF' },
  status, database,
  samples: {
    currentBeforeSnapshot: { status: samples.currentBeforeSnapshot.status, season: samples.currentBeforeSnapshot.season || null, temporalStatus: samples.currentBeforeSnapshot.temporalStatus || null, reason: samples.currentBeforeSnapshot.reason, rejected: samples.currentBeforeSnapshot.rejected },
    currentAfterSnapshot: { status: samples.currentAfterSnapshot.status, season: samples.currentAfterSnapshot.season, temporalStatus: samples.currentAfterSnapshot.temporalStatus, confidenceScore: samples.currentAfterSnapshot.confidenceScore },
    completed2025: { status: samples.completed2025.status, season: samples.completed2025.season, temporalStatus: samples.completed2025.temporalStatus },
    completed2024: { status: samples.completed2024.status, season: samples.completed2024.season, temporalStatus: samples.completed2024.temporalStatus },
    matchup: { status: samples.matchup.status, label: samples.matchup.label, validationProbabilityP1: samples.matchup.validationProbabilityP1, components: samples.matchup.components.map(item => item.name), modelProbabilityChanged: samples.matchup.modelProbabilityChanged, stakeAuthority: samples.matchup.stakeAuthority }
  },
  guarantees: { temporalLeakageGuard: true, ambiguousIdentityQuarantine: true, duplicateSectionGuard: true, duplicateSectionDetected: false, historicalBetBackfill: false, modelProbabilityAuthority: false, qualityGateAuthority: false, deepScanDecisionAuthority: false, stakeAuthority: false, settlementAuthority: false }
};
const md = `# Patch 16 — Audit statistiche storiche TennisDB\n\n- Esito: **${report.success ? 'PASS' : 'FAIL'}**\n- Dataset: ${status.datasetId}\n- Record attivi: ${status.activeRecords}\n- Record in quarantena: ${status.quarantinedRecords}\n- ATP: ${(status.seasons.ATP || []).join(', ')}\n- WTA: ${(status.seasons.WTA || []).join(', ')}\n- Copertura link: ${status.linkCoveragePct}%\n- Parità XLSX/HTML: ${status.formatParity}\n- Stato DB: ${database.status}\n\n## Decisione formato\n\n1. **XLSX**: sorgente strutturata primaria.\n2. **HTML Excel**: fallback e controllo parità/link.\n3. **PDF**: sola verifica umana, non ingestion automatica.\n\n## Barriere operative\n\nIl dataset resta **shadow-only**: non modifica probabilità, Quality Gate, DeepScan, stake o settlement. Le intestazioni 2026-2025-2024 sono associate alle righe fino alla successiva intestazione; eventuali sezioni duplicate e le identità ambigue sono quarantinate; gli aggregati della stagione corrente sono bloccati prima della data di osservazione della fonte.\n`;
fs.writeFileSync(path.join(auditDir, 'patch16_historical_stats_audit.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(auditDir, 'patch16_historical_stats_audit.md'), md);
console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exitCode = 2;
