'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const observability = fs.readFileSync(path.join(root, 'backend/calcioObservability.js'), 'utf8');
const allocator = fs.readFileSync(path.join(root, 'backend/calcioBatchPortfolioAllocator.js'), 'utf8');
const registry = require('../backend/calcioPatchRegistry');

const declaration = server.indexOf('let stakeReconciliationDecision = null;');
const pendingBlock = server.indexOf('if (pendingCalcioRow) {', declaration);
const returnUse = server.indexOf("deepScanGateMode: stakeReconciliationDecision?.portfolioBatchCertified", pendingBlock);
assert.ok(declaration >= 0 && pendingBlock > declaration && returnUse > pendingBlock, 'Scope stakeReconciliationDecision non corretto');
assert.ok(!server.includes('displayAction = report.action;\n                let stakeReconciliationDecision = null;'), 'Dichiarazione interna Patch 26C ancora presente');
assert.ok(server.includes('calcioObservationFinalization = null;'), 'Handle osservabilità terminale non disarmato');
assert.ok(server.includes('terminalWriteProtected: true'), 'Marker protezione terminale mancante');
assert.ok(observability.includes("currentStatus !== 'STARTED'"), 'Guard COMPLETED→FAILED mancante');
assert.ok(observability.includes("WHERE finalization_id = ? AND status = 'STARTED'"), 'Update FAILED non limitato a STARTED');
assert.ok(allocator.includes('BETTING_PATCH_26D_BATCH_PORTFOLIO_ALLOCATOR_V2'), 'Versione allocatore V2 mancante');
assert.ok(allocator.includes('CALCIO_26D_BATCH_NO_COMPLETED_EVENTS'), 'Guard zero eventi completati mancante');
assert.ok(allocator.includes("'EXCLUDED_FAILED_FINALIZATION'"), 'Semantica evento fallito mancante');
assert.ok(allocator.includes("'BATCH_OUTPUT_COHERENCE_NOT_CERTIFIED'"), 'Coerenza fallimento non corretta');

for (const file of ['backend/server.js','backend/calcioObservability.js','backend/calcioBatchPortfolioAllocator.js','backend/calcioPatchRegistry.js']) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
}
assert.equal(registry.CALCIO_CURRENT_PATCH_VERSION, '29');
const patch = registry.PATCHES.find(item => item.version === '29');
assert.ok(patch);
assert.equal(patch.id, 'BETTING_PATCH_26D_CALCIO_POST_COMMIT_SCOPE_BATCH_RECOVERY');
assert.equal(patch.postCommitScopeReferenceFixed, true);
assert.equal(patch.completedFinalizationCannotBeDowngradedByLateRouteError, true);
assert.equal(patch.zeroCompletedBatchCannotCommit, true);
assert.equal(patch.newOddsApiCalls, 0);
console.log(JSON.stringify({ success: true, patch: patch.id, registryVersion: '29', serverScopeRecovery: true, terminalObservabilityGuard: true, allocatorV2: true }, null, 2));
