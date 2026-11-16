'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const suites = [
  'test-calcio-patch18-standalone.js',
  'verify-calcio-patch18-frontend.js',
  'verify-calcio-patch18-db.js',
  'verify-calcio-patch18-regression.js',
  'audit-calcio-patch18.js'
];

const results = [];
for (const file of suites) {
  const proc = spawnSync(process.execPath, [path.join(root, 'tools', file)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' }
  });
  const result = {
    file,
    ok: proc.status === 0,
    status: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || ''
  };
  results.push(result);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (!result.ok) {
    console.error(JSON.stringify({ success: false, patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE', failedSuite: file }, null, 2));
    process.exit(proc.status || 1);
  }
}

console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE',
  suites: suites.length,
  passed: suites.length,
  failed: 0,
  suiteNames: suites,
  verdict: 'BETTING PATCH 18 VERIFY: PASS'
}, null, 2));
