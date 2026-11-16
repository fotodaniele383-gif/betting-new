'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const files = [
  'tools/test-calcio-patch26ea-standalone.js',
  'tools/verify-calcio-patch26ea-server.js',
  'tools/verify-calcio-patch26ea-frontend.js',
  'tools/verify-calcio-patch26ea-db.js',
  'tools/verify-calcio-patch26ea-regression.js'
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
console.log(JSON.stringify({ success, patch: 'BETTING_PATCH_26E_A_CALCIO_DEEPSCAN_FINAL_STATE_UI_CONSISTENCY', verification: `${suites.filter(s=>s.ok).length}/5 PASS`, suites }, null, 2));
if (!success) process.exit(1);
