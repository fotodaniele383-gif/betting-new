'use strict';

const assert = require('assert');
const dual = require('../backend/calcioDualScoreArchitecture');
const legacyIpm = require('../backend/calcioUnifiedPredictionIndex');

const checks = [];
function check(name, fn) {
    try { fn(); checks.push({ name, ok: true }); }
    catch (error) { checks.push({ name, ok: false, error: error.message }); }
}

const oddsCertification = {
    certified: true,
    operationalEligible: true,
    sourceCount: 9,
    selectedPremiumPct: 1.2,
    market: 'U2.5',
    selectedSource: { marketKey: 'totals', outcomeName: 'Under', point: 2.5, price: 1.70, bookmakerKey: '1xbet' },
    sources: [{ price: 1.70 }, { price: 1.68 }, { price: 1.72 }, { price: 1.69 }]
};
const old = legacyIpm.evaluatePrediction({
    home: 'Genoa', away: 'Napoli', providerHome: 'Genoa', providerAway: 'Napoli',
    prediction: 'U2.5', odd: 1.70, probability: 62.06, estimatedProb: 62.06,
    reliabilityScore: 68, bankroll: 350, edge_pp: 3.24, ev_pct: 5.50,
    modelProbabilityPct: 62.46, monteCarloProbabilityPct: 63.67, marketProbabilityPct: 58.03,
    monteCarloStdErrorPp: 0.48, oddsCertification,
    decisionIdentity: { certified: true, providerHome: 'Genoa', providerAway: 'Napoli' },
    historicalSample: 0, historicalEvidence: { resolved: 0 },
    deepScanAction: 'WATCHLIST LOW EDGE'
});

const baseInput = {
    marketId: 'CALCIO_MARKET_GENOA_U25', prediction: 'U2.5', odd: 1.70, netExecutableOdd: 1.70,
    productionProbabilityPct: 62.06, robustProbabilityPct: 60.77, robustEvPct: 3.31,
    modelMarketGapPp: 5.65, monteCarloStdErrorPp: 0.48,
    sourceConfidencePct: 78, oddsCertification, oddsOutlierPremiumPct: 1.2,
    dataQuality: { status: 'DATA_QUALITY_LIMITED', score: 79.8, blocking: false },
    reliabilityAssessment: { daysToKickoff: 26.16, epistemicUncertaintyScore: 60.9, crossMarketGapPp: 4.25, temporalMaturityScore: 4 },
    daysToKickoff: 26.16, epistemicUncertaintyScore: 60.9, crossMarketGapPp: 4.25,
    lineupStatus: 'LINEUP_NOT_CONFIRMED', xgEvidenceMode: 'GOAL_SHOT_PROXY',
    historicalCoverage: { status: 'HISTORY_PRIMARY_STRONG', confidence: 88, promotedTeamPrior: false },
    historicalEvidence: { resolved: 0 }, historicalSample: 0,
    oldIpmScore: old.score, oldIpmComponents: old.components,
    currentDecisionState: 'EARLY_RECHECK', marketCertified: true
};
const result = dual.evaluateShadow(baseInput);

