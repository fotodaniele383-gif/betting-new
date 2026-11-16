#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative));
const text = relative => read(relative).toString('utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } }
check('app frontend parity', () => assert.equal(hash(read('public/app.js')), hash(read('backend/public/app.js'))));
check('index frontend parity', () => assert.equal(hash(read('public/index.html')), hash(read('backend/public/index.html'))));
check('marker app Patch30', () => assert(text('public/app.js').includes('TENNIS_PATCH30_CORE_HYGIENE_SCRIPT_CONTRACT_REPAIR')));
check('body marker Patch30', () => assert(text('public/index.html').includes('data-patch30-core-hygiene-script-contract-repair="true"')));
check('cache buster Patch30 o successivo', () => assert(/app\.js\?v=patch(?:30|31)-/.test(text('public/index.html'))));
check('marker R3 preservato', () => assert(text('public/app.js').includes('TENNIS_PATCH29_R3_PREMATCH_CAPTURE_GATE_COMPONENT_HEALTH_SEMANTIC')));
const ids = [...text('public/index.html').matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
check('nessun id HTML duplicato', () => assert.equal(ids.length, new Set(ids).size));
const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({ success: !failed.length, checks, passed: checks.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
