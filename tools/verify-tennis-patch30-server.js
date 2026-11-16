#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const childProcess = require('child_process');
const root = path.resolve(__dirname, '..');
const core = require('../backend/tennisCoreContractAudit');
const registry = require('../backend/tennisPatchRegistry');
const files = [
  'backend/server.tennis.js', 'backend/tennisCoreContractAudit.js',
  'backend/repairTennisPendingConsistency.js', 'backend/repairStep49CSoftBlocks.js',
  'backend/tennisPatchRegistry.js', 'backend/tennisProgramProgressionAudit.js',
  'tools/rollback-tennis-patch29.js'
];
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } }
for (const file of files) {
  check(`syntax ${file}`, () => {
    const result = childProcess.spawnSync(process.execPath, ['--check', path.join(root, file)], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
const server = fs.readFileSync(path.join(root, 'backend/server.tennis.js'), 'utf8');
const report = core.buildCoreContractAudit({ projectRoot: root });
check('registry >=30 server-side', () => assert(Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 30));
check('core contract health OK', () => assert(report.healthy === true));
check('route map contiene core health', () => assert(report.routeDependencyMap.some(item => item.route === '/core-contract-health' && item.dependencies.some(dep => dep.alias === 'tennisCoreContractAudit'))));
check('nessuna duplicazione funzione history', () => assert.equal((server.match(/function getStep91PResolvedTennisHistory\s*\(/g) || []).length, 1));
check('nessun import relativo mancante', () => assert.equal(report.runtimeDependencies.missing.length, 0));
check('nessun executable target mancante', () => assert.equal(report.packageScripts.missingFileTargets.length, 0));
const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({ success: !failed.length, checks, passed: checks.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
