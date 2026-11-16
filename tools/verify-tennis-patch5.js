'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let success = true;
const results = [];
function run(name, args, options = {}) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, ...options });
  const passed = result.status === 0 && !result.error;
  results.push({ name, passed, status: result.status, signal: result.signal || null, error: result.error?.message || null });
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (!passed) success = false;
  return passed;
}
run('Node syntax - settlement contract', ['--check', 'backend/tennisSettlementContract.js']);
run('Node syntax - runtime diagnostics', ['--check', 'backend/runtimeDiagnostics.js']);
run('Node syntax - paper trading Tennis', ['--check', 'backend/paperTrading.tennis.js']);
run('Node syntax - server Tennis', ['--check', 'backend/server.tennis.js']);
run('Node syntax - server core', ['--check', 'backend/server.js']);
run('Node syntax - frontend public', ['--check', 'public/app.js']);
run('Node syntax - frontend backend/public', ['--check', 'backend/public/app.js']);
run('Patch 5 + compatibility tests', [
  'node_modules/jest/bin/jest.js',
  'backend/tests/patch5TennisSettlementEvidenceContract.test.js',
  'backend/tests/patch4TennisClvDataContract.test.js',
  'backend/tests/patch3TennisCanonicalEventIdentity.test.js',
  'backend/tests/patch2TennisMatchFormatContract.test.js',
  'backend/tests/patch1TennisPatchRegistryAndPipeline.test.js',
  'backend/tests/paperTrading.tennis.test.js',
  'backend/tests/server.tennis.health.test.js',
  '--runInBand'
]);
run('Patch 4 full verifier', ['tools/verify-tennis-patch4.js']);
run('Patch 3 full verifier', ['tools/verify-tennis-patch3.js']);
run('Patch 2 full verifier', ['tools/verify-tennis-patch2.js']);
run('Patch 1 full verifier', ['tools/verify-tennis-patch1.js']);
run('Tennis core regression suite', [
  'node_modules/jest/bin/jest.js',
  'backend/tests/server.tennis.professional.test.js',
  'backend/tests/server.tennis.health.test.js',
  'backend/tests/server.tennis.optimize.test.js',
  'backend/tests/tennisValueEvaluator.test.js',
  'backend/tests/paperTrading.tennis.test.js',
  '--runInBand'
]);
const sameApp = fs.readFileSync(path.join(ROOT, 'public', 'app.js')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'app.js')));
const sameIndex = fs.readFileSync(path.join(ROOT, 'public', 'index.html')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'index.html')));
results.push({ name: 'Frontend copies identical', passed: sameApp && sameIndex, sameApp, sameIndex });
console.log(`\n[${sameApp && sameIndex ? 'PASS' : 'FAIL'}] Frontend copies identical: app=${sameApp} index=${sameIndex}`);
if (!sameApp || !sameIndex) success = false;
const report = { success, patch: '5', timestamp: new Date().toISOString(), results };
fs.mkdirSync(path.join(ROOT, 'audit_patch5'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit_patch5', 'patch5_verification_report.json'), JSON.stringify(report, null, 2));
console.log(`\nReport: audit_patch5\\patch5_verification_report.json`);
if (!success) process.exit(2);
