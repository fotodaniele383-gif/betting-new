'use strict';

const assert = require('assert');
const provenance = require('../backend/calcioCertifiedOddsProvenance');
const consensus = require('../backend/calcioMarketConsensus');
const index = require('../backend/calcioUnifiedPredictionIndex');
const registry = require('../backend/calcioPatchRegistry');

const NOW = '2026-07-23T14:00:00.000Z';

function bookmaker(key, title, lastUpdate, prices = {}, options = {}) {
  const markets = [];
  if (prices['1'] || prices.X || prices['2']) {
    markets.push({ key: 'h2h', outcomes: [
      ...(prices['1'] ? [{ name: 'Alpha FC', price: prices['1'] }] : []),
      ...(prices.X ? [{ name: 'Draw', price: prices.X }] : []),
      ...(prices['2'] ? [{ name: 'Beta FC', price: prices['2'] }] : [])
    ] });
  }
  if (prices['O2.5'] || prices['U2.5']) {
    markets.push({ key: 'totals', outcomes: [
      ...(prices['O2.5'] ? [{ name: 'Over', point: 2.5, price: prices['O2.5'] }] : []),
      ...(prices['U2.5'] ? [{ name: 'Under', point: 2.5, price: prices['U2.5'] }] : [])
    ] });
  }
  if (options.doubleChance) {
    markets.push({ key: 'double_chance', outcomes: Object.entries(options.doubleChance).map(([name, price]) => ({ name, price })) });
  }
  return { key, title, last_update: lastUpdate, markets };
}

function event(bookmakers) {
  return { id: 'evt-p18-001', home_team: 'Alpha FC', away_team: 'Beta FC', commence_time: '2026-07-24T18:00:00.000Z', bookmakers };
}

function check(name, fn) {
  const details = fn();
  return { name, ok: true, details: details ?? null };
}

const multiEvent = event([
  bookmaker('pinnacle', 'Pinnacle', '2026-07-23T13:50:00.000Z', { '1': 2.10, X: 3.30, '2': 3.60, 'O2.5': 1.95, 'U2.5': 1.91 }),
  bookmaker('unibet', 'Unibet', '2026-07-23T13:55:00.000Z', { '1': 2.14, X: 3.25, '2': 3.55, 'O2.5': 1.98, 'U2.5': 1.89 })
]);

const checks = [];
checks.push(check('Multi-source direct odds are certified and best price keeps its real bookmaker', () => {
  const result = provenance.buildCertifiedOddsProvenance(multiEvent, { now: NOW });
  assert.strictEqual(result.markets['1'].status, 'CERTIFIED_MULTI_SOURCE');
  assert.strictEqual(result.markets['1'].operationalEligible, true);
  assert.strictEqual(result.markets['1'].selectedPrice, 2.14);
  assert.strictEqual(result.markets['1'].selectedSource.bookmakerKey, 'unibet');
  assert.strictEqual(result.markets['1'].sourceCount, 2);
  assert.strictEqual(result.summary.derivedExecutionMarkets, 0);
  return result.markets['1'];
}));

checks.push(check('Derived double chance is never exposed as Patch 18 analysis or operational odd', () => {
  const result = consensus.buildCalcioMarketConsensus(multiEvent, { certification: { now: NOW } });
  assert(result.executionOdds['1X'] > 1, 'Legacy Patch 2 diagnostic remains available');
  assert.strictEqual(result.analysisOdds['1X'], undefined);
  assert.strictEqual(result.operationalOdds['1X'], undefined);
  assert.strictEqual(result.summary.derivedOperationalMarkets, 0);
  assert(result.warnings.includes('DERIVED_EXECUTION_ODDS_DISABLED_BY_PATCH18'));
  return { legacyDiagnostic: result.executionOdds['1X'], analysisMarkets: Object.keys(result.analysisOdds), operationalMarkets: Object.keys(result.operationalOdds) };
}));

checks.push(check('Real direct double chance can be certified only when bookmakers actually publish it', () => {
  const dcEvent = event([
    bookmaker('pinnacle', 'Pinnacle', '2026-07-23T13:50:00.000Z', { '1': 2.10, X: 3.30, '2': 3.60 }, { doubleChance: { '1X': 1.31, 'X2': 1.73, '12': 1.34 } }),
    bookmaker('betfair', 'Betfair', '2026-07-23T13:52:00.000Z', { '1': 2.08, X: 3.35, '2': 3.58 }, { doubleChance: { '1X': 1.32, 'X2': 1.71, '12': 1.35 } })
  ]);
  const result = provenance.buildCertifiedOddsProvenance(dcEvent, { now: NOW });
  assert.strictEqual(result.analysisOdds['1X'], 1.32);
  assert.strictEqual(result.operationalOdds['1X'], 1.32);
  assert.strictEqual(result.markets['1X'].selectedSource.bookmakerKey, 'betfair');
  assert.strictEqual(result.markets['1X'].selectedSource.derived, false);
  return result.markets['1X'];
}));

