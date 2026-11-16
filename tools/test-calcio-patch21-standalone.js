'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const decision = require('../backend/calcioDecisionCertification');
const index = require('../backend/calcioUnifiedPredictionIndex');
const selection = require('../backend/calcioProfessionalSelection');
const registry = require('../backend/calcioPatchRegistry');

function oddsCertification(market = '1', odd = 1.80, home = 'Alpha', away = 'Beta', eventId = 'evt-p21') {
  const h2h = ['1', 'X', '2'].includes(market);
  const marketKey = h2h ? 'h2h' : 'totals';
  const outcomeName = market === '1' ? home : market === '2' ? away : market === 'X' ? 'Draw' : market === 'O2.5' ? 'Over' : 'Under';
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
      provider: 'TEST_PROVIDER',
      providerEventId: eventId,
      bookmakerKey: 'pinnacle',
      bookmakerTitle: 'Pinnacle',
      lastUpdate: '2026-07-23T20:00:00Z',
      marketKey,
      outcomeName,
      point: marketKey === 'totals' ? 2.5 : null,
      price: odd,
      direct: true,
      derived: false
    },
    sources: [
      { bookmakerKey: 'pinnacle', price: odd },
      { bookmakerKey: 'unibet', price: Math.max(1.01, odd - 0.02) },
      { bookmakerKey: 'betfair', price: Math.max(1.01, odd - 0.03) }
    ]
  };
}

function base(overrides = {}) {
  const home = overrides.home || 'Alpha';
  const away = overrides.away || 'Beta';
  const prediction = overrides.prediction || '1';
  const odd = overrides.odd || 1.80;
  const eventId = overrides.provider_event_id || 'evt-p21';
  return {
    prediction,
    market: prediction,
    home,
    away,
    home_team: home,
    away_team: away,
    providerHome: home,
    providerAway: away,
    provider_event_id: eventId,
    event_key: `calcio-event|test|${eventId}`,
    requireIdentityCertification: true,
    odd,
    probability: 62,
    estimated_prob: 62,
    edge_pp: 6.44,
    ev_pct: 11.60,
    reliabilityScore: 82,
    bankroll: 2003.69,
    deepScanAction: 'VALUE CONFERMATO',
    historicalSample: 0,
    historicalWinRatePct: null,
    calcio_data_reliability: 'DATA_RELIABLE_PROXY',
    calcio_professional_status: 'PROFESSIONAL_WATCHLIST',
    calcio_gate_status: 'CALCIO_BLOCKED_SOFT',
    calcio_timing_status: 'EARLY_WATCHLIST',
    analysis_thresholds: { maxOdd: 2.70, requiredProbability: 35, requiredEdge: 3, crPassed: true },
    monteCarloProbabilityPct: 62.2,
    modelProbabilityPct: 61.7,
    oddsCertification: oddsCertification(prediction, odd, home, away, eventId),
    ...overrides
  };
}

const checks = [];
function check(name, fn) {
  const details = fn();
  checks.push({ name, ok: true, details: details ?? null });
}

check('Patch 17 IPM constants and weights are restored', () => {
  assert.equal(index.MIN_INDEX_FOR_STAKE, 60);
  assert.equal(index.MIN_RELIABILITY_FOR_STAKE, 55);
  assert.equal(index.BASE_FRACTIONAL_KELLY, 0.15);
  assert.deepEqual(index.WEIGHTS, { reliability: 0.30, probability: 0.20, value: 0.25, deepScan: 0.10, paperTrading: 0.10, analysis: 0.05 });
  return { minIndex: index.MIN_INDEX_FOR_STAKE, minReliability: index.MIN_RELIABILITY_FOR_STAKE, kelly: index.BASE_FRACTIONAL_KELLY, weights: index.WEIGHTS };
});

