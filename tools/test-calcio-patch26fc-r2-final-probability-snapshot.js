'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const contract = require('../backend/calcioFinalMarketDiagnosticContract');

let checks = 0;
function check(name, fn) {
  fn(); checks += 1; return { name, ok: true };
}
const results = [];
const root = path.resolve(__dirname, '..');

const persistedComponents = {
  probability: {
    probability: 62.06,
    model: 62.46,
    modelCenterPct: 62.46,
    monteCarlo: 63.67,
    marketProbability: 58.025,
    marketGapPp: 4.44,
    monteCarloStdErrorPp: 0.494,
    reliability: 'MEDIUM'
  }
};

const fallbackSnapshot = contract.buildFinalMarketSnapshot({
  candidate: {
    prediction: 'U2.5',
    odd: 1.7,
    estimatedProb: 62.06,
    event_key: 'fixture-genoa-napoli',
    calcio_prediction_index_components: JSON.stringify(persistedComponents)
  },
  probabilityIntegrity: {},
  predictionReliability: { score: 67.9, label: 'MEDIA' },
  dataQuality: { status: 'DATA_QUALITY_LIMITED', label: 'ATTENDIBILE CON LIMITI', score: 79.8 },
  decision: { dataClass: 'ATTENDIBILE', components: {} },
  finalOperationalStake: 0,
  eligible: false,
  allowBet: false,
  finalizationStatus: 'BEST_MARKET_FULLY_CERTIFIED',
  finalizationCertified: true
});

results.push(check('production probability is unchanged', () => assert.strictEqual(fallbackSnapshot.probabilityPct, 62.06)));
results.push(check('model probability falls back from persisted IPM', () => assert.strictEqual(fallbackSnapshot.probability.modelProbabilityPct, 62.46)));
results.push(check('Monte Carlo probability falls back from persisted IPM', () => assert.strictEqual(fallbackSnapshot.probability.monteCarloProbabilityPct, 63.67)));
results.push(check('market probability falls back from persisted IPM', () => assert.strictEqual(fallbackSnapshot.probability.marketProbabilityPct, 58.025)));
results.push(check('disagreement falls back from persisted IPM', () => assert.strictEqual(fallbackSnapshot.probability.disagreementPp, 4.44)));
results.push(check('Monte Carlo sampling error falls back from persisted IPM', () => assert.strictEqual(fallbackSnapshot.probability.monteCarloSamplingErrorPp, 0.494)));
results.push(check('snapshot remains coherent', () => assert.strictEqual(fallbackSnapshot.coherence.certified, true)));

const directSnapshot = contract.buildFinalMarketSnapshot({
  candidate: { prediction: 'O2.5', odd: 1.97, estimatedProb: 54.72, event_key: 'fixture-torino-milan', calcio_prediction_index_components: JSON.stringify(persistedComponents) },
  probabilityIntegrity: { diagnostics: { 'O2.5': { modelProbabilityPct: 56.06, monteCarloProbabilityPct: 55.74, marketProbabilityPct: 50, disagreementPp: 6.06, monteCarloStdErrorPp: 0.48 } } },
  decision: { dataClass: 'ATTENDIBILE' },
  finalOperationalStake: 0,
  eligible: false,
  allowBet: false,
  finalizationStatus: 'BEST_MARKET_FULLY_CERTIFIED',
  finalizationCertified: true
});
results.push(check('direct probability-integrity diagnostics retain priority', () => assert.deepStrictEqual(
  [directSnapshot.probability.modelProbabilityPct, directSnapshot.probability.monteCarloProbabilityPct, directSnapshot.probability.marketProbabilityPct],
  [56.06, 55.74, 50]
)));

const decisionSnapshot = contract.buildFinalMarketSnapshot({
  candidate: { prediction: 'U2.5', odd: 2, estimatedProb: 52.5, event_key: 'fixture-roma-fiorentina' },
  probabilityIntegrity: {},
  decision: { dataClass: 'BUONA', components: { probability: { model: 53.35, monteCarlo: 54.53, marketProbability: 56.936, marketGapPp: 3.586, monteCarloStdErrorPp: 0.49 } } },
  finalOperationalStake: 0,
  eligible: false,
  allowBet: false,
  finalizationStatus: 'BEST_MARKET_FULLY_CERTIFIED',
  finalizationCertified: true
});
results.push(check('final decision components are accepted as fallback', () => assert.strictEqual(decisionSnapshot.probability.modelProbabilityPct, 53.35)));

const absentSnapshot = contract.buildFinalMarketSnapshot({
  candidate: { prediction: '1', odd: 2.2, estimatedProb: 47, event_key: 'fixture-no-evidence' },
  probabilityIntegrity: {},
  decision: { dataClass: 'ATTENDIBILE' },
  finalOperationalStake: 0,
  eligible: false,
  allowBet: false,
  finalizationStatus: 'BEST_MARKET_FULLY_CERTIFIED',
  finalizationCertified: true
});
results.push(check('missing diagnostics are not invented', () => assert.strictEqual(absentSnapshot.probability.modelProbabilityPct, null)));

const server = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const backendFrontend = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'), 'utf8');
results.push(check('server passes final IPM probability fallback', () => {
  assert(server.includes('const finalProbabilityComponents = stakeReconciliationDecision?.components?.probability'));
  assert(server.includes('probabilityFallback: {'));
}));
results.push(check('frontend enriches legacy null snapshots read-only', () => {
  assert(frontend.includes('function enrichCalcioFinalMarketDiagnosticProbability'));
  assert(frontend.includes('IPM_COMPONENTS_READ_ONLY_NO_PRODUCTION_MUTATION'));
}));
results.push(check('frontend copies remain byte-identical', () => assert.strictEqual(frontend, backendFrontend)));
results.push(check('production stake authorities remain untouched by R2', () => {
  assert(server.includes('calcioUnifiedStakeAuthority.evaluateStakeAuthority'));
  assert(!server.includes('PATCH26F_C_R2_STAKE_AUTHORITY'));
}));

console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_26F_C_R2_FINAL_PROBABILITY_SNAPSHOT_FALLBACK',
  checks,
  fixture: {
    finalProbabilityPct: fallbackSnapshot.probabilityPct,
    modelProbabilityPct: fallbackSnapshot.probability.modelProbabilityPct,
    monteCarloProbabilityPct: fallbackSnapshot.probability.monteCarloProbabilityPct,
    marketProbabilityPct: fallbackSnapshot.probability.marketProbabilityPct,
    disagreementPp: fallbackSnapshot.probability.disagreementPp,
    monteCarloSamplingErrorPp: fallbackSnapshot.probability.monteCarloSamplingErrorPp
  },
  results
}, null, 2));
