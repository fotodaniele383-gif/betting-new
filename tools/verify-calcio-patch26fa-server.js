'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const allocator = fs.readFileSync(path.join(root, 'backend', 'calcioBatchPortfolioAllocator.js'), 'utf8');
const contract = fs.readFileSync(path.join(root, 'backend', 'calcioFinalMarketDiagnosticContract.js'), 'utf8');
assert(server.includes("require('./calcioFinalMarketDiagnosticContract')"));
assert(server.includes('buildFinalMarketSnapshot'));
assert(server.includes('assertSnapshotCoherence'));
assert(server.includes("app.get('/api/calcio/diagnostics/final-market-contract'"));
assert(server.includes('calcio_final_market_snapshot'));
assert(allocator.includes('BETTING_PATCH_26F_A_BATCH_PORTFOLIO_ALLOCATOR_V6'));
assert(allocator.includes('refreshAfterAllocation'));
assert(allocator.includes('calcio_final_market_contract_audit_log'));
assert(allocator.includes('analysisStageFromDecisionState'));
assert(contract.includes('BETTING_PATCH_26F_A_FINAL_MARKET_DIAGNOSTIC_CONTRACT_V1'));
assert(contract.includes('BETTING_PATCH_26F_A_DECISION_STATE_MACHINE_V1'));
for (const state of ['FORECAST_VALID','VALUE_CANDIDATE','EARLY_RECHECK','BET_READY','NO_BET_VALUE','NO_BET_DATA','FAILED_ANALYSIS']) {
  assert(contract.includes(state), `Stato mancante: ${state}`);
}
assert(contract.includes('marketId'));
assert(contract.includes('monteCarloSamplingErrorPp'));
assert(contract.includes('forecastConfidence'));
console.log(JSON.stringify({ success: true, checks: 19 }, null, 2));
