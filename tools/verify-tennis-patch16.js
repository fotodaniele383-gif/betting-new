'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const auditDir = path.join(root, 'audit_patch16');
fs.mkdirSync(auditDir, { recursive: true });
const checks = [];
const pass = (name, details = '') => { checks.push({ name, ok: true, details }); console.log(`[PASS] ${name}`); };
const fail = (name, error) => { checks.push({ name, ok: false, error: String(error?.message || error) }); console.error(`[FAIL] ${name}: ${error?.message || error}`); };
function run(name, args) {
  try { const out = cp.execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); pass(name, out.trim().slice(0, 2000)); return true; }
  catch (error) { fail(name, (error.stderr || error.stdout || error).toString().slice(0, 4000)); return false; }
}
const source = (name, ok, details = '') => ok ? pass(name, details) : fail(name, new Error(details || 'SOURCE_GUARD_FAILED'));
const syntaxFiles = [
  'backend/tennisHistoricalPlayerStats.js','backend/tennisPlayerEvidence.js','backend/tennisMatchupIntelligence.js','backend/tennisInformationRetrievalCertification.js','backend/tennisPatchRegistry.js',
  'backend/tests/patch16TennisHistoricalPlayerStatsShadowEvidence.test.js','tools/tennis-historical-player-stats-importer.js','tools/import-tennis-historical-player-stats.js','tools/migrate-tennis-patch16-historical-stats.js',
  'tools/verify-tennis-patch16-db.js','tools/verify-tennis-patch16-source-years.js','tools/audit-tennis-historical-player-stats.js','tools/test-tennis-patch16-historical-fixtures.js','tools/verify-tennis-patch16.js'
];
for (const file of syntaxFiles) run(`Node syntax - ${file}`, ['--check', file]);
run('Patch 16 source-year verification', ['tools/verify-tennis-patch16-source-years.js', '--expected-seasons', '2026,2025,2024']);
run('Patch 16 XLSX/HTML deterministic verification', ['tools/import-tennis-historical-player-stats.js', '--verify-only', '--expected-year', '2024']);
run('Patch 16 historical fixtures', ['tools/test-tennis-patch16-historical-fixtures.js']);
run('Patch 15 standalone compatibility', ['tools/test-tennis-patch15-standalone.js']);
run('Patch 14 standalone compatibility', ['tools/test-tennis-patch14-standalone.js']);
run('Build Tennis patch inventory', ['tools/build-tennis-patch-inventory.js']);

