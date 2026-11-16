#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const expected = require('./PATCH34_PROTECTED_HASHES.json');
const baseline = require('./PATCH34_BASELINE_PACKAGE_CONTRACT.json');
const checks = [];

function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); }
}
function hash(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
}
function normalized(value) { return value && typeof value === 'object' ? value : {}; }

for (const [file, sha] of Object.entries(expected)) {
  check(`immutato ${file}`, () => assert.equal(hash(file), sha));
}

const pkg = require('../package.json');
check('contratto dipendenze baseline incorporato', () => {
  assert.equal(baseline.contract, 'TENNIS_PATCH34_R3_BASELINE_PACKAGE_DEPENDENCY_CONTRACT_V1');
  assert.equal(baseline.baselinePackageVersion, '21.20.0');
});
check('dipendenze npm invariate', () => {
  assert.deepEqual(normalized(pkg.dependencies), normalized(baseline.dependencies));
  assert.deepEqual(normalized(pkg.devDependencies), normalized(baseline.devDependencies));
  assert.deepEqual(normalized(pkg.optionalDependencies), normalized(baseline.optionalDependencies));
  assert.deepEqual(normalized(pkg.peerDependencies), normalized(baseline.peerDependencies));
  assert.deepEqual(normalized(pkg.engines), normalized(baseline.engines));
});
check('nessun nuovo endpoint Calcio', () => {
  const server = fs.readFileSync(path.join(root, 'backend/server.tennis.js'), 'utf8');
  assert(!server.includes("router.get('/calcio"));
});
check('schedule senza API esterne', () => {
  const code = fs.readFileSync(path.join(root, 'backend/tennisOfficialScheduleAuthority.js'), 'utf8');
  assert(!/axios|fetch\(|https?:\/\//i.test(code));
});

const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({ success: !failed.length, checks, passed: checks.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
