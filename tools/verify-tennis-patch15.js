'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const auditDir = path.join(root, 'audit_patch15');
fs.mkdirSync(auditDir, { recursive: true });
const checks = [];
function pass(name, details = '') { checks.push({ name, ok: true, details }); console.log(`[PASS] ${name}${details ? `\n${details}` : ''}`); }
function fail(name, error) { checks.push({ name, ok: false, error: String(error?.message || error) }); console.error(`[FAIL] ${name}: ${error?.message || error}`); }
function run(name, args) { try { const out = cp.execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); pass(name, out.trim()); return out; } catch (error) { fail(name, (error.stderr || error.stdout || error).toString()); return null; } }
function source(name, ok, details = '') { ok ? pass(name, details) : fail(name, new Error(details || 'SOURCE_GUARD_FAILED')); }
const syntaxFiles = [
  'backend/tennisInformationRetrievalCertification.js','backend/deepScanTennis.js','backend/paperTrading.tennis.js','backend/server.tennis.js','backend/tennisPatchRegistry.js','backend/tennisProgramProgressionAudit.js',
  'backend/tests/patch15TennisInformationRetrievalCertification.test.js','backend/tests/patch14TennisPlayerDataRefreshFreshnessGuard.test.js',
  'tools/patch15-db-adapter.js','tools/migrate-tennis-patch15-information-retrieval.js','tools/audit-tennis-information-retrieval.js','tools/probe-tennis-information-retrieval.js',
  'tools/test-tennis-patch15-retrieval-fixtures.js','tools/test-tennis-patch15-standalone.js','tools/verify-tennis-patch15-db.js','tools/verify-tennis-patch15.js',
  'tools/create-tennis-safe-support-bundle.js','public/app.js','backend/public/app.js'
];
for (const file of syntaxFiles) run(`Node syntax - ${file}`, ['--check', file]);
run('Patch 15 deterministic retrieval fixtures', ['tools/test-tennis-patch15-retrieval-fixtures.js']);
run('Patch 15 standalone', ['tools/test-tennis-patch15-standalone.js']);
run('Build legacy patch inventory', ['tools/build-tennis-patch-inventory.js']);
run('Patch 14 standalone compatibility', ['tools/test-tennis-patch14-standalone.js']);
run('Patch 13 standalone compatibility', ['tools/test-tennis-patch13-standalone.js']);
run('Patch 12 standalone compatibility', ['tools/test-tennis-patch12-standalone.js']);
const registry = require('../backend/tennisPatchRegistry');
const retrieval = require('../backend/tennisInformationRetrievalCertification');
const progression = require('../backend/tennisProgramProgressionAudit');
const server = fs.readFileSync(path.join(root, 'backend/server.tennis.js'), 'utf8');
const deepScan = fs.readFileSync(path.join(root, 'backend/deepScanTennis.js'), 'utf8');
const paper = fs.readFileSync(path.join(root, 'backend/paperTrading.tennis.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const bapp = fs.readFileSync(path.join(root, 'backend/public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const bhtml = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
source('Registry Patch 15 active', Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 15 && registry.TENNIS_PATCH_REGISTRY_VERSION === `TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}` && registry.PATCHES.some(item => item.version === '15' && String(item.status).startsWith('ACTIVE')));
source('Retrieval schema and immutable receipts declared', retrieval.TABLE_RUNS === 'tennis_information_retrieval_runs' && retrieval.TABLE_CHECKS === 'tennis_information_source_checks' && retrieval.TABLE_RECEIPTS === 'tennis_prediction_evidence_receipts' && retrieval.TENNIS_INFORMATION_RETRIEVAL_MODE.includes('NO_MODEL_STAKE_AUTHORITY'));
source('DeepScan source metadata connected', deepScan.includes('informationRetrieval') && deepScan.includes('googleNewsStatus') && deepScan.includes('bingNewsStatus'));
source('Paper Trading execution certification connected', paper.includes('buildPaperTradingExecutionCertification') && paper.includes('informationRetrievalCertification'));
source('Information retrieval endpoints connected', server.includes("router.get('/information-retrieval-health'") && server.includes("router.get('/information-retrieval-health/:betId'") && server.includes("router.post('/information-retrieval-probe'") && server.includes('PATCH15_LOCAL_REQUEST_REQUIRED'));
source('Prediction and DeepScan receipts atomically persisted', server.includes('PREDICTION_CAPTURE') && server.includes('DEEPSCAN_COMPLETE') && server.includes('persistPredictionEvidenceReceipt'));
source('No model, gate or stake authority', server.includes('probabilityWeightsChanged: false') && server.includes('deepScanDecisionChanged: false') && server.includes('stakeAuthority: false'));
source('UI Patch 1-15 connected', html.includes(`Patch 1–${registry.TENNIS_CURRENT_PATCH_VERSION}`) && html.includes('tennisInformationRetrievalPanel') && app.includes('runTennisInformationRetrievalProbe'));
source('Frontend copies identical', app === bapp && html === bhtml);
source('No duplicate HTML ids', progression.duplicateHtmlIds(html).length === 0, JSON.stringify(progression.duplicateHtmlIds(html)));
source('No Soccer/Calcio Patch 15 module', !syntaxFiles.some(file => /calcio|soccer/i.test(file)));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'backend/tennis_patch_inventory.json'), 'utf8'));
source('Inventory 56 legacy steps and current >=15', Number(inventory.summary?.uniqueLegacySteps) === 56 && Number(inventory.summary?.unregisteredCount) === 0 && Number(inventory.registry?.currentPatchVersion) >= 15);
const result = {
  success: checks.every(item => item.ok), patch: '15', checks,
  frontendHashes: { app: crypto.createHash('sha256').update(app).digest('hex'), index: crypto.createHash('sha256').update(html).digest('hex') },
  generatedAt: new Date().toISOString()
};
fs.writeFileSync(path.join(auditDir, 'patch15_verification_report.json'), JSON.stringify(result, null, 2));
console.log('\nReport: audit_patch15\\patch15_verification_report.json');
if (!result.success) process.exitCode = 2;
