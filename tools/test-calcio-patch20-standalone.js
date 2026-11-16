'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const decision = require('../backend/calcioDecisionCertification');
const index = require('../backend/calcioUnifiedPredictionIndex');
const registry = require('../backend/calcioPatchRegistry');

function oddsCertification(market = '1', odd = 1.80, marketKey = 'h2h', outcomeName = 'Alpha') {
  return {
    market,
    status: 'CERTIFIED_MULTI_SOURCE',
    certified: true,
    operationalEligible: true,
    realDirect: true,
    crossVerified: true,
    sourceCount: 3,
    selectedPrice: odd,
    selectedSource: {
      provider: 'THE_ODDS_API',
      providerEventId: 'evt-p20',
      bookmakerKey: 'pinnacle',
      bookmakerTitle: 'Pinnacle',
      lastUpdate: '2026-07-23T19:40:00Z',
      marketKey,
      outcomeName,
      point: marketKey === 'totals' ? 2.5 : null,
      price: odd,
      direct: true,
      derived: false
    },
    sources: [
      { bookmakerKey: 'pinnacle', price: odd },
      { bookmakerKey: 'unibet', price: odd - 0.02 },
      { bookmakerKey: 'betfair', price: odd - 0.03 }
    ]
  };
}

function base(overrides = {}) {
  return {
    prediction: '1',
    market: '1',
    home: 'Alpha',
    away: 'Beta',
    home_team: 'Alpha',
    away_team: 'Beta',
    providerHome: 'Alpha',
    providerAway: 'Beta',
    provider_event_id: 'evt-p20',
    event_key: 'calcio-event|the odds api|league|evt-p20',
    requireIdentityCertification: true,
    odd: 1.80,
    probability: 62,
    estimated_prob: 62,
    edge_pp: 6.44,
    ev_pct: 11.60,
    reliabilityScore: 88,
    bankroll: 2000,
    deepScanAction: 'VALUE CONFERMATO',
    historicalSample: 40,
    historicalWinRatePct: 65,
    calcio_data_reliability: 'DATA_RELIABLE_DIRECT',
    calcio_professional_status: 'PROFESSIONAL_APPROVED',
    calcio_gate_status: 'CALCIO_APPROVED',
    calcio_timing_status: 'PRE_MATCH_READY',
    analysis_thresholds: { maxOdd: 2.70, requiredProbability: 35, requiredEdge: 3, crPassed: true },
    monteCarloProbabilityPct: 62.2,
    modelProbabilityPct: 61.7,
    oddsCertification: oddsCertification(),
    ...overrides
  };
}

const checks = [];
function check(name, fn) {
  const details = fn();
  checks.push({ name, ok: true, details: details ?? null });
}

check('Patch 19 exact identity protection remains active', () => {
  const result = decision.resolveHistoricalKey('Frosinone', ['Torino', 'Genoa', 'Inter']);
  assert.equal(result.matched, false);
  assert.equal(result.fuzzyUsed, false);
  return result;
});

check('Market and bookmaker outcome mismatch remains a hard zero-stake veto', () => {
  const result = index.evaluatePrediction(base({
    prediction: 'U2.5',
    market: 'U2.5',
    odd: 1.80,
    oddsCertification: oddsCertification('1', 1.80, 'h2h', 'Alpha')
  }));
  assert.equal(result.operationalStake, 0);
  assert(result.safetyReasons.some(reason => reason.includes('diverso dalla quota certificata') || reason.includes('famiglia')));
  return { stake: result.operationalStake, reasons: result.safetyReasons };
});

check('Configured probability and maximum odd remain hard authorities', () => {
  const result = index.evaluatePrediction(base({
    prediction: 'X',
    market: 'X',
    odd: 4.20,
    probability: 30,
    estimated_prob: 30,
    edge_pp: 6.19,
    ev_pct: 26,
    oddsCertification: oddsCertification('X', 4.20, 'h2h', 'Draw')
  }));
  assert.equal(result.operationalStake, 0);
  assert(result.safetyReasons.some(reason => reason.includes('probabilità')));
  assert(result.safetyReasons.some(reason => reason.includes('quota')));
  return { stake: result.operationalStake, reasons: result.safetyReasons };
});

check('Clean certified decision receives the restored 15% fractional-Kelly stake', () => {
  const result = index.evaluatePrediction(base());
  assert.equal(result.policy.baseFractionalKelly, 0.15);
  assert.equal(result.cautionPolicy.active, false);
  assert(result.theoreticalStake >= 2);
  assert.equal(result.operationalStake, result.theoreticalStake);
  assert.equal(result.decisionCertification.status, 'DECISION_CERTIFIED_OPERATIONAL');
  return {
    score: result.score,
    fullKellyPct: result.fullKellyPct,
    fractionalKellyPct: result.fractionalKellyPct,
    theoreticalStake: result.theoreticalStake,
    operationalStake: result.operationalStake
  };
});