checks.push(check('Single-source direct quote remains visible but cannot authorize edge EV Kelly or stake', () => {
  const singleEvent = event([
    bookmaker('pinnacle', 'Pinnacle', '2026-07-23T13:50:00.000Z', { '1': 2.10, X: 3.30, '2': 3.60, 'U2.5': 2.20 })
  ]);
  const cert = provenance.buildCertifiedOddsProvenance(singleEvent, { now: NOW }).markets['U2.5'];
  assert.strictEqual(cert.certified, true);
  assert.strictEqual(cert.operationalEligible, false);
  const evaluated = index.evaluatePrediction({
    bankroll_snapshot: 2000,
    prediction: 'U2.5', odd: 2.20, estimated_prob: 60, edge_pp: 14.55, ev_pct: 32,
    calcio_prediction_reliability_score: 88, ds_action: 'VALUE CONFERMATO / MICRO', oddsCertification: cert
  });
  assert.strictEqual(evaluated.operationalStake, 0);
  assert.strictEqual(evaluated.fullKellyPct, 0);
  assert.strictEqual(evaluated.components.value.status, 'SUPPRESSED_UNCERTIFIED_ODDS');
  assert(evaluated.safetyReasons.some(reason => reason.includes('multi-fonte')));
  return { certification: cert.status, stake: evaluated.operationalStake, value: evaluated.components.value, safetyReasons: evaluated.safetyReasons };
}));

checks.push(check('Certified multi-source quote can enter index, EV and Kelly', () => {
  const cert = provenance.buildCertifiedOddsProvenance(multiEvent, { now: NOW }).markets['1'];
  const evaluated = index.evaluatePrediction({
    bankroll_snapshot: 2000,
    prediction: '1', odd: cert.selectedPrice, estimated_prob: 58, edge_pp: 11.27, ev_pct: 24.12,
    calcio_prediction_reliability_score: 84, ds_action: 'VALUE CONFERMATO / MICRO',
    oddsCertification: cert,
    probabilityIntegrity: { diagnostics: { '1': { modelProbabilityPct: 58, monteCarloProbabilityPct: 57, marketProbabilityPct: 46.7 } } }
  });
  assert(evaluated.score >= 60, JSON.stringify(evaluated));
  assert(evaluated.operationalStake >= 2, JSON.stringify(evaluated));
  assert(evaluated.fullKellyPct > 0);
  assert.strictEqual(evaluated.components.value.status, 'CERTIFIED_ODDS_VALUE');
  assert.strictEqual(evaluated.policy.minimumIndependentOddsSources, 2);
  return { score: evaluated.score, stake: evaluated.operationalStake, fullKellyPct: evaluated.fullKellyPct, bookmaker: cert.selectedSource.bookmakerTitle };
}));

checks.push(check('Explicitly derived quote is rejected even when numeric value looks profitable', () => {
  const fake = {
    version: provenance.CALCIO_CERTIFIED_ODDS_PROVENANCE_VERSION,
    status: 'DERIVED_REFERENCE_ONLY', certified: false, realDirect: false, operationalEligible: false, sourceCount: 2,
    selectedSource: { bookmakerKey: 'synthetic', bookmakerTitle: 'Synthetic', lastUpdate: NOW, price: 1.45, direct: false, derived: true }
  };
  const evaluated = index.evaluatePrediction({
    bankroll_snapshot: 2000, prediction: '1X', odd: 1.45, estimated_prob: 80, edge_pp: 11.03, ev_pct: 16,
    calcio_prediction_reliability_score: 95, ds_action: 'VIA LIBERA / VALUE', oddsCertification: fake
  });
  assert.strictEqual(evaluated.operationalStake, 0);
  assert.strictEqual(evaluated.fullKellyPct, 0);
  assert(evaluated.safetyReasons.some(reason => reason.includes('derivata')));
  return { stake: evaluated.operationalStake, reasons: evaluated.safetyReasons };
}));

checks.push(check('Missing U2.5 does not synthesize it and leaves other real markets available', () => {
  const missing = event([
    bookmaker('pinnacle', 'Pinnacle', '2026-07-23T13:50:00.000Z', { '1': 2.10, X: 3.30, '2': 3.60, 'O2.5': 1.95 }),
    bookmaker('unibet', 'Unibet', '2026-07-23T13:55:00.000Z', { '1': 2.14, X: 3.25, '2': 3.55, 'O2.5': 1.98 })
  ]);
  const result = provenance.buildCertifiedOddsProvenance(missing, { now: NOW });
  assert.strictEqual(result.analysisOdds['U2.5'], undefined);
  assert.deepStrictEqual(result.operationalMarkets.sort(), ['1', '2', 'O2.5', 'X'].sort());
  assert(result.alternatives.some(row => row.market === 'O2.5'));
  return { missing: 'U2.5', alternatives: result.alternatives };
}));

checks.push(check('Registry advances to Patch 18 with zero new Odds API calls', () => {
  const patch = registry.PATCHES.find(row => row.version === '18');
  assert(patch);
  assert.strictEqual(registry.CALCIO_CURRENT_PATCH_VERSION, '18');
  assert.strictEqual(patch.id, 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE');
  assert.strictEqual(patch.minimumIndependentOddsSources, 2);
  assert.strictEqual(patch.derivedOddsOperationalAuthority, false);
  assert.strictEqual(patch.newOddsApiCalls, 0);
  return patch;
}));

console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE',
  version: provenance.CALCIO_CERTIFIED_ODDS_PROVENANCE_VERSION,
  checks
}, null, 2));
