'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');

// Patch 10 and 13-17 standalone scripts encode the superseded pre-Patch-18
// stake authority (they expect theoretical/operational stakes without certified
// multi-source odds). Their functional invariants are re-covered by the Patch 18
// standalone + DB suites instead of weakening the new safety contract.
const compatibleLegacyScripts = [
  'test-calcio-patch1-standalone.js',
  'test-calcio-patch2-standalone.js',
  'test-calcio-patch3-standalone.js',
  'test-calcio-patch4-standalone.js',
  'test-calcio-patch6-standalone.js',
  'test-calcio-patch7-standalone.js',
  'test-calcio-patch8-standalone.js',
  'test-calcio-patch9-standalone.js',
  'test-calcio-patch12-standalone.js'
];

const results = [];

// Run the Patch 5 verification core directly so no audit report is written into
// the live project during installation/rollback verification.
{
  const code = "const {runCalcioPatch5Verification}=require('./tools/calcioPatch5VerificationCore'); const r=runCalcioPatch5Verification(process.cwd()); if(!r||r.success!==true) process.exit(1); console.log(JSON.stringify(r));";
  const proc = spawnSync(process.execPath, ['-e', code], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' }
  });
  results.push({ file: 'calcioPatch5VerificationCore.js', ok: proc.status === 0, status: proc.status, stdoutTail: (proc.stdout || '').slice(-800), stderrTail: (proc.stderr || '').slice(-800) });
  if (proc.status !== 0) {
    console.error(JSON.stringify({ success: false, patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE', results }, null, 2));
    process.exit(proc.status || 1);
  }
}
for (const file of compatibleLegacyScripts) {
  const proc = spawnSync(process.execPath, [path.join(root, 'tools', file)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' }
  });
  const result = {
    file,
    ok: proc.status === 0,
    status: proc.status,
    stdoutTail: (proc.stdout || '').slice(-800),
    stderrTail: (proc.stderr || '').slice(-800)
  };
  results.push(result);
  if (!result.ok) {
    console.error(JSON.stringify({ success: false, patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE', results }, null, 2));
    process.exit(proc.status || 1);
  }
}

const registry = require('../backend/calcioPatchRegistry');
assert.strictEqual(String(registry.CALCIO_CURRENT_PATCH_VERSION || ''), '18');

console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE',
  compatibleLegacySuites: results.length,
  results,
  excludedNonDeterministicLegacyChecks: ['Patch 11 standalone external Understat probe'],
  supersededLegacyAssertions: [
    'Patch 10 early-watchlist theoretical stake without certified odds',
    'Patch 13-17 pre-certified-odds stake/index authority fixtures'
  ],
  replacementCoverage: [
    'test-calcio-patch18-standalone.js',
    'verify-calcio-patch18-db.js',
    'verify-calcio-patch18-frontend.js'
  ]
}, null, 2));
