'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const files = [
  'tools/test-calcio-patch26eb-standalone.js',
  'tools/verify-calcio-patch26eb-server.js',
  'tools/verify-calcio-patch26eb-frontend.js',
  'tools/verify-calcio-patch26eb-db.js',
  'tools/verify-calcio-patch26eb-regression.js'
];
const suites = files.map(file => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', file)], { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) {
    console.error(r.stdout || ''); console.error(r.stderr || '');
    return { file, ok: false };
  }
  return { file, ok: true };
});
const success = suites.every(s => s.ok);
console.log(JSON.stringify({ success, patch: 'BETTING_PATCH_26E_B_CALCIO_CROSS_MARKET_UNCERTAINTY_OPERATIONAL_GUARD', verification: `${suites.filter(s=>s.ok).length}/5 PASS`, suites }, null, 2));
if (!success) process.exit(1);
