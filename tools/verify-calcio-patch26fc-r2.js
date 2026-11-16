'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const commands = [
  [process.execPath, ['--check', path.join(root, 'backend', 'calcioFinalMarketDiagnosticContract.js')], 'contract-syntax'],
  [process.execPath, ['--check', path.join(root, 'backend', 'server.js')], 'server-syntax'],
  [process.execPath, ['--check', path.join(root, 'public', 'app.js')], 'frontend-syntax'],
  [process.execPath, [path.join(root, 'tools', 'test-calcio-patch26fc-r2-final-probability-snapshot.js')], 'r2-functional'],
  [process.execPath, [path.join(root, 'tools', 'test-calcio-patch26fc-r2-live-fixture.js')], 'r2-live-fixture'],
  [process.execPath, [path.join(root, 'tools', 'verify-calcio-patch26fc.js')], 'patch26fc-regression'],
  [process.execPath, [path.join(root, 'tools', 'verify-calcio-patch26fc-r1.js')], 'r1-runtime-regression'],
  [process.execPath, [path.join(root, 'tools', 'audit-calcio-patch26fc-r2.js')], 'r2-read-only-audit']
];
const results = [];
for (const [cmd, args, label] of commands) {
  const run = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env: process.env, maxBuffer: 128 * 1024 * 1024 });
  results.push({ label, ok: run.status === 0, exitCode: run.status, stdout: run.stdout || '', stderr: run.stderr || '' });
}
const success = results.every(row => row.ok);
console.log(JSON.stringify({
  success,
  patch: 'BETTING_PATCH_26F_C_R2_FINAL_PROBABILITY_SNAPSHOT_FALLBACK',
  verification: `${results.filter(row => row.ok).length}/${results.length} PASS`,
  results
}, null, 2));
if (!success) process.exit(1);
