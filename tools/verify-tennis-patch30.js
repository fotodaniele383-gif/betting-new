#!/usr/bin/env node
'use strict';
const path = require('path');
const childProcess = require('child_process');
const root = path.resolve(__dirname, '..');
const suites = [
  'tools/test-tennis-patch30-all.js',
  'tools/verify-tennis-patch30-server.js',
  'tools/verify-tennis-patch30-frontend.js',
  'tools/verify-tennis-patch30-db.js',
  'tools/verify-tennis-patch30-regression.js',
  'tools/audit-tennis-core-contract.js',
  'tools/test-tennis-patch29-r3-all.js',
  'tools/verify-tennis-patch29-r3-server.js',
  'tools/verify-tennis-patch29-r3-frontend.js',
  'tools/verify-tennis-patch29-r3-db.js',
  'tools/verify-tennis-patch29-r3-regression.js',
  'tools/test-tennis-patch29-r2-all.js',
  'tools/test-tennis-patch29-r2-settlement.js',
  'tools/verify-tennis-patch29-r2-server.js',
  'tools/verify-tennis-patch29-r2-db.js'
];
let functionalChecks = 0;
const results = suites.map(file => {
  const result = childProcess.spawnSync(process.execPath, [path.join(root, file)], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  let json = null; try { json = JSON.parse(String(result.stdout || '').trim()); } catch (_) {}
  if (Array.isArray(json?.checks)) functionalChecks += json.checks.length;
  else if (Number.isFinite(Number(json?.checks))) functionalChecks += Number(json.checks);
  return { file, ok: result.status === 0, exitCode: result.status, ...(result.status === 0 ? {} : { stdout: result.stdout, stderr: result.stderr }) };
});
const failed = results.filter(item => !item.ok);
console.log(JSON.stringify({ success: !failed.length, patch: 'TENNIS_PATCH_30_CORE_HYGIENE_SCRIPT_CONTRACT_REPAIR', verification: failed.length ? 'FAILED' : `${suites.length}/${suites.length} PASS`, functionalChecks, suites: results }, null, 2));
process.exit(failed.length ? 1 : 0);
