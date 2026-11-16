'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
if (process.env.PATCH26FA_FORCE_VERIFICATION_FAILURE === '1') {
  console.error('PATCH26FA_FORCED_VERIFICATION_FAILURE');
  process.exit(97);
}
const files = [
  'tools/test-calcio-patch26fa-all.js',
  'tools/verify-calcio-patch26fa-server.js',
  'tools/verify-calcio-patch26fa-frontend.js',
  'tools/verify-calcio-patch26fa-db.js',
  'tools/verify-calcio-patch26fa-regression.js'
];
const root = path.join(__dirname, '..');
const suites = files.map(file => {
  const r = spawnSync(process.execPath, [path.join(root, file)], {
    cwd: root, env: process.env, encoding: 'utf8', timeout: 240000, maxBuffer: 96 * 1024 * 1024
  });
  if (r.status !== 0) {
    console.error(r.stdout || ''); console.error(r.stderr || '');
    return { file, ok: false, exitCode: r.status };
  }
  return { file, ok: true };
});
const success = suites.every(s => s.ok);
console.log(JSON.stringify({
  success,
  patch: 'BETTING_PATCH_26F_A_CALCIO_FINAL_MARKET_DIAGNOSTIC_CONTRACT_DECISION_STATE',
  verification: `${suites.filter(s => s.ok).length}/5 PASS`,
  suites
}, null, 2));
if (!success) process.exit(1);
