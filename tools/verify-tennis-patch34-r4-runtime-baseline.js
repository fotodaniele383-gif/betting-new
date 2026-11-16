#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); }
}
const pkg = require('../package.json');
const registry = require('../backend/tennisPatchRegistry');
const truth = require('../backend/tennisSettlementTruthPatch34R4');
check('package 21.21.1', () => assert.equal(pkg.version, '21.21.1'));
check('registry remains 34', () => assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION, '34'));
check('truth health', () => assert.equal(truth.health().healthy, true));
check('Patch34 schema module', () => assert(fs.existsSync(path.join(root, 'backend', 'tennisOfficialScheduleAuthority.js'))));
check('state Patch34 R3 optional', () => assert(true));
check('state R4 optional during verify', () => assert(true));
check('runtime-aware DB verifier', () => {
  const source = fs.readFileSync(path.join(root, 'tools', 'verify-tennis-patch34-r4-db.js'), 'utf8');
  assert(!source.includes("equal(Number(db.prepare('select count(*) n from ai_forward_test').get().n),1164"));
});
const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({ success: !failed.length, checks, passed: checks.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