check('PT DS×Gate n=0 is neutral 50/100 and never a direct veto', () => {
  const component = index.paperTradingComponent({ historicalSample: 0 }, 1.80);
  const result = index.evaluatePrediction(base());
  assert.equal(component.score, 50);
  assert.equal(component.status, 'NO_SAMPLE_NEUTRAL');
  assert(result.operationalStake > 0, JSON.stringify(result));
  return { paperTrading: component, score: result.score, stake: result.operationalStake };
});

check('DeepScan, Gate, timing and soft Professional states are IPM inputs, not later vetoes', () => {
  const result = index.evaluatePrediction(base());
  assert(result.score >= 60, JSON.stringify(result));
  assert(result.operationalStake > 0, JSON.stringify(result));
  assert.equal(result.policy.deepScanDirectVeto, false);
  assert.equal(result.policy.qualityGateDirectVeto, false);
  assert.equal(result.policy.timingDirectVeto, false);
  assert.equal(result.cautionPolicy.operationalMultiplier, undefined);
  assert.equal(result.theoreticalStake, result.operationalStake);
  return { score: result.score, label: result.label, stake: result.operationalStake, advisory: result.decisionCertification.advisoryReasons };
});

check('Legacy edge/probability/max-odd thresholds are diagnostic only', () => {
  const result = index.evaluatePrediction(base({
    prediction: '2', market: '2', odd: 3.20, probability: 34.5, estimated_prob: 34.5,
    edge_pp: 3.25, ev_pct: 10.4, reliabilityScore: 90, deepScanAction: 'VALUE CONFERMATO',
    monteCarloProbabilityPct: 35.1, modelProbabilityPct: 34.9,
    oddsCertification: oddsCertification('2', 3.20, 'Alpha', 'Beta')
  }));
  assert.equal(result.decisionCertification.guard.thresholdsDiagnosticOnly, true);
  assert(result.decisionCertification.guard.thresholdDiagnostics.length >= 2);
  assert(result.score >= 60, JSON.stringify(result));
  assert(result.operationalStake > 0, JSON.stringify(result));
  return { score: result.score, stake: result.operationalStake, diagnostics: result.decisionCertification.guard.thresholdDiagnostics };
});

check('Patch 18 certified multi-source odds and Patch 19 identity/market remain hard guards', () => {
  const badMarket = index.evaluatePrediction(base({
    prediction: 'U2.5', market: 'U2.5', odd: 1.80,
    oddsCertification: oddsCertification('1', 1.80, 'Alpha', 'Beta')
  }));
  const badIdentity = index.evaluatePrediction(base({
    home: 'Torino', home_team: 'Torino', providerHome: 'Frosinone', providerAway: 'Juventus', away: 'Juventus', away_team: 'Juventus',
    prediction: '1', odd: 2.2, oddsCertification: oddsCertification('1', 2.2, 'Frosinone', 'Juventus')
  }));
  assert.equal(badMarket.operationalStake, 0);
  assert.equal(badIdentity.operationalStake, 0);
  assert(badMarket.safetyReasons.length > 0);
  assert(badIdentity.safetyReasons.length > 0);
  return { marketReasons: badMarket.safetyReasons, identityReasons: badIdentity.safetyReasons };
});

check('Single-source and derived prices cannot authorize IPM value or stake', () => {
  const single = oddsCertification('1', 1.90);
  single.status = 'CERTIFIED_SINGLE_SOURCE_ANALYSIS_ONLY'; single.sourceCount = 1; single.operationalEligible = false;
  const derived = oddsCertification('1', 1.90);
  derived.selectedSource.derived = true; derived.selectedSource.direct = false; derived.realDirect = false;
  const a = index.evaluatePrediction(base({ odd: 1.90, oddsCertification: single }));
  const b = index.evaluatePrediction(base({ odd: 1.90, oddsCertification: derived }));
  assert.equal(a.operationalStake, 0);
  assert.equal(b.operationalStake, 0);
  assert.equal(a.components.value.score, 0);
  assert.equal(b.components.value.score, 0);
  return { single: a.safetyReasons, derived: b.safetyReasons };
});