check('Professional SOFT is a cap, not a veto', () => {
  const result = index.evaluatePrediction(base({ calcio_professional_status: 'PROFESSIONAL_BLOCK_SOFT' }));
  assert(result.theoreticalStake > 0);
  assert(result.operationalStake >= 2 && result.operationalStake <= 3);
  assert.equal(result.cautionPolicy.mode, 'PRUDENTIAL_MICRO_25_CAP_3');
  assert.equal(result.decisionCertification.status, 'DECISION_CERTIFIED_CAPPED');
  return { theoreticalStake: result.theoreticalStake, operationalStake: result.operationalStake, caution: result.cautionPolicy };
});

check('Qualità BLOCCATA SOFT is a cap, not a veto', () => {
  const result = index.evaluatePrediction(base({ calcio_gate_status: 'CALCIO_BLOCKED_SOFT', calcio_quality_final_label: 'BLOCCATA SOFT' }));
  assert(result.operationalStake >= 2 && result.operationalStake <= 3);
  assert(result.cautionPolicy.reasons.some(reason => reason.includes('SOFT')));
  return { theoreticalStake: result.theoreticalStake, operationalStake: result.operationalStake, caution: result.cautionPolicy };
});

check('Early timing restores the historical €2-€3 micro-stake process', () => {
  const result = index.evaluatePrediction(base({ calcio_timing_status: 'EARLY_WATCHLIST' }));
  assert(result.operationalStake >= 2 && result.operationalStake <= 3);
  assert.equal(result.cautionPolicy.mode, 'PRUDENTIAL_MICRO_25_CAP_3');
  return { theoreticalStake: result.theoreticalStake, operationalStake: result.operationalStake, caution: result.cautionPolicy };
});

check('Proxy/watchlist without exact PT sample is reduced, not automatically zero', () => {
  const result = index.evaluatePrediction(base({
    historicalSample: 0,
    historicalWinRatePct: null,
    calcio_data_reliability: 'DATA_RELIABLE_PROXY',
    calcio_professional_status: 'PROFESSIONAL_WATCHLIST'
  }));
  assert(result.score >= index.MIN_INDEX_FOR_STAKE, JSON.stringify(result));
  assert(result.operationalStake >= 2 && result.operationalStake <= 5);
  assert(result.cautionPolicy.active);
  assert(result.cautionPolicy.reasons.some(reason => reason.includes('campione')));
  return { score: result.score, theoreticalStake: result.theoreticalStake, operationalStake: result.operationalStake, caution: result.cautionPolicy };
});

check('Professional HARD remains a zero-stake veto', () => {
  const result = index.evaluatePrediction(base({ calcio_professional_status: 'PROFESSIONAL_BLOCK_HARD' }));
  assert.equal(result.operationalStake, 0);
  assert(result.safetyReasons.some(reason => reason.includes('HARD')));
  return { stake: result.operationalStake, reasons: result.safetyReasons };
});

check('Model risk and wait-in-play remain zero-stake vetoes', () => {
  const modelRisk = index.evaluatePrediction(base({ deepScanAction: 'RISCHIO MODELLO' }));
  const wait = index.evaluatePrediction(base({ deepScanAction: 'ATTENDI LIVE' }));
  assert.equal(modelRisk.operationalStake, 0);
  assert.equal(wait.operationalStake, 0);
  return { modelRisk: modelRisk.safetyReasons, wait: wait.safetyReasons };
});

check('Value still does not inflate prediction reliability', () => {
  const a = index.evaluatePrediction(base({ edge_pp: 3.2, ev_pct: 4.5 }));
  const b = index.evaluatePrediction(base({ edge_pp: 20, ev_pct: 60 }));
  assert.equal(a.score, b.score);
  assert.notEqual(a.valueScore, b.valueScore);
  return { scoreA: a.score, scoreB: b.score, valueA: a.valueScore, valueB: b.valueScore };
});

check('Registry and server expose Patch 20 stake authority', () => {
  const patch = registry.PATCHES.find(row => row.version === '20');
  assert(patch);
  assert.equal(registry.CALCIO_CURRENT_PATCH_VERSION, '20');
  assert.equal(patch.professionalSoftBlockIsCapNotVeto, true);
  assert.equal(patch.baseFractionalKelly, 0.15);
  const server = fs.readFileSync(path.resolve(__dirname, '../backend/server.js'), 'utf8');
  assert(server.includes('PATCH20_CERTIFIED_DECISION_WITH_PRUDENTIAL_CAPS'));
  assert(server.includes('BET_ALLOWED_PATCH20_PRUDENTIAL_CAP'));
  return patch;
});

console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_20_CERTIFIED_DECISION_STAKE_AUTHORITY_RESTORE',
  version: index.CALCIO_UNIFIED_PREDICTION_INDEX_VERSION,
  checks
}, null, 2));
