'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const files = [
  'tools/test-calcio-patch1-standalone.js',
  'tools/test-calcio-patch2-standalone.js',
  'tools/test-calcio-patch3-standalone.js',
  'tools/test-calcio-patch4-standalone.js',
  'tools/test-calcio-patch5-standalone.js',
  'tools/test-calcio-patch6-standalone.js',
  'tools/test-calcio-patch7-standalone.js',
  'tools/test-calcio-patch8-standalone.js',
  'tools/test-calcio-patch9-standalone.js',
  'tools/test-calcio-patch12-standalone.js'
];
const syntax = [
  'backend/calcioDecisionCertification.js',
  'backend/calcioUnifiedPredictionIndex.js',
  'backend/calcioStakeReconciler.js',
  'backend/server.js',
  'public/app.js'
];
const results = [];
for (const rel of syntax) {
  const proc = spawnSync(process.execPath, ['--check', path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  results.push({ file: `syntax:${rel}`, ok: proc.status === 0, status: proc.status, stderrTail: (proc.stderr || '').slice(-2000) });
}
for (const rel of files) {
  const proc = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 30 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  results.push({ file: rel, ok: proc.status === 0, status: proc.status, stdoutTail: (proc.stdout || '').slice(-2500), stderrTail: (proc.stderr || '').slice(-2500) });
}
const failed = results.filter(row => !row.ok);
if (failed.length) throw new Error(`Regressioni Patch 20 fallite: ${JSON.stringify(failed, null, 2)}`);
console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_20_CERTIFIED_DECISION_STAKE_AUTHORITY_RESTORE',
  compatibleLegacySuites: files.length,
  syntaxChecks: syntax.length,
  results,
  supersededAssertions: [
    'Patch 19: Professional SOFT sempre stake zero',
    'Patch 19: proxy/watchlist senza campione PT sempre stake zero'
  ],
  replacementCoverage: ['tools/test-calcio-patch20-standalone.js']
}, null, 2));
