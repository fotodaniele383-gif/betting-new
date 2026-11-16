'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const suites = [
  'tools/test-calcio-patch21-standalone.js',
  'tools/verify-calcio-patch21-frontend.js',
  'tools/verify-calcio-patch21-db.js',
  'tools/verify-calcio-patch21-regression.js',
  'tools/audit-calcio-patch21.js'
];
const results = [];
for (const rel of suites) {
  const proc = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8', timeout: 600000, maxBuffer: 100*1024*1024, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  const result = { file: rel, ok: proc.status === 0, status: proc.status, stdout: proc.stdout || '', stderr: proc.stderr || '' };
  results.push(result);
  if (proc.status !== 0) {
    console.error(JSON.stringify({ success: false, patch: 'BETTING_PATCH_21_UNIFIED_IPM_STAKE_MARKET_SELECTION_RESTORE', failed: result }, null, 2));
    process.exit(1);
  }
  process.stdout.write(proc.stdout || '');
  process.stderr.write(proc.stderr || '');
}
console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_21_UNIFIED_IPM_STAKE_MARKET_SELECTION_RESTORE', verification: '5/5 PASS', suites }, null, 2));
