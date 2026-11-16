#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const tennisRegistry = require('../backend/tennisPatchRegistry');
const globalRegistry = require('../backend/calcioPatchRegistry');
const gate = require('../backend/tennisPrematchCaptureGate');
const health = require('../backend/tennisRuntimeHealthContract');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } }
const dependencyHash = crypto.createHash('sha256').update(JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies })).digest('hex');
const expectedDependencyHash = '44734dc36db7dfc064ad4f1fe234d25ca9861fb505623bb079be22e745a0c76d';
const r3 = childProcess.spawnSync(process.execPath, [path.join(root, 'tools/verify-tennis-patch29-r3.js')], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
check('R3 9/9 continua a passare', () => assert.equal(r3.status, 0, r3.stderr || r3.stdout));
check('registry globale resta 38', () => assert.equal(String(globalRegistry.CALCIO_CURRENT_PATCH_VERSION), '38'));
check('registry Tennis conserva Patch 30', () => assert(Number(tennisRegistry.TENNIS_CURRENT_PATCH_VERSION) >= 30 && tennisRegistry.PATCHES.some(item => String(item.version) === '30')));
check('dipendenze npm invariate', () => assert.equal(dependencyHash, expectedDependencyHash));
check('Prematch Gate invariato', () => assert(gate.selfCheck().ok === true && gate.TENNIS_PREMATCH_CAPTURE_GATE_VERSION === 'TENNIS_PREMATCH_CAPTURE_GATE_V1_PATCH29_R3'));
check('Component Health Semantic invariato', () => assert.equal(health.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION, 'TENNIS_RUNTIME_HEALTH_CONTRACT_V2_PATCH29_R3'));
check('nessuna Odds API nei nuovi moduli', () => {
  for (const file of ['backend/tennisCoreContractAudit.js','backend/repairTennisPendingConsistency.js','backend/repairStep49CSoftBlocks.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert(!/axios|fetch\(|odds.?api/i.test(source), file);
  }
});
check('nessuna autorità modello/stake automatica', () => {
  const source = fs.readFileSync(path.join(root, 'backend/tennisCoreContractAudit.js'), 'utf8');
  assert(source.includes('productionProbability: false') && source.includes('qualityGate: false') && source.includes('stake: false'));
  assert(fs.readFileSync(path.join(root, 'backend/repairTennisPendingConsistency.js'), 'utf8').includes("const apply = args.includes('--apply')"));
  assert(fs.readFileSync(path.join(root, 'backend/repairStep49CSoftBlocks.js'), 'utf8').includes("const apply = args.includes('--apply')"));
});
const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({ success: !failed.length, checks, passed: checks.length - failed.length, failed: failed.length, r3Verification: r3.status === 0 ? '9/9 PASS' : 'FAILED' }, null, 2));
process.exit(failed.length ? 1 : 0);
