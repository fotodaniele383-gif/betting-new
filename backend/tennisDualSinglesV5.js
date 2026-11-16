'use strict';
/**
 * TENNIS_DUAL_SINGLES_V5: deterministic read-only BO3 coverage simulator.
 * No DB access, no network, no historical data, no stake authority.
 * A = favourite moneyline; B = underdog +1.5 sets.
 * Provides simulation ONLY, regardless of calculated profit or risk.
 */
const VERSION = 'TENNIS_DUAL_SINGLES_V5_R1';
const SCENARIOS = Object.freeze([
  { score: 'FAVORITE_2_0', label: 'Favorito 2-0', aWin: true, bWin: false },
  { score: 'FAVORITE_2_1', label: 'Favorito 2-1', aWin: true, bWin: true },
  { score: 'UNDERDOG_2_0', label: 'Sfavorito 2-0', aWin: false, bWin: true },
  { score: 'UNDERDOG_2_1', label: 'Sfavorito 2-1', aWin: false, bWin: true }
]);
const fmt = n => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = n => typeof n === 'number' && Number.isFinite(n);
function validOdds(odds) { return finite(odds) && odds >= 1.01 && odds <= 1000; }
function cents(value) {
  if (!finite(value) || value < 0 || value > 100000) return null;
  const result = Math.round(value * 100);
  if (Math.abs(value * 100 - result) > 1e-6) return null;
  return result;
}
function buildResult({ budget = 10, favoriteOdds, underdogPlus15Odds, bestOf = 3, oddsEvidence = null, calibratedScoreDistribution = null } = {}) {
  const base = {
    version: VERSION,
    readOnly: true,
    paperOnly: true,
    status: 'NOT_CALCULABLE',
    decision: 'NO_BET',
    operationalStakeEur: 0,
    stakeAuthority: false,
    evCertified: false,
    expectedValueEur: null,
    expectedRoiPct: null,
    edgePp: null,
    evPct: null,
    warning: 'Simulazione non operativa: quote e probabilità NON certificano EV+. Nessuna autorizzazione allo stake.',
    missing: []
  };
  const b = cents(budget);
  if (b === null || b < 200) base.missing.push('BUDGET_EUR_MIN_2_WITH_CENT_PRECISION');
  if (bestOf !== 3) base.missing.push('ONLY_BEST_OF_3_SUPPORTED');
  if (!validOdds(favoriteOdds)) base.missing.push('FAVORITE_ML_ODDS');
  if (!validOdds(underdogPlus15Odds)) base.missing.push('UNDERDOG_PLUS_1_5_SETS_ODDS');
  if (base.missing.length) return base;

  // Realized profits in cents rounded to cents PER winning settlement.
  // Using integer cents avoids floating point allocation errors.
  const profitCents = (stakeA, stakeB, scenario) => {
    const pa = scenario.aWin ? Math.round(stakeA * (favoriteOdds - 1)) : -stakeA;
    const pb = scenario.bWin ? Math.round(stakeB * (underdogPlus15Odds - 1)) : -stakeB;
    return pa + pb;
  };
  let best = null;
  for (let stakeA = 1; stakeA < b; stakeA++) {
    const stakeB = b - stakeA;
    const profits = SCENARIOS.map(s => profitCents(stakeA, stakeB, s));
    const minimum = Math.min(...profits);
    const maximum = Math.max(...profits);
    const downsideDeviation = Math.abs(profits[0] - profits[2]);
    // Maximin priority; within same cent favor lower imbalance in single-win outcomes.
    if (!best || minimum > best.minimum ||
      (minimum === best.minimum && downsideDeviation < best.downsideDeviation) ||
      (minimum === best.minimum && downsideDeviation === best.downsideDeviation && maximum > best.maximum)) {
      best = { stakeA, stakeB, minimum, maximum, profits, downsideDeviation };
    }
  }
  const scenarios = SCENARIOS.map((s, i) => ({
    score: s.score,
    label: s.label,
    favoriteMoneyline: s.aWin ? 'WIN' : 'LOSE',
    underdogPlus15Sets: s.bWin ? 'WIN' : 'LOSE',
    netProfitEur: best.profits[i] / 100
  }));
  const maxLossEur = Math.max(0, -best.minimum / 100);
  const withinLossTarget = maxLossEur <= (b / 100) * 0.25 + 1e-10;
  // oddsEvidence is advisory provenance, never a stake override.
  const evidenceOk = oddsEvidence && oddsEvidence.favorite && oddsEvidence.underdog &&
    [oddsEvidence.favorite, oddsEvidence.underdog].every(x => x && x.bookmaker && x.sourceUrl && x.observedAt);

  // Do NOT turn model-supplied scenarios into certified EV without calibration audit.
  // Calculating an unverified expected value is intentionally out of scope.
  void calibratedScoreDistribution;
  return {
    ...base,
    status: 'SIMULATED',
    budgetEur: b / 100,
    favoriteOdds,
    underdogPlus15Odds,
    markets: [
      { market: 'MATCH_WINNER', selection: 'FAVORITE', odds: favoriteOdds, simulatedStakeEur: best.stakeA / 100 },
      { market: 'SET_HANDICAP_PLUS_1_5', selection: 'UNDERDOG', odds: underdogPlus15Odds, simulatedStakeEur: best.stakeB / 100 }
    ],
    scenarios,
    worstNetProfitEur: best.minimum / 100,
    maximumOrdinaryLossEur: maxLossEur,
    maximumOrdinaryLossPct: fmt(maxLossEur / (b / 100) * 100),
    bestNetProfitEur: best.maximum / 100,
    targetMaxLossPct: 25,
    lossTargetMet: withinLossTarget,
    priceProvenance: evidenceOk ? 'PROVIDED_UNVERIFIED' : 'MISSING_OR_INCOMPLETE',
    // Mandatory fail closed. User must not mistake a hedge simulation for value proof.
    reason: !evidenceOk ? 'QUOTE_PROVENANCE_UNVERIFIED' : 'CALIBRATED_PAIR_EV_NOT_CERTIFIED',
    roiCertified: false
  };
}
module.exports = Object.freeze({ VERSION, SCENARIOS, buildResult });
