'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sourceOnly = process.argv.includes('--source-only');
let success = true;
const results = [];

function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
  const passed = result.status === 0 && !result.error;
  results.push({ name, passed, status: result.status, signal: result.signal || null, error: result.error?.message || null });
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (!passed) success = false;
  return passed;
}

run('Node syntax - forward lifecycle', ['--check', 'backend/tennisForwardLifecycle.js']);
run('Node syntax - CLV tracker', ['--check', 'backend/clvTracker.js']);
run('Node syntax - Paper Trading Tennis', ['--check', 'backend/paperTrading.tennis.js']);
run('Node syntax - server Tennis', ['--check', 'backend/server.tennis.js']);
run('Node syntax - patch registry', ['--check', 'backend/tennisPatchRegistry.js']);
run('Node syntax - Patch 8 Jest test', ['--check', 'backend/tests/patch8TennisForwardLifecycleAtomicity.test.js']);
run('Node syntax - Patch 7 compatibility test', ['--check', 'backend/tests/patch7TennisPredictionSnapshotForward.test.js']);
run('Node syntax - Patch 5 compatibility test', ['--check', 'backend/tests/patch5TennisSettlementEvidenceContract.test.js']);
run('Node syntax - Patch 7 standalone compatibility', ['--check', 'tools/test-tennis-patch7-standalone.js']);
run('Node syntax - lifecycle audit CLI', ['--check', 'tools/audit-tennis-forward-lifecycle.js']);
run('Node syntax - DB verifier Patch 8', ['--check', 'tools/verify-tennis-patch8-db.js']);
run('Node syntax - project state audit', ['--check', 'tools/audit-tennis-project-state.js']);
run('Node syntax - frontend public', ['--check', 'public/app.js']);
run('Node syntax - frontend backend/public', ['--check', 'backend/public/app.js']);
run('Build legacy patch inventory', ['tools/build-tennis-patch-inventory.js']);
run('Patch 7 standalone compatibility', ['tools/test-tennis-patch7-standalone.js']);
run('Patch 8 standalone tests', ['tools/test-tennis-patch8-standalone.js']);

if (!sourceOnly) {
  run('Patch 8 + compatibility Jest tests', [
    'node_modules/jest/bin/jest.js',
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
  run('Patch 7 full verifier and regressions', ['tools/verify-tennis-patch7.js']);
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
const clv = fs.readFileSync(path.join(ROOT, 'backend', 'clvTracker.js'), 'utf8');
const paper = fs.readFileSync(path.join(ROOT, 'backend', 'paperTrading.tennis.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'backend', 'server.tennis.js'), 'utf8');
const audit = fs.readFileSync(path.join(ROOT, 'tools', 'audit-tennis-project-state.js'), 'utf8');
const atomicClv = clv.includes('executeAtomicLifecycleTransition') && clv.includes('TRANSITIONS.CLV_LOCK') && clv.includes('PATCH8_ATOMIC_CLV_ROLLBACK');
const atomicSettlement = paper.includes('TRANSITIONS.SETTLEMENT_BLOCKED') && paper.includes('TRANSITIONS.SETTLEMENT_VERIFIED') && paper.includes('PATCH8_ATOMIC_SETTLEMENT_ROLLBACK');
const testAdapterGuarded = paper.includes("process.env.NODE_ENV === 'test'") && paper.includes('context.patch8TestOnlyNonAtomicAdapter === true');
const routes = server.includes("router.get('/forward-lifecycle-health'") && server.includes("router.get('/forward-lifecycle-health/:betId'");
const readOnlyAudit = audit.includes('lifecycle.scanForwardLifecycle') && audit.includes("new Database(dbPath, { readonly: true })");
const sourceChecks = [
  ['Frontend copies identical', sameApp && sameIndex, { sameApp, sameIndex }],
  ['Atomic CLV lifecycle source guard', atomicClv, {}],
  ['Atomic settlement lifecycle source guard', atomicSettlement, {}],
  ['Patch 5 explicit test-adapter guard', testAdapterGuarded, {}],
  ['Forward lifecycle routes source guard', routes, {}],
  ['Project audit lifecycle read-only guard', readOnlyAudit, {}]
];
for (const [name, passed, extra] of sourceChecks) {
  results.push({ name, passed, ...extra });
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (!passed) success = false;
}

const report = { success, patch: '8', revision: 'R2', sourceOnly, timestamp: new Date().toISOString(), results };
fs.mkdirSync(path.join(ROOT, 'audit_patch8'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit_patch8', 'patch8_verification_report.json'), JSON.stringify(report, null, 2));
console.log('\nReport: audit_patch8\\patch8_verification_report.json');
if (!success) process.exit(2);
