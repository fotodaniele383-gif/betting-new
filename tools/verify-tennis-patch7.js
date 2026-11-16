'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let success = true;
const results = [];
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 60 * 1024 * 1024 });
  const passed = result.status === 0 && !result.error;
  results.push({ name, passed, status: result.status, signal: result.signal || null, error: result.error?.message || null });
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (!passed) success = false;
}
run('Node syntax - prediction snapshots', ['--check', 'backend/tennisPredictionSnapshots.js']);
run('Node syntax - calibration eligibility', ['--check', 'backend/tennisCalibrationEligibility.js']);
run('Node syntax - settlement contract', ['--check', 'backend/tennisSettlementContract.js']);
run('Node syntax - server Tennis', ['--check', 'backend/server.tennis.js']);
run('Node syntax - migration Patch 7', ['--check', 'tools/migrate-tennis-patch7-prediction-snapshots.js']);
run('Node syntax - DB verifier Patch 7', ['--check', 'tools/verify-tennis-patch7-db.js']);
run('Node syntax - project state audit', ['--check', 'tools/audit-tennis-project-state.js']);
run('Node syntax - frontend public', ['--check', 'public/app.js']);
run('Node syntax - frontend backend/public', ['--check', 'backend/public/app.js']);
run('Build legacy patch inventory', ['tools/build-tennis-patch-inventory.js']);
run('Patch 7 standalone tests', ['tools/test-tennis-patch7-standalone.js']);
run('Patch 7 + compatibility Jest tests', [
  'node_modules/jest/bin/jest.js',
  'backend/tests/patch7TennisPredictionSnapshotForward.test.js',
  'backend/tests/patch6TennisCalibrationEligibilityShadow.test.js',
  'backend/tests/patch5TennisSettlementEvidenceContract.test.js',
  'backend/tests/patch4TennisClvDataContract.test.js',
  'backend/tests/patch3TennisCanonicalEventIdentity.test.js',
  'backend/tests/patch2TennisMatchFormatContract.test.js',
  'backend/tests/patch1TennisPatchRegistryAndPipeline.test.js',
  'backend/tests/server.tennis.health.test.js',
  '--runInBand'
]);
run('Patch 6 full verifier and regressions', ['tools/verify-tennis-patch6.js']);
const sameApp = fs.readFileSync(path.join(ROOT, 'public', 'app.js')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'app.js')));
const sameIndex = fs.readFileSync(path.join(ROOT, 'public', 'index.html')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'index.html')));
results.push({ name: 'Frontend copies identical', passed: sameApp && sameIndex, sameApp, sameIndex });
console.log(`\n[${sameApp && sameIndex ? 'PASS' : 'FAIL'}] Frontend copies identical: app=${sameApp} index=${sameIndex}`);
if (!sameApp || !sameIndex) success = false;
const source = fs.readFileSync(path.join(ROOT, 'backend', 'server.tennis.js'), 'utf8');
const atomic = source.includes('savePendingTennisBetCore(bet)') && source.includes('db.transaction') && source.includes('capturePredictionSnapshot') && source.includes('refreshCalibrationEligibilityForBet') && source.includes('SNAPSHOT_FAILED');
const routes = source.includes("router.get('/prediction-audit'") && source.includes("router.get('/prediction-audit/:betId'");
const auditSource = fs.readFileSync(path.join(ROOT, 'tools', 'audit-tennis-project-state.js'), 'utf8');
const auditSchemaAware = auditSource.includes("columns.has('bet_id')") && auditSource.includes("columns.has('source_bet_id')") && auditSource.includes('predictionAuditReferenceColumn') && !auditSource.includes('ON a.id=p.source_bet_id WHERE p.source_bet_id IS NOT NULL');
results.push({ name: 'Atomic prediction persistence source guard', passed: atomic });
results.push({ name: 'Prediction audit routes source guard', passed: routes });
results.push({ name: 'Project audit schema compatibility guard', passed: auditSchemaAware });
console.log(`\n[${atomic ? 'PASS' : 'FAIL'}] Atomic prediction persistence source guard`);
console.log(`[${routes ? 'PASS' : 'FAIL'}] Prediction audit routes source guard`);
console.log(`[${auditSchemaAware ? 'PASS' : 'FAIL'}] Project audit schema compatibility guard`);
if (!atomic || !routes || !auditSchemaAware) success = false;
const report = { success, patch: '7', timestamp: new Date().toISOString(), results };
fs.mkdirSync(path.join(ROOT, 'audit_patch7'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit_patch7', 'patch7_verification_report.json'), JSON.stringify(report, null, 2));
console.log('\nReport: audit_patch7\\patch7_verification_report.json');
if (!success) process.exit(2);
