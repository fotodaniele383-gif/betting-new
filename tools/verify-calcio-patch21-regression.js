'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const legacy = [
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
].filter(rel => fs.existsSync(path.join(root, rel)));
const syntax = [
  'backend/server.js', 'backend/calcioDecisionCertification.js', 'backend/calcioUnifiedPredictionIndex.js',
  'backend/calcioProfessionalSelection.js', 'backend/calcioStakeReconciler.js', 'public/app.js', 'backend/public/app.js'
];
const results = [];
for (const rel of legacy) {
  const proc = spawnSync(process.execPath, [path.join(root, rel)], { cwd: root, encoding: 'utf8', timeout: 600000, maxBuffer: 100*1024*1024, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  results.push({ file: rel, ok: proc.status === 0, status: proc.status, stdoutTail: (proc.stdout || '').slice(-2000), stderrTail: (proc.stderr || '').slice(-2000) });
  assert.equal(proc.status, 0, `${rel} fallito: ${proc.stderr || proc.stdout}`);
}
for (const rel of syntax) {
  const proc = spawnSync(process.execPath, ['--check', path.join(root, rel)], { cwd: root, encoding: 'utf8' });
  results.push({ file: `syntax:${rel}`, ok: proc.status === 0, status: proc.status, stderrTail: proc.stderr || '' });
  assert.equal(proc.status, 0, `${rel} syntax fallita: ${proc.stderr}`);
}
console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_21_UNIFIED_IPM_STAKE_MARKET_SELECTION_RESTORE',
  compatibleLegacySuites: legacy.length,
  syntaxChecks: syntax.length,
  results,
  supersededAssertions: [
    'Patch 19-20: Edge/EV escluso dall’IPM',
    'Patch 19-20: PT n=0 penalizzato',
    'Patch 19: soglie legacy come veto assoluto',
    'Patch 20: cap prudenziale successivo all’IPM'
  ]
}, null, 2));
