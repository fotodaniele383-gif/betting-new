#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const childProcess = require('child_process');
const root = path.resolve(__dirname, '..');
const registry = require('../backend/tennisPatchRegistry');
const coreAudit = require('../backend/tennisCoreContractAudit');
const runtimeHealth = require('../backend/tennisRuntimeHealthContract');
const prematchGate = require('../backend/tennisPrematchCaptureGate');
const pkg = require('../package.json');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } }
function runJson(relative, extra = []) {
  const result = childProcess.spawnSync(process.execPath, [path.join(root, relative), '--root', root, ...extra], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  let json = null; try { json = JSON.parse(String(result.stdout || '').trim()); } catch (_) {}
  return { ...result, json };
}

const server = read('backend/server.tennis.js');
const progression = read('backend/tennisProgramProgressionAudit.js');
const pendingRepair = read('backend/repairTennisPendingConsistency.js');
const step49Repair = read('backend/repairStep49CSoftBlocks.js');
const rollback29 = read('tools/rollback-tennis-patch29.js');
const app = read('public/app.js');
const index = read('public/index.html');
const databasePath = path.join(root, 'backend', 'database_betting.db');
const dbHashBefore = hash(databasePath);
const pendingPreview = runJson('backend/repairTennisPendingConsistency.js');
const dbHashAfterPending = hash(databasePath);
const step49Preview = runJson('backend/repairStep49CSoftBlocks.js');
const dbHashAfterStep49 = hash(databasePath);
const contract = coreAudit.buildCoreContractAudit({ projectRoot: root });

check('package compatibile >=21.17.0', () => assert(Number(pkg.version.split('.')[1]) >= 17));
check('registry Tennis >=30', () => assert(Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 30));
check('registry coerente >=V30', () => assert.equal(registry.TENNIS_PATCH_REGISTRY_VERSION, `TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`));
check('Patch 29 resta registrata', () => assert(registry.PATCHES.some(item => String(item.version) === '29')));
check('Patch 30 attiva', () => assert(registry.PATCHES.some(item => String(item.version) === '30' && item.status === 'ACTIVE')));
check('Core Contract Audit V1', () => assert.equal(coreAudit.TENNIS_CORE_CONTRACT_AUDIT_VERSION, 'TENNIS_CORE_CONTRACT_AUDIT_V1_PATCH30'));
check('contratto package scripts sano', () => assert(contract.packageScripts.healthy && contract.packageScripts.missingFileTargets.length === 0));
check('riferimenti npm interni sani', () => assert.equal(contract.packageScripts.missingScriptReferences.length, 0));
check('dipendenze runtime relative sane', () => assert(contract.runtimeDependencies.healthy && contract.runtimeDependencies.missing.length === 0));
check('nessuna funzione runtime duplicata', () => assert.equal(contract.duplicateFunctionDeclarations.length, 0));
check('route core contract collegata', () => assert(contract.routeContract.linked === true));
check('server importa Core Contract Audit', () => assert(server.includes("require('./tennisCoreContractAudit')")));
check('endpoint core contract presente', () => assert(server.includes("router.get('/core-contract-health'")));
check('una sola getStep91PResolvedTennisHistory', () => assert.equal((server.match(/function getStep91PResolvedTennisHistory\s*\(/g) || []).length, 1));
check('implementazione effettiva Step92 preservata', () => assert(server.includes('function getStep91PResolvedTennisHistory(options = {}) { return getStep92TennisHistoryRows(options); }')));
check('health contract R3 corretto', () => assert(server.includes("TENNIS_RUNTIME_HEALTH_CONTRACT_V2_PATCH29_R3") && !server.includes("tennisRuntimeHealthContract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION === 'TENNIS_RUNTIME_HEALTH_CONTRACT_V1_PATCH25'")));
check('progression audit Patch30 o successivo', () => assert(/TENNIS_PROGRAM_PROGRESSION_AUDIT_V(?:22_PATCH30|23_PATCH31)/.test(progression)));
check('repair pending ripristinata', () => assert(pendingRepair.includes('Step 15 - Tennis Pending Consistency Repair') && pendingRepair.includes('Step 16 - Tennis Paper Trading Consistency Repair v2')));
check('repair pending Tennis-only', () => assert(pendingRepair.includes("UPPER(COALESCE(sport_type, '')) = 'TENNIS'") && pendingRepair.includes('BLOCKED_OPPOSITE_SIDE_CONFLICT')));
check('repair pending non aumenta stake', () => assert(pendingRepair.includes('repair non aumenta stake già ridotti') && pendingRepair.includes('current < target')));
check('preview pending non mutante', () => assert.equal(pendingPreview.status, 0, pendingPreview.stderr || pendingPreview.stdout));
check('preview pending dichiara PREVIEW', () => assert.equal(pendingPreview.json?.mode, 'PREVIEW'));
check('preview pending hash DB invariato', () => assert.equal(dbHashBefore, dbHashAfterPending));
check('repair Step49C ripristinata', () => assert(step49Repair.includes('STEP49C_REPAIR_SOFT_BLOCKS') && step49Repair.includes('CONSENSUS_MICRO_STAKE_DEEPSCAN_CONFIRMED_REPAIR')));
check('repair Step49C protegge totals/hard/wait', () => assert(step49Repair.includes("prediction.includes('OVER') || prediction.includes('UNDER')") && step49Repair.includes("gateStatus.includes('HARD')") && step49Repair.includes("text.includes('WAIT_IN_PLAY')")));
check('preview Step49C non mutante', () => assert.equal(step49Preview.status, 0, step49Preview.stderr || step49Preview.stdout));
check('preview Step49C dichiara PREVIEW', () => assert.equal(step49Preview.json?.mode, 'PREVIEW'));
check('preview Step49C hash DB invariato', () => assert.equal(dbHashAfterPending, dbHashAfterStep49));
check('rollback Patch29 dispatcher', () => assert(rollback29.includes('PATCH30_DEPENDENCY_ACTIVE') && rollback29.includes('rollback-tennis-patch29-r3.js')));
check('test Step85B ripristinato', () => assert(fs.existsSync(path.join(root, 'backend/tests/step85BPortfolioCompatMarkerFix.test.js'))));
check('frontend Patch30 marker', () => assert(app.includes('TENNIS_PATCH30_CORE_HYGIENE_SCRIPT_CONTRACT_REPAIR')));
check('cache buster Patch30 o successivo', () => assert(/app\.js\?v=patch(?:30|31)-/.test(index)));
check('frontend copie allineate', () => assert.equal(read('public/app.js'), read('backend/public/app.js')));
check('index copie allineate', () => assert.equal(read('public/index.html'), read('backend/public/index.html')));
check('Prematch Gate R3 preservato', () => assert(prematchGate.selfCheck().ok === true));
check('Component Health Semantic preservato', () => assert.equal(runtimeHealth.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION, 'TENNIS_RUNTIME_HEALTH_CONTRACT_V2_PATCH29_R3'));

const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({ success: failed.length === 0, patch: 'TENNIS_PATCH_30_CORE_HYGIENE_SCRIPT_CONTRACT_REPAIR', checks: checks.length, passed: checks.length - failed.length, failed: failed.length, results: checks }, null, 2));
process.exit(failed.length ? 1 : 0);
