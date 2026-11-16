'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const files = [
  'tools/test-calcio-patch26fc-all.js',
  'tools/verify-calcio-patch26fc-server.js',
  'tools/verify-calcio-patch26fc-frontend.js',
  'tools/verify-calcio-patch26fc-db.js',
  'tools/verify-calcio-patch26fc-regression.js'
];
const results = files.map(file => {
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', file)], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: process.env, maxBuffer: 128 * 1024 * 1024 });
  if (run.status !== 0) {
    if (run.stdout) process.stderr.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
  }
  return { file, ok: run.status === 0, exitCode: run.status };
});
const success = results.every(row => row.ok);
console.log(JSON.stringify({ success, patch: 'BETTING_PATCH_26F_C_CALCIO_DUAL_SCORE_ARCHITECTURE_SHADOW', verification: `${results.filter(row => row.ok).length}/${results.length} PASS`, suites: results }, null, 2));
process.exit(success ? 0 : 1);
