'use strict';
const assert = require('assert');
const guard = require('../backend/calcioCrossMarketReliability');

const normalized = guard.normalize1x2(4.70, 3.87, 1.85);
assert(normalized);
assert(Math.abs(normalized.marginPct - 1.1704) < 0.01);
assert(Math.abs(normalized.homePct - 21.03) < 0.05);
assert(Math.abs(normalized.drawPct - 25.54) < 0.05);
assert(Math.abs(normalized.awayPct - 53.43) < 0.05);

const fit = guard.fitPoissonFrom1x2(4.70, 3.87, 1.85);
assert.strictEqual(fit.available, true);
assert(Math.abs(fit.lambdaHome - 0.87) <= 0.03);
assert(Math.abs(fit.lambdaAway - 1.55) <= 0.03);
assert(Math.abs(fit.probabilities.over25Pct - 43.55) <= 0.15);

const torino = guard.buildReliabilityAssessment({
    prediction: 'O2.5', odd: 1.97, odd1: 4.70, oddX: 3.87, odd2: 1.85,
    modelProbabilityPct: 54.72, marketProbabilityPct: 50,
    matchDate: '2026-08-23T20:45:00+02:00', now: new Date('2026-07-27T09:07:26Z'),
    reliabilityScore: 61.4, dataClass: 'ATTENDIBILE', xgEvidenceMode: 'GOAL_SHOT_PROXY',
    lineupStatus: 'LINEUP_NOT_CONFIRMED', currentAction: 'EDGE TECNICO'
});
assert(torino.robustProbabilityPct < torino.modelProbabilityPct);
assert(torino.robustEvPct < 0);
assert(torino.crossMarketGapPp > 10);
assert.strictEqual(torino.probabilityProductionChanged, false);
assert(['WATCHLIST LOW EDGE', 'RISCHIO MODELLO', 'ALTO RISCHIO'].includes(torino.effectiveAction));
const torinoStake = guard.applyStakeGuard({
    theoreticalStake: 8.46, prePortfolioCapStake: 8.46, operationalStake: 8.46,
    eligible: true, netExecutableOdd: 1.97, reason: 'IPM', dataClass: 'ATTENDIBILE'
}, torino, 2003.69);
assert(torinoStake.operationalStake <= 8.46);
assert.strictEqual(torinoStake.operationalStake, 0);

const mature = guard.buildReliabilityAssessment({
    prediction: 'O2.5', odd: 2.05, odd1: 2.60, oddX: 3.35, odd2: 2.85,
    modelProbabilityPct: 51.5, marketProbabilityPct: 49.2,
    matchDate: '2026-07-27T20:45:00+02:00', now: new Date('2026-07-27T09:00:00Z'),
    reliabilityScore: 86, dataClass: 'BUONA', xgEvidenceMode: 'STRONG_REAL_XG',
    lineupStatus: 'LINEUP_CONFIRMED', currentAction: 'EDGE TECNICO'
});
const matureStake = guard.applyStakeGuard({ theoreticalStake: 10, prePortfolioCapStake: 10, operationalStake: 10, eligible: true, netExecutableOdd: 2.05, reason: 'IPM' }, mature, 2000);
assert(matureStake.operationalStake <= 10);
assert(mature.stakeMultiplier <= 1);

const prior = guard.buildReliabilityAssessment({
    prediction: '1', odd: 2.4, odd1: 2.4, oddX: 3.3, odd2: 3.0,
    modelProbabilityPct: 44, marketProbabilityPct: 42,
    matchDate: '2026-07-28T20:45:00+02:00', now: new Date('2026-07-27T09:00:00Z'),
    reliabilityScore: 20, dataClass: 'PRIOR_ONLY', xgEvidenceMode: 'PRIOR_ONLY',
    lineupStatus: 'LINEUP_NOT_CONFIRMED', currentAction: 'WATCHLIST LOW EDGE'
});
assert.strictEqual(prior.stakeMultiplier, 0);

console.log(JSON.stringify({ success: true, patch: '26E-B', checks: 18, torino }, null, 2));
