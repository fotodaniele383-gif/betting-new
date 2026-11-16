'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const registry = require('../backend/calcioPatchRegistry');
const markers = [
    "require('./calcioBatchPortfolioAllocator')",
    "CACHE_REPLAY_BATCH",
    "calcio_portfolio_pre_cap_eligible",
    "calcio_portfolio_pre_cap_stake",
    "UNIFIED_INDEX_AWAITING_BATCH_ALLOCATION",
    "app.post('/api/calcio/portfolio/finalize-batch'",
    "calcioBatchPortfolioAllocator.allocateBatch",
    "app.get('/api/calcio/portfolio/batch/:batchId'",
    "BATCH_ALLOCATION_PENDING",
    "EVENT_FINALIZED_PORTFOLIO_BATCH_PENDING"
];
for (const marker of markers) assert.ok(server.includes(marker), `Marker server mancante: ${marker}`);
assert.ok(!server.includes('allocateCurrentEventOnly({'), 'Patch 26C non deve applicare cap locali evento per evento');
assert.ok(!server.includes('for (const allocatedRow of portfolioAllocation.candidates)'), 'Nessun loop globale nella transazione evento');
for (const file of ['backend/server.js', 'backend/calcioBatchPortfolioAllocator.js', 'backend/calcioPatchRegistry.js']) {
    const r = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${file}: ${r.stderr}`);
}
assert.equal(registry.CALCIO_CURRENT_PATCH_VERSION, '28');
const patch = registry.PATCHES.find(item => item.version === '28');
assert.ok(patch);
assert.equal(patch.id, 'BETTING_PATCH_26C_CALCIO_BATCH_PORTFOLIO_AUTHORITATIVE_UI');
assert.equal(patch.orderIndependentAllocation, true);
assert.equal(patch.crossBatchWritesForbidden, true);
assert.equal(patch.newOddsApiCalls, 0);
console.log(JSON.stringify({
    success: true,
    patch: patch.id,
    registryVersion: registry.CALCIO_CURRENT_PATCH_VERSION,
    guards: {
        cacheReplayBatchIdentity: true,
        preCapOnlyEventPersistence: true,
        oneBatchAllocationEndpoint: true,
        noEventLocalCap: true,
        eventTransactionPreserved: true
    }
}, null, 2));
