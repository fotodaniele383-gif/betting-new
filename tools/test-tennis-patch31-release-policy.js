#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const security = require('../backend/tennisReleaseSecurity');
const root = path.resolve(__dirname, '..');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } }
const plan = security.buildReleasePlan(root, { withHashes: false });
const paths = new Set(plan.included.map(x => x.path));
check('package incluso', () => assert(paths.has('package.json')));
check('server incluso', () => assert(paths.has('backend/server.js')));
check('release security incluso', () => assert(paths.has('backend/tennisReleaseSecurity.js')));
check('env escluso', () => assert(!paths.has('.env')));
check('backend env escluso', () => assert(!paths.has('backend/.env')));
check('env example incluso', () => assert(paths.has('.env.example')));
check('database escluso', () => assert(!paths.has('backend/database_betting.db')));
check('Telegram config esclusa', () => assert(!paths.has('backend/telegram.config.json')));
check('Telegram example incluso', () => assert(paths.has('backend/telegram.config.example.json')));
check('ngrok escluso', () => assert(!paths.has('backend/ngrok.exe')));
check('backup patch esclusi', () => assert(![...paths].some(p => p.includes('.betting_patch_backups'))));
check('state patch esclusi', () => assert(![...paths].some(p => /^\.(tennis|calcio)_patch.*_state\.json$/i.test(p))));
check('size guard attivo', () => assert.equal(plan.summary.maxBytes, 150 * 1024 * 1024));
check('releaseignore presente', () => assert(fs.readFileSync(path.join(root, '.releaseignore'), 'utf8').includes('backend/database_betting.db')));
const failed = checks.filter(x => !x.ok);
console.log(JSON.stringify({ success: !failed.length, checks, passed: checks.length - failed.length, failed: failed.length, summary: plan.summary }, null, 2));
process.exit(failed.length ? 1 : 0);