const registry = require('../backend/tennisPatchRegistry');
const historical = require('../backend/tennisHistoricalPlayerStats');
const retrieval = require('../backend/tennisInformationRetrievalCertification');
const progression = require('../backend/tennisProgramProgressionAudit');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data', 'tennisdb_historical_player_stats.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const bhtml = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const bapp = fs.readFileSync(path.join(root, 'backend/public/app.js'), 'utf8');
const playerEvidence = fs.readFileSync(path.join(root, 'backend/tennisPlayerEvidence.js'), 'utf8');
const retrievalSource = fs.readFileSync(path.join(root, 'backend/tennisInformationRetrievalCertification.js'), 'utf8');
source('Registry Patch 16 active', Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 16 && registry.TENNIS_PATCH_REGISTRY_VERSION === `TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}` && registry.PATCHES.some(item => item.version === '15') && registry.PATCHES.some(item => item.version === '16'));
source('Dataset normalized and non-empty', dataset.quality.rawRecords === 1336 && dataset.quality.activeRecords === 1315 && dataset.quality.quarantinedRecords === 21);
source('Expected 2024 history available for ATP/WTA', dataset.quality.expectedYearPresentForBothTours === true);
source('XLSX primary, HTML parity, PDF audit-only', dataset.source.primaryFormat === 'XLSX' && dataset.source.htmlRole === 'ROW_AND_LINK_PARITY_FALLBACK_XLSX_YEAR_CANONICAL' && dataset.source.pdfRole === 'AUDIT_ONLY_NOT_MACHINE_AUTHORITY' && dataset.source.formatParity.status === 'MATCH_WITH_STALE_HTML_HEADER' && dataset.source.formatParity.rowParity === true);
source('Links and provenance retained', dataset.quality.linkCoveragePct === 100 && dataset.records.filter(r => r.recordStatus === 'ACTIVE').every(r => /^https:\/\/tennis-db\.com\//.test(r.sourceUrl || '')));
source('Corrected 2026-2025-2024 season blocks active', JSON.stringify(dataset.quality.seasons.ATP) === JSON.stringify([2026,2025,2024]) && JSON.stringify(dataset.quality.seasons.WTA) === JSON.stringify([2026,2025,2024]) && dataset.quality.duplicateTourSeasonSectionCount === 0 && dataset.sections.every(section => section.status === 'ACTIVE'));
source('Quarantena limitata ad anomalie esplicite', Number(dataset.quality.quarantinedByReason.QUARANTINED_SECTION_CONFLICT || 0) === 0 && Number(dataset.quality.quarantinedByReason.QUARANTINED_INVALID_METRIC || 0) === 1 && dataset.quality.quarantinedRecords === 21);
source('Temporal leakage policy enabled', dataset.temporalPolicy.currentSeasonEligibleOnlyAtOrAfterSourceObservedAt === true && dataset.temporalPolicy.completedSeasonEligibleOnlyAfterSeasonEnd === true && historical.getStatus().temporalLeakageGuard === true);
source('No operational authority', Object.values(dataset.authority).includes(true) === false && historical.TENNIS_HISTORICAL_PLAYER_STATS_MODE.includes('NO_MODEL_GATE_STAKE_SETTLEMENT_AUTHORITY'));
source('Historical validation not fused into production components', playerEvidence.includes('historicalValidationAuthority: false') && playerEvidence.includes('historicalModelProbabilityChanged: false') && !playerEvidence.includes("add('HISTORICAL"));
source('AI retrieval channel exposes shadow source', retrieval.SOURCE_REGISTRY.AI_TENNISDB_HISTORICAL_PLAYER_STATS.authority === 'AUXILIARY_VALIDATION_SHADOW' && retrievalSource.includes('modelProbabilityAuthority: false'));
source('UI Patch 16 connected', /Patch 1–(?:16|17|18)/.test(html) && html.includes('data-tennis-patch="16"') && html.includes('Statistiche storiche giocatori'));
source('Frontend copies identical', html === bhtml && app === bapp);
source('No duplicate HTML ids', progression.duplicateHtmlIds(html).length === 0, JSON.stringify(progression.duplicateHtmlIds(html)));
source('Patch 16 implementation isolated from Calcio/Soccer', syntaxFiles.every(file => !/calcio|soccer/i.test(file)) && !fs.readFileSync(path.join(root, 'backend/tennisHistoricalPlayerStats.js'), 'utf8').includes('PATCH16_SOCCER'));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'backend/tennis_patch_inventory.json'), 'utf8'));
source('Inventory Patch 16 compatible', Number(inventory.registry.currentPatchVersion) >= 16 && Number(inventory.summary.unregisteredCount) === 0);

const result = {
  success: checks.every(item => item.ok), patch: '16', version: historical.TENNIS_HISTORICAL_PLAYER_STATS_VERSION, checks,
  dataset: { id: dataset.datasetId, rawRecords: dataset.quality.rawRecords, activeRecords: dataset.quality.activeRecords, quarantinedRecords: dataset.quality.quarantinedRecords, seasons: dataset.quality.seasons, linkCoveragePct: dataset.quality.linkCoveragePct, formatParity: dataset.source.formatParity.status },
  guarantees: { historicalBetBackfill: false, modelProbabilityAuthority: false, qualityGateAuthority: false, deepScanDecisionAuthority: false, stakeAuthority: false, settlementAuthority: false, soccerModified: false },
  hashes: { dataset: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'data', 'tennisdb_historical_player_stats.json'))).digest('hex'), publicIndex: crypto.createHash('sha256').update(html).digest('hex') },
  generatedAt: new Date().toISOString()
};
fs.writeFileSync(path.join(auditDir, 'patch16_verification_report.json'), JSON.stringify(result, null, 2));
console.log(`\nReport: ${path.join('audit_patch16', 'patch16_verification_report.json')}`);
if (!result.success) process.exitCode = 2;
