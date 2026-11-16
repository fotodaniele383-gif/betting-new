'use strict';

const assert = require('assert');
const index = require('../backend/calcioUnifiedPredictionIndex');
const reconciler = require('../backend/calcioStakeReconciler');
const registry = require('../backend/calcioPatchRegistry');
const probabilityIntegrity = require('../backend/calcioProbabilityIntegrity');

function check(name, fn) {
  const details = fn();
  return { name, ok: true, details: details ?? null };
}

const base = {
  bankroll_snapshot: 2003.69,
  prediction: 'U2.5',
  odd: 2.33,
  estimated_prob: 43.16,
  edge_pp: 0.18,
  ev_pct: 0.43,
  calcio_prediction_reliability_score: 81.2,
  ds_action: 'WATCHLIST LOW EDGE',
  confidence: 76.39,
  historical_combo_resolved: 0
};

const checks = [];
checks.push(check('Inter-Genoa high reliability but negligible value remains no-stake', () => {
  const r = index.evaluatePrediction(base);
  assert(r.score >= 45 && r.score < 60, JSON.stringify(r));
  assert.strictEqual(r.operationalStake, 0);
  assert.strictEqual(r.label, 'SOLO ANALISI');
  return { score: r.score, label: r.label, stake: r.operationalStake, value: r.components.value };
}));
checks.push(check('Newcastle-Liverpool old 3pp threshold no longer blocks positive Kelly', () => {
  const r = index.evaluatePrediction({
    ...base,
    odd: 1.7293314366998578,
    estimated_prob: 61.13,
    edge_pp: 2.48,
    ev_pct: 4.29,
    calcio_prediction_reliability_score: 69.6,
    ds_action: 'VALUE QUALITATIVO NON OPERATIVO',
    calcio_analysis_stage_reason: 'edge sotto soglia 3.0 pp'
  });
  assert(r.score >= 60, JSON.stringify(r));
  assert(r.operationalStake >= 2, JSON.stringify(r));
  assert.strictEqual(r.policy.oldFixedEdgeThresholdAuthority, false);
  return { score: r.score, label: r.label, stake: r.operationalStake };
}));
checks.push(check('Paper Trading n=0 is neutral, not a veto or invented zero', () => {
  const r = index.paperTradingComponent({ historical_combo_resolved: 0 }, 2);
  assert.strictEqual(r.score, 50);
  assert.strictEqual(r.status, 'NO_SAMPLE_NEUTRAL');
  return r;
}));
checks.push(check('DeepScan changes the index but has no direct stake veto', () => {
  const strong = { ...base, odd: 2.15, estimated_prob: 61, edge_pp: 7, ev_pct: 14, calcio_prediction_reliability_score: 88 };
  const confirm = index.evaluatePrediction({ ...strong, ds_action: 'VALUE CONFERMATO / MICRO' });
  const risk = index.evaluatePrediction({ ...strong, ds_action: 'RISCHIO MODELLO' });
  assert(confirm.score > risk.score);
  assert.strictEqual(risk.policy.deepScanDirectVeto, false);
  assert(risk.operationalStake > 0, JSON.stringify(risk));
  return { confirmScore: confirm.score, modelRiskScore: risk.score, modelRiskStake: risk.operationalStake };
}));
checks.push(check('Negative Kelly remains zero regardless of reliability', () => {
  const r = index.evaluatePrediction({ ...base, odd: 1.5, estimated_prob: 60, edge_pp: -6.67, ev_pct: -10, calcio_prediction_reliability_score: 95, ds_action: 'VIA LIBERA / VALUE' });
  assert.strictEqual(r.operationalStake, 0);
  return { score: r.score, fullKellyPct: r.fullKellyPct, reason: r.reason };
}));
checks.push(check('Minimum positive stake is €2', () => {
  const r = index.evaluatePrediction({ ...base, bankroll_snapshot: 100, odd: 2.05, estimated_prob: 55, edge_pp: 6.22, ev_pct: 12.75, calcio_prediction_reliability_score: 72, ds_action: 'VALUE CONFERMATO / MICRO' });
  assert.strictEqual(r.operationalStake, 2, JSON.stringify(r));
  return { score: r.score, stake: r.operationalStake };
}));
checks.push(check('Stake reconciler ignores legacy threshold failure as authority', () => {
  const r = reconciler.reconcileStakeRow({
    ...base,
    odd: 1.7293314366998578,
    estimated_prob: 61.13,
    edge_pp: 2.48,
    ev_pct: 4.29,
    calcio_prediction_reliability_score: 69.6,
    ds_action: 'WATCHLIST LOW EDGE',
    calcio_analysis_stage_reason: 'edge sotto soglia 3.0 pp'
  });
  assert.strictEqual(r.thresholdFailure, true);
  assert.strictEqual(r.oldThresholdAuthority, false);
  assert(r.operationalStake > 0, JSON.stringify(r));
  return { score: r.score, stake: r.operationalStake, legacyThresholdDetected: r.thresholdFailure };
}));
checks.push(check('Patch 13 derived double-chance integrity remains active', () => {
  const r = probabilityIntegrity.buildCalcioProbabilityIntegrity({
    modelProbabilities: {'1':40,'X':30,'2':30,'O2.5':50,'U2.5':50,'GG':50,'NG':50},
    mcResult: {probabilities:{homeWin:42,draw:28,awayWin:30,over2_5:50,under2_5:50,btts:50,noBtts:50}},
    marketFairOdds: {'1':2.5,'X':3.333333333,'2':3.333333333},
    coverage:{mode:'HISTORY_PROXY_STRONG'},iterations:5000
  });
  assert.strictEqual(r.sources.model['1X'],70);
  assert.strictEqual(r.diagnostics['1X'].modelProbabilityPct,70);
  assert.deepStrictEqual(r.diagnostics['1X'].derivedFrom,['1','X']);
  return r.diagnostics['1X'];
}));
checks.push(check('Registry advances to Patch 17 with one stake authority', () => {
  const p = registry.PATCHES.find(x => x.version === '17');
  assert(p);
  assert.strictEqual(registry.CALCIO_CURRENT_PATCH_VERSION, '17');
  assert.strictEqual(p.deepScanDirectStakeAuthority, false);
  assert.strictEqual(p.oldFixedThresholdStakeAuthority, false);
  return p;
}));

console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_17_UNIFIED_PREDICTION_INDEX_STAKE_AUTHORITY', version: index.CALCIO_UNIFIED_PREDICTION_INDEX_VERSION, checks }, null, 2));
