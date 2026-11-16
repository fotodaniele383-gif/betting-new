'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let success = true;
const results = [];
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  const passed = result.status === 0 && !result.error;
  results.push({ name, passed, status: result.status, signal: result.signal || null, error: result.error?.message || null });
  console.log(`\n[${passed ? 'PASS' : 'FAIL'}] ${name}`);
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (!passed) success = false;
}
run('Node syntax - calibration eligibility', ['--check', 'backend/tennisCalibrationEligibility.js']);
run('Node syntax - server Tennis', ['--check', 'backend/server.tennis.js']);
run('Node syntax - migration Patch 6', ['--check', 'tools/migrate-tennis-patch6-calibration-eligibility.js']);
run('Node syntax - DB verifier Patch 6', ['--check', 'tools/verify-tennis-patch6-db.js']);
run('Node syntax - frontend public', ['--check', 'public/app.js']);
run('Node syntax - frontend backend/public', ['--check', 'backend/public/app.js']);
run('Patch 6 + compatibility tests', [
  'node_modules/jest/bin/jest.js',
  'backend/tests/patch6TennisCalibrationEligibilityShadow.test.js',
  'backend/tests/patch5TennisSettlementEvidenceContract.test.js',
  'backend/tests/patch4TennisClvDataContract.test.js',
  'backend/tests/patch3TennisCanonicalEventIdentity.test.js',
  'backend/tests/patch2TennisMatchFormatContract.test.js',
  'backend/tests/patch1TennisPatchRegistryAndPipeline.test.js',
  'backend/tests/server.tennis.health.test.js',
  '--runInBand'
]);
run('Patch 5 full verifier (include regressioni Patch 1-4 e Tennis core)', ['tools/verify-tennis-patch5.js']);
const sameApp = fs.readFileSync(path.join(ROOT, 'public', 'app.js')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'app.js')));
const sameIndex = fs.readFileSync(path.join(ROOT, 'public', 'index.html')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'index.html')));
results.push({ name: 'Frontend copies identical', passed: sameApp && sameIndex, sameApp, sameIndex });
console.log(`\n[${sameApp && sameIndex ? 'PASS' : 'FAIL'}] Frontend copies identical: app=${sameApp} index=${sameIndex}`);
if (!sameApp || !sameIndex) success = false;
const source = fs.readFileSync(path.join(ROOT, 'backend', 'server.tennis.js'), 'utf8');
const routeStart = source.indexOf("router.get('/calibration-readiness'");
const routeEnd = source.indexOf("router.get('/health'", routeStart);
const routeBlock = routeStart >= 0 && routeEnd > routeStart ? source.slice(routeStart, routeEnd) : '';
const readOnly = routeBlock && !/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(routeBlock);
results.push({ name: 'Readiness endpoint source is read-only', passed: Boolean(readOnly) });
console.log(`\n[${readOnly ? 'PASS' : 'FAIL'}] Readiness endpoint source is read-only`);
if (!readOnly) success = false;
const report = { success, patch: '6', timestamp: new Date().toISOString(), results };
fs.mkdirSync(path.join(ROOT, 'audit_patch6'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'audit_patch6', 'patch6_verification_report.json'), JSON.stringify(report, null, 2));
console.log('\nReport: audit_patch6\\patch6_verification_report.json');
if (!success) process.exit(2);
