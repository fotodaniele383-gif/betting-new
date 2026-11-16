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

const files = [
  'backend/migrateTennisPatch34.js',
  'backend/tennisOfficialScheduleAuthority.js',
  'tools/audit-tennis-patch34.js',
  'tools/rollback-tennis-patch34.js',
  'tools/test-tennis-patch34-schedule-module.js',
  'tools/test-tennis-patch34-transactional-contract.js',
  'tools/verify-tennis-patch34-db.js',
  'tools/verify-tennis-patch34-frontend.js',
  'tools/verify-tennis-patch34-regression.js',
  'tools/verify-tennis-patch34-server.js',
  'tools/verify-tennis-patch34.js',
  'tools/verify-tennis-patch34-r3-baseline-recovery.js'
];
const contents = files.map(relative => ({ relative, text: fs.readFileSync(path.join(root, relative), 'utf8') }));
const joined = contents.map(item => item.text).join('\n');

check('nessun percorso sandbox di build', () => {
  assert(!/\/mnt\/data\/|\/home\/oai\/|patch3[34]_install_cycle/i.test(joined));
});
check('nessun require assoluto POSIX o Windows', () => {
  for (const item of contents) {
    assert(!/require\s*\(\s*['"](?:\/|[A-Za-z]:[\\/])/.test(item.text), item.relative);
  }
});
check('contratto baseline relativo presente', () => {
  const file = path.join(root, 'tools/PATCH34_BASELINE_PACKAGE_CONTRACT.json');
  assert(fs.existsSync(file));
  const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(contract.contract, 'TENNIS_PATCH34_R3_BASELINE_PACKAGE_DEPENDENCY_CONTRACT_V1');
});
check('regression verifier usa contratto locale', () => {
  const text = fs.readFileSync(path.join(root, 'tools/verify-tennis-patch34-regression.js'), 'utf8');
  assert(text.includes("require('./PATCH34_BASELINE_PACKAGE_CONTRACT.json')"));
});
check('regression verifier indipendente dal cwd', () => {
  const text = fs.readFileSync(path.join(root, 'tools/verify-tennis-patch34-regression.js'), 'utf8');
  assert(!/process\.cwd\(\)/.test(text));
});
check('root runtime derivata da __dirname', () => {
  const text = fs.readFileSync(path.join(root, 'tools/verify-tennis-patch34-regression.js'), 'utf8');
  assert(text.includes("path.resolve(__dirname, '..')"));
});

const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({ success: !failed.length, patch: 'TENNIS_PATCH_34_R3_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE', checks, passed: checks.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
