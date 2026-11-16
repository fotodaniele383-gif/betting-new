'use strict';
const path = require('path');
if (process.env.PATCH26EC_FORCE_VERIFICATION_FAILURE === '1') {
  console.error('PATCH26EC_FORCED_VERIFICATION_FAILURE');
  process.exit(97);
}
const { spawnSync } = require('child_process');
const files = [
  'tools/test-calcio-patch26ec-all.js',
  'tools/verify-calcio-patch26ec-server.js',
  'tools/verify-calcio-patch26ec-frontend.js',
  'tools/verify-calcio-patch26ec-db.js',
  'tools/verify-calcio-patch26ec-regression.js'
];
const root = path.join(__dirname, '..');
const suites = files.map(file => {
  const r = spawnSync(process.execPath, [path.join(root, file)], {
    cwd: root, env: process.env, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024
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
  patch: 'BETTING_PATCH_26E_C_CALCIO_UNIFIED_STAKE_AUTHORITY_DATA_QUALITY_COHERENCE_RECOVERY',
  verification: `${suites.filter(s => s.ok).length}/5 PASS`,
  suites
}, null, 2));
if (!success) process.exit(1);
