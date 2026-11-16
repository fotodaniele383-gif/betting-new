'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const moduleFile = path.join(root, 'backend', 'calcioDualScoreArchitecture.js');
const checks = [
  ['dual score module exists', fs.existsSync(moduleFile)],
  ['server imports dual score architecture', server.includes("require('./calcioDualScoreArchitecture')")],
  ['server evaluates shadow after final market snapshot', server.includes('calcioDualScoreArchitecture.evaluateShadow({')],
  ['server asserts shadow invariants', server.includes('calcioDualScoreArchitecture.assertShadowInvariants')],
  ['server persists dual score fields', server.includes('calcioDualScoreArchitecture.persistenceFields(dualScoreShadow)')],
  ['server exposes read-only dual score endpoint', server.includes("app.get('/api/calcio/diagnostics/dual-score'")],
  ['endpoint reports authority violations', server.includes('authorityViolations')],
  ['endpoint reports PT no-sample non-zero weight', server.includes('ptNoSampleNonZeroWeight')],
  ['no new Odds API path in dual score module', !fs.readFileSync(moduleFile, 'utf8').includes('axios')]
].map(([name, ok]) => ({ name, ok: Boolean(ok) }));
for (const row of checks) assert.strictEqual(row.ok, true, row.name);
console.log(JSON.stringify({ success: true, checks }, null, 2));