check('module version is Patch 26F-C shadow', () => assert.match(result.version, /26F_C/));
check('mode is explicitly shadow only', () => assert.strictEqual(result.mode, dual.CALCIO_DUAL_SCORE_MODE));
check('all four score families are finite 0-100', () => {
    for (const value of [result.forecastConfidenceScore.score, result.valueScore.score, result.contextRiskPenalty.score, result.decisionReadiness.score]) {
        assert(Number.isFinite(value)); assert(value >= 0 && value <= 100);
    }
});
check('paper trading n=0 has zero architecture weight', () => assert.strictEqual(result.forecastConfidenceScore.components.paperTradingCalibration.maxArchitectureWeight, 0));
check('paper trading n=0 contributes zero adjustment', () => assert.strictEqual(result.forecastConfidenceScore.components.paperTradingCalibration.adjustmentPp, 0));
check('legacy neutral PT contribution is detected', () => assert.strictEqual(result.comparison.legacyNeutralPaperTradingDetected, true));
check('legacy IPM remains comparison only', () => assert.strictEqual(result.architecture.legacyIpmComparatorPreserved ?? true, true));
check('shadow architecture cannot authorize stake', () => assert.strictEqual(result.decisionReadiness.canAuthorizeStake, false));
check('production stake authority is unchanged', () => assert.strictEqual(result.architecture.productionStakeAuthorityChanged, false));
check('production probability is unchanged', () => assert.strictEqual(result.architecture.productionProbabilityChanged, false));
check('FCS excludes edge EV and stake', () => {
    assert.strictEqual(result.forecastConfidenceScore.invariants.edgeEvExcluded, true);
    assert.strictEqual(result.forecastConfidenceScore.invariants.stakeExcluded, true);
});
check('Value Score excludes data quality and reliability', () => {
    assert.strictEqual(result.valueScore.invariants.dataQualityExcluded, true);
    assert.strictEqual(result.valueScore.invariants.reliabilityExcluded, true);
});
check('changing EV does not change FCS', () => {
    const highEv = dual.evaluateShadow({ ...baseInput, robustEvPct: 12 }).forecastConfidenceScore.score;
    assert.strictEqual(highEv, result.forecastConfidenceScore.score);
});
check('changing data quality does not change Value Score', () => {
    const changed = dual.evaluateShadow({ ...baseInput, dataQuality: { status: 'DATA_QUALITY_CERTIFIED', score: 99, blocking: false } }).valueScore.score;
    assert.strictEqual(changed, result.valueScore.score);
});
check('early low robust EV applies readiness cap', () => assert(result.decisionReadiness.caps.includes('EARLY_EV_BELOW_RECHECK_THRESHOLD')));
check('mature PT gets positive but capped weight', () => {
    const mature = dual.evaluateShadow({ ...baseInput, historicalSample: 50, historicalAdjustedRatePct: 65, historicalEvidence: { resolved: 50, adjustedRatePct: 65 } });
    assert(mature.forecastConfidenceScore.components.paperTradingCalibration.maxArchitectureWeight > 0);
    assert(mature.forecastConfidenceScore.components.paperTradingCalibration.maxArchitectureWeight <= 0.05);
});
check('promoted team adds context penalty', () => {
    const promoted = dual.evaluateShadow({ ...baseInput, promotedTeamPrior: true, historicalCoverage: { status: 'PROMOTED_TEAM_PRIOR', confidence: 58, promotedTeamPrior: true } });
    assert(promoted.contextRiskPenalty.score > result.contextRiskPenalty.score);
});
check('non-positive robust EV caps readiness', () => {
    const noValue = dual.evaluateShadow({ ...baseInput, robustEvPct: -1 });
    assert(noValue.decisionReadiness.score <= 45);
    assert(noValue.decisionReadiness.caps.includes('ROBUST_EV_NON_POSITIVE'));
});
check('persistence fields declare zero authority', () => {
    const fields = dual.persistenceFields(result);
    assert.strictEqual(fields.calcio_dual_score_authority, 0);
    assert.strictEqual(fields.calcio_dual_score_pt_weight, 0);
});
check('invariant audit passes', () => assert.strictEqual(dual.assertShadowInvariants(result).success, true));

const success = checks.every(row => row.ok);
console.log(JSON.stringify({
    success,
    patch: 'BETTING_PATCH_26F_C_CALCIO_DUAL_SCORE_ARCHITECTURE_SHADOW',
    checks: checks.length,
    oldIpmScore: old.score,
    oldIpmPtContribution: old.components.paperTrading.contribution,
    shadow: {
        forecastConfidenceScore: result.forecastConfidenceScore.score,
        valueScore: result.valueScore.score,
        contextRiskPenalty: result.contextRiskPenalty.score,
        decisionReadiness: result.decisionReadiness.score,
        label: result.decisionReadiness.label,
        ptWeight: result.forecastConfidenceScore.components.paperTradingCalibration.maxArchitectureWeight
    },
    results: checks
}, null, 2));
process.exit(success ? 0 : 1);
