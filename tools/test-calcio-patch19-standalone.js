'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const decision = require('../backend/calcioDecisionCertification');
const index = require('../backend/calcioUnifiedPredictionIndex');

function oddsCertification(market, odd, marketKey, outcomeName, home = 'Alpha', away = 'Beta') {
  return {
    market,
    status: 'CERTIFIED_MULTI_SOURCE', certified: true, operationalEligible: true, realDirect: true, crossVerified: true, sourceCount: 2,
    selectedPrice: odd,
    selectedSource: { provider: 'THE_ODDS_API', providerEventId: 'evt-p19', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', lastUpdate: '2026-07-23T18:00:00Z', marketKey, outcomeName, point: marketKey === 'totals' ? 2.5 : null, price: odd, direct: true, derived: false }
  };
}
function base(overrides = {}) {
  return {
    prediction: '1', market: '1', home: 'Alpha', away: 'Beta', providerHome: 'Alpha', providerAway: 'Beta',
    provider_event_id: 'evt-p19', event_key: 'calcio-event|the odds api|league|evt-p19', requireIdentityCertification: true,
    odd: 2.1, probability: 58, estimated_prob: 58, edge_pp: 10.38, ev_pct: 21.8, reliabilityScore: 82,
    bankroll: 1000, deepScanAction: 'VALUE CONFERMATO', historicalSample: 40, historicalWinRatePct: 60,
    calcio_data_reliability: 'DATA_RELIABLE_DIRECT', calcio_professional_status: 'PROFESSIONAL_APPROVED', calcio_timing_status: 'PRE_MATCH_READY',
    analysis_thresholds: { maxOdd: 2.7, requiredProbability: 35, requiredEdge: 3, crPassed: true },
    monteCarloProbabilityPct: 58.2, modelProbabilityPct: 57.6,
    oddsCertification: oddsCertification('1', 2.1, 'h2h', 'Alpha'),
    ...overrides
  };
}
const checks = [];
function check(name, fn) { fn(); checks.push({ name, ok: true }); }

check('Historical resolution never maps Frosinone to Torino', () => {
  const r = decision.resolveHistoricalKey('Frosinone', ['Torino','Genoa','Inter']);
  assert.equal(r.matched, false); assert.equal(r.historicalKey, null); assert.equal(r.fuzzyUsed, false);
});
check('Historical resolution never maps Monza or Venezia to Genoa', () => {
  assert.equal(decision.resolveHistoricalKey('Monza', ['Genoa']).matched, false);
  assert.equal(decision.resolveHistoricalKey('Venezia', ['Genoa']).matched, false);
});
check('Prediction and certified odds market must be atomic', () => {
  const result = index.evaluatePrediction(base({ prediction: 'U2.5', market: 'U2.5', oddsCertification: oddsCertification('X', 7, 'h2h', 'Draw'), odd: 7, probability: 19 }));
  assert.equal(result.operationalStake, 0);
  assert(result.safetyReasons.some(reason => reason.includes('diverso dalla quota certificata') || reason.includes('famiglia')));
});
check('Configured probability and maximum odd are hard authorities', () => {
  const lowProb = index.evaluatePrediction(base({ prediction: 'X', market: 'X', odd: 7, probability: 19, estimated_prob: 19, oddsCertification: oddsCertification('X', 7, 'h2h', 'Draw') }));
  assert.equal(lowProb.operationalStake, 0);
  assert(lowProb.safetyReasons.some(reason => reason.includes('probabilità')));
  assert(lowProb.safetyReasons.some(reason => reason.includes('quota')));
});
check('Value does not inflate reliability score', () => {
  const a = index.evaluatePrediction(base({ odd: 2.0, edge_pp: 2, ev_pct: 4, oddsCertification: oddsCertification('1', 2.0, 'h2h', 'Alpha') }));
  const b = index.evaluatePrediction(base({ odd: 2.6, edge_pp: 20, ev_pct: 60, oddsCertification: oddsCertification('1', 2.6, 'h2h', 'Alpha') }));
  assert.equal(a.score, b.score);
  assert.notEqual(a.valueScore, b.valueScore);
});
check('Professional soft block is analysis only', () => {
  const result = index.evaluatePrediction(base({ calcio_professional_status: 'PROFESSIONAL_BLOCK_SOFT' }));
  assert.equal(result.operationalStake, 0);
});
check('Proxy/watchlist without exact PT sample is analysis only', () => {
  const result = index.evaluatePrediction(base({ historicalSample: 0, historicalWinRatePct: null, calcio_data_reliability: 'DATA_RELIABLE_PROXY', calcio_professional_status: 'PROFESSIONAL_WATCHLIST' }));
  assert.equal(result.operationalStake, 0);
  assert(result.safetyReasons.some(reason => reason.includes('nessun campione PT')));
});
check('Clean identity, market, thresholds and evidence can authorize stake', () => {
  const result = index.evaluatePrediction(base());
  assert.equal(result.decisionCertification.guard.certified, true);
  assert(result.operationalStake >= 2);
  assert.equal(result.components.value.contribution, 0);
});
check('Server preserves raw provider identity and refreshes market atomically', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '../backend/server.js'), 'utf8');
  assert(server.includes('match: `${m.home_team} - ${m.away_team}`'));
  assert(server.includes('home_team: bet.home'));
  assert(server.includes('prediction: bet.prediction'));
  assert(server.includes('market_type: bet.market_type || inferCalcioMarketFamily(bet.prediction)'));
  assert(!server.includes('return minDistance <= 5 ? bestMatch : mapped'));
});

console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_19_CALCIO_DECISION_IDENTITY_RELIABILITY_CERTIFICATION', checks }, null, 2));