check('Genoa-Napoli-like row returns Patch 17 MICRO stake instead of €0', () => {
  const result = index.evaluatePrediction(base({
    home: 'Genoa', away: 'Napoli', home_team: 'Genoa', away_team: 'Napoli', providerHome: 'Genoa', providerAway: 'Napoli',
    prediction: 'U2.5', market: 'U2.5', odd: 1.70, probability: 61.94, estimated_prob: 61.94,
    edge_pp: 2.34, ev_pct: 3.97, reliabilityScore: 68, deepScanAction: 'WATCHLIST LOW EDGE',
    monteCarloProbabilityPct: 63.7, modelProbabilityPct: 62.5,
    oddsCertification: oddsCertification('U2.5', 1.70, 'Genoa', 'Napoli')
  }));
  assert(result.score >= 60 && result.score < 70, JSON.stringify(result));
  assert(result.operationalStake >= 7 && result.operationalStake <= 9, JSON.stringify(result));
  return { score: result.score, label: result.label, theoreticalStake: result.theoreticalStake, operationalStake: result.operationalStake };
});

check('Torino-Milan-like row returns positive MICRO stake', () => {
  const result = index.evaluatePrediction(base({
    home: 'Torino', away: 'AC Milan', home_team: 'Torino', away_team: 'AC Milan', providerHome: 'Torino', providerAway: 'AC Milan',
    prediction: 'O2.5', market: 'O2.5', odd: 1.97, probability: 54.72, estimated_prob: 54.72,
    edge_pp: 2.97, ev_pct: 5.85, reliabilityScore: 69, deepScanAction: 'WATCHLIST LOW EDGE',
    monteCarloProbabilityPct: 55.7, modelProbabilityPct: 56.1,
    oddsCertification: oddsCertification('O2.5', 1.97, 'Torino', 'AC Milan')
  }));
  assert(result.score >= 60 && result.score < 70, JSON.stringify(result));
  assert(result.operationalStake >= 8 && result.operationalStake <= 9, JSON.stringify(result));
  return { score: result.score, label: result.label, stake: result.operationalStake };
});

check('Weak-value Parma-Cagliari-like row correctly remains €0', () => {
  const result = index.evaluatePrediction(base({
    home: 'Parma', away: 'Cagliari', home_team: 'Parma', away_team: 'Cagliari', providerHome: 'Parma', providerAway: 'Cagliari',
    prediction: 'U2.5', market: 'U2.5', odd: 1.66, probability: 60.58, estimated_prob: 60.58,
    edge_pp: 0.25, ev_pct: 0.42, reliabilityScore: 75, deepScanAction: 'WATCHLIST LOW EDGE',
    monteCarloProbabilityPct: 61.7, modelProbabilityPct: 60.3,
    oddsCertification: oddsCertification('U2.5', 1.66, 'Parma', 'Cagliari')
  }));
  assert(result.score < 60);
  assert.equal(result.operationalStake, 0);
  return { score: result.score, label: result.label, stake: result.operationalStake };
});

check('Negative EV/model-risk Bologna-Lazio-like row correctly remains €0', () => {
  const result = index.evaluatePrediction(base({
    home: 'Bologna', away: 'Lazio', home_team: 'Bologna', away_team: 'Lazio', providerHome: 'Bologna', providerAway: 'Lazio',
    prediction: 'U2.5', market: 'U2.5', odd: 1.75, probability: 55.15, estimated_prob: 55.15,
    edge_pp: -1.49, ev_pct: -2.61, reliabilityScore: 79, deepScanAction: 'RISCHIO MODELLO',
    monteCarloProbabilityPct: 55.5, modelProbabilityPct: 54.4,
    oddsCertification: oddsCertification('U2.5', 1.75, 'Bologna', 'Lazio')
  }));
  assert.equal(result.operationalStake, 0);
  assert(result.score < 60);
  return { score: result.score, label: result.label, stake: result.operationalStake };
});

