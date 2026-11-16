'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sourceOnly = process.argv.includes('--source-only');
let success = true;
const results = [];

function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  const passed = result.status === 0 && !result.error;
  results.push({ name, passed, status: result.status, signal: result.signal || null, error: result.error?.message || null });
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (!passed) success = false;
  return passed;
}

run('Node syntax - forward cohorts', ['--check', 'backend/tennisForwardCohorts.js']);
run('Node syntax - forward lifecycle', ['--check', 'backend/tennisForwardLifecycle.js']);
run('Node syntax - server Tennis', ['--check', 'backend/server.tennis.js']);
run('Node syntax - patch registry', ['--check', 'backend/tennisPatchRegistry.js']);
run('Node syntax - Patch 9 Jest test', ['--check', 'backend/tests/patch9TennisForwardCohortsAndOperationsUi.test.js']);
run('Node syntax - Patch 8 compatibility test', ['--check', 'backend/tests/patch8TennisForwardLifecycleAtomicity.test.js']);
run('Node syntax - Patch 9 migration', ['--check', 'tools/migrate-tennis-patch9-forward-cohorts.js']);
run('Node syntax - Patch 9 DB verifier', ['--check', 'tools/verify-tennis-patch9-db.js']);
run('Node syntax - Patch 9 cohort audit', ['--check', 'tools/audit-tennis-forward-cohorts.js']);
run('Node syntax - Patch 9 canary', ['--check', 'tools/verify-tennis-forward-canary.js']);
run('Node syntax - Patch 9 standalone', ['--check', 'tools/test-tennis-patch9-standalone.js']);
run('Node syntax - Patch 8 standalone compatibility', ['--check', 'tools/test-tennis-patch8-standalone.js']);
run('Node syntax - frontend public', ['--check', 'public/app.js']);
run('Node syntax - frontend backend/public', ['--check', 'backend/public/app.js']);
run('Build legacy patch inventory', ['tools/build-tennis-patch-inventory.js']);
run('Patch 8 standalone compatibility', ['tools/test-tennis-patch8-standalone.js']);
run('Patch 9 standalone tests', ['tools/test-tennis-patch9-standalone.js']);

if (!sourceOnly) {
  run('Patch 9 + compatibility Jest tests', [
    'node_modules/jest/bin/jest.js',
    'backend/tests/patch9TennisForwardCohortsAndOperationsUi.test.js',
    'backend/tests/patch8TennisForwardLifecycleAtomicity.test.js',
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
  run('Patch 8 full verifier and regressions', ['tools/verify-tennis-patch8.js']);
  run('Tennis core regression suite', [
    'node_modules/jest/bin/jest.js',
    'backend/tests/server.tennis.professional.test.js',
    'backend/tests/server.tennis.health.test.js',
    'backend/tests/server.tennis.optimize.test.js',
    'backend/tests/tennisValueEvaluator.test.js',
    'backend/tests/paperTrading.tennis.test.js',
    '--runInBand'
  ]);
}

const sameApp = fs.readFileSync(path.join(ROOT, 'public', 'app.js')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'app.js')));
const sameIndex = fs.readFileSync(path.join(ROOT, 'public', 'index.html')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'index.html')));
const server = fs.readFileSync(path.join(ROOT, 'backend', 'server.tennis.js'), 'utf8');
const lifecycle = fs.readFileSync(path.join(ROOT, 'backend', 'tennisForwardLifecycle.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const registry = fs.readFileSync(path.join(ROOT, 'backend', 'tennisPatchRegistry.js'), 'utf8');
const registryRuntime = require(path.join(ROOT, 'backend', 'tennisPatchRegistry.js'));
const moduleSource = fs.readFileSync(path.join(ROOT, 'backend', 'tennisForwardCohorts.js'), 'utf8');
const sourceChecks = [
  ['Frontend copies identical', sameApp && sameIndex, { sameApp, sameIndex }],
  ['Patch 9 registry source guard', Number(registryRuntime.TENNIS_CURRENT_PATCH_VERSION) >= 9 && registryRuntime.PATCHES.some(p => p.version === '9' && p.status === 'ACTIVE'), {}],
  ['Prediction transaction seals cohort', server.includes('assignForwardCohortMember') && server.includes('COHORT_MEMBER_SEALED'), {}],
  ['Lifecycle refreshes cohort maturity', lifecycle.includes('refreshForwardCohortMaturity'), {}],
  ['Forward cohort endpoints present', server.includes("router.get('/forward-cohort-health'") && server.includes("router.get('/forward-cohort-health/:betId'"), {}],
  ['Compact operations center connected', app.includes('setTennisOperationsCollapsed') && app.includes('syncTennisOperationsVisibility') && index.includes('tennisOperationsCenter'), {}],
  ['Temporal leakage guard present', moduleSource.includes('CLV_CAPTURED_AFTER_MATCH_START') && moduleSource.includes('SETTLEMENT_BEFORE_MATCH_START'), {}],
  ['Cohort seal triggers present', moduleSource.includes('PATCH9_COHORT_SEAL_IMMUTABLE') && moduleSource.includes('PATCH9_COHORT_MEMBER_DELETE_FORBIDDEN'), {}],
  ['No Soccer/Calcio Patch 9 module', !server.includes("require('./calcioForwardCohorts')") && !moduleSource.toUpperCase().includes('CALCIO_'), {}]
];
for (const [name, passed, extra] of sourceChecks) {
  results.push({ name, passed, ...extra });
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (!passed) success = false;
}

const report = { success, patch: '9', sourceOnly, timestamp: new Date().toISOString(), results };
fs.mkdirSync(path.join(ROOT, 'audit_patch9'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit_patch9', 'patch9_verification_report.json'), JSON.stringify(report, null, 2));
console.log('\nReport: audit_patch9\\patch9_verification_report.json');
if (!success) process.exit(2);
