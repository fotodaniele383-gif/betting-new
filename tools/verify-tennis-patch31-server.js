#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.resolve(__dirname, '..');
const registry = require('../backend/tennisPatchRegistry');
const releaseSecurity = require('../backend/tennisReleaseSecurity');
const notifier = require('../backend/telegramNotifier');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } }
const files = ['backend/server.tennis.js','backend/tennisReleaseSecurity.js','backend/telegramNotifier.js','backend/tennisProgramProgressionAudit.js','backend/tennisPatchRegistry.js','tools/build-betting-safe-release.js','tools/audit-tennis-release-security.js'];
for (const file of files) check(`syntax ${file}`, () => { const r=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'}); assert.equal(r.status,0,r.stderr||r.stdout); });
const server = fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
check('registry Tennis 31', () => assert.equal(registry.TENNIS_CURRENT_PATCH_VERSION,'31'));
check('registry V31', () => assert.equal(registry.TENNIS_PATCH_REGISTRY_VERSION,'TENNIS_PATCH_REGISTRY_V31'));
check('Patch31 registrata', () => assert(registry.PATCHES.some(x => String(x.version)==='31' && x.status==='ACTIVE')));
check('endpoint security collegato', () => assert(server.includes("router.get('/release-security-health'")));
check('modulo security importato', () => assert(server.includes("require('./tennisReleaseSecurity')")));
check('health check Patch31 attivo', () => assert(server.includes('tennisReleaseSecurityActive')));
check('progression V23', () => assert(server.includes('TENNIS_PROGRAM_PROGRESSION_AUDIT_V23_PATCH31')));
check('security self health sano', () => assert.equal(releaseSecurity.buildSecurityHealth({projectRoot:root}).healthy,true));
check('Telegram env-only', () => assert.equal(notifier.TELEGRAM_CREDENTIAL_POLICY_VERSION,'TELEGRAM_ENV_ONLY_CREDENTIAL_POLICY_V1_PATCH31'));
const failed=checks.filter(x=>!x.ok);
console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));
process.exit(failed.length?1:0);