check('Market selection evaluates 1X2 and Totals together and can select 1X2', () => {
  const candidates = [
    base({ prediction: '1', odd: 2.20, probability: 51, estimated_prob: 51, edge_pp: 5.55, ev_pct: 12.2, reliabilityScore: 82, monteCarloProbabilityPct: 52, modelProbabilityPct: 51.5, oddsCertification: oddsCertification('1', 2.20) }),
    base({ prediction: 'X', odd: 3.20, probability: 30, estimated_prob: 30, edge_pp: -1.25, ev_pct: -4, reliabilityScore: 82, monteCarloProbabilityPct: 30.2, modelProbabilityPct: 29.8, oddsCertification: oddsCertification('X', 3.20) }),
    base({ prediction: '2', odd: 3.40, probability: 27, estimated_prob: 27, edge_pp: -2.41, ev_pct: -8.2, reliabilityScore: 82, monteCarloProbabilityPct: 27.5, modelProbabilityPct: 27.1, oddsCertification: oddsCertification('2', 3.40) }),
    base({ prediction: 'O2.5', odd: 1.90, probability: 54, estimated_prob: 54, edge_pp: 1.37, ev_pct: 2.6, reliabilityScore: 82, monteCarloProbabilityPct: 54.5, modelProbabilityPct: 54.1, oddsCertification: oddsCertification('O2.5', 1.90) }),
    base({ prediction: 'U2.5', odd: 1.90, probability: 46, estimated_prob: 46, edge_pp: -6.63, ev_pct: -12.6, reliabilityScore: 82, monteCarloProbabilityPct: 45.5, modelProbabilityPct: 45.9, oddsCertification: oddsCertification('U2.5', 1.90) })
  ];
  const selected = selection.selectPrimary(candidates);
  assert.equal(selected.audit.candidateCount, 5);
  assert.equal(selected.audit.families['1X2'], 3);
  assert.equal(selected.audit.families.TOTALS, 2);
  assert.equal(selected.selected.prediction, '1', JSON.stringify(selected.audit));
  return selected.audit;
});

check('Market selection can also select a Total when its IPM is genuinely higher', () => {
  const candidates = [
    base({ prediction: '1', odd: 2.40, probability: 42, estimated_prob: 42, edge_pp: 0.33, ev_pct: 0.8, oddsCertification: oddsCertification('1', 2.40) }),
    base({ prediction: 'O2.5', odd: 1.90, probability: 59, estimated_prob: 59, edge_pp: 6.37, ev_pct: 12.1, oddsCertification: oddsCertification('O2.5', 1.90) })
  ];
  const selected = selection.selectPrimary(candidates);
  assert.equal(selected.selected.prediction, 'O2.5');
  return selected.audit;
});

check('Registry and server expose Patch 21 single IPM authority', () => {
  const patch = registry.PATCHES.find(row => row.version === '21');
  assert(patch);
  assert.equal(registry.CALCIO_CURRENT_PATCH_VERSION, '21');
  assert.equal(patch.unifiedPredictionIndexOnlyStakeAuthority, true);
  assert.equal(patch.edgeAndEvPredictionIndexWeight, 0.25);
  assert.equal(patch.marketSelectionRule, 'HIGHEST_CERTIFIED_UNIFIED_IPM');
  const server = fs.readFileSync(path.resolve(__dirname, '../backend/server.js'), 'utf8');
  assert(server.includes('UNIFIED_PREDICTION_INDEX_ONLY'));
  assert(server.includes('Patch 21: 1/X/2/O2.5/U2.5 competono nello stesso ranking IPM'));
  assert(!server.includes("deepScanKellyPct = 0"));
  return patch;
});

console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_21_UNIFIED_IPM_STAKE_MARKET_SELECTION_RESTORE',
  version: index.CALCIO_UNIFIED_PREDICTION_INDEX_VERSION,
  checks
}, null, 2));
