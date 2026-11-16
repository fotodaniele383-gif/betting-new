#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const files = [
  'backend/migrateTennisPatch34R4.js',
  'backend/tennisSettlementTruthPatch34R4.js',
  'tools/test-tennis-patch34-r4-truth-module.js',
  'tools/test-tennis-patch34-r4-snapshot-authority.js',
  'tools/verify-tennis-patch34-r4.js',
  'tools/audit-tennis-patch34-r4.js'
];
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); }
}
for (const relative of files) check(`${relative} exists`, () => assert(fs.existsSync(path.join(root, relative))));
const all = files.filter(relative => fs.existsSync(path.join(root, relative))).map(relative => fs.readFileSync(path.join(root, relative), 'utf8')).join('\n');
check('no /mnt/data build path', () => assert(!all.includes('/mnt/data/')));
check('no /home/oai build path', () => assert(!all.includes('/home/oai/')));
check('no absolute Windows require', () => assert(!/require\(['"][A-Za-z]:\\/.test(all)));
check('root relative', () => assert(all.includes("path.resolve(__dirname, '..')") || all.includes("path.resolve(__dirname,'..')")));
const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({ success: !failed.length, checks, passed: checks.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
