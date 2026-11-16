'use strict';
const assert = require('assert');
const reliability = require('../backend/calcioCrossMarketReliability');
const dataQuality = require('../backend/calcioDataQualityAuthority');
const stakeAuthority = require('../backend/calcioUnifiedStakeAuthority');
const finalState = require('../backend/calcioDeepScanFinalState');

const NOW = new Date('2026-07-27T10:52:00Z');
function odds(sourceCount = 10) {
    return {
        certified: true,
        operationalEligible: true,
        realDirect: true,
        sourceCount,
        selectedSource: { lastUpdate: '2026-07-27T10:51:36Z', derived: false }
    };
}
function assess({ prediction, odd, odd1, oddX, odd2, model, market, matchDate, reliabilityScore, dataClass = 'ATTENDIBILE', xg = 'GOAL_SHOT_PROXY', lineup = 'LINEUP_NOT_CONFIRMED', action = 'WATCHLIST LOW EDGE', indexScore = 62, sourceConfidence = 10, coverage = 'HISTORY_PROXY_STRONG', sourceCount = 10 }) {
    const cross = reliability.buildReliabilityAssessment({
        prediction, odd, odd1, oddX, odd2,
        modelProbabilityPct: model,
        marketProbabilityPct: market,
        matchDate,
        now: NOW,
        reliabilityScore,
        dataClass,
        xgEvidenceMode: xg,
        lineupStatus: lineup,
        currentAction: action
    });
    const quality = dataQuality.assessDataQuality({
        oddsCertification: odds(sourceCount),
        identityCertified: true,
        marketIdentityCertified: true,
        reliabilityScore,
        dataClass,
        coverageMode: coverage,
        xgEvidenceMode: xg,
        lineupStatus: lineup,
        sourceConfidencePct: sourceConfidence,
        reliabilityAssessment: cross,
        daysToKickoff: cross.daysToKickoff,
        now: NOW
    });
    const authority = stakeAuthority.evaluateStakeAuthority({
        bankrollSnapshot: 1000,
        bankrollSource: 'ANALYSIS_BATCH_IMMUTABLE_SNAPSHOT',
        netExecutableOdd: odd,
        productionProbabilityPct: model,
        robustProbabilityPct: cross.robustProbabilityPct,
        robustEvPct: cross.robustEvPct,
        epistemicUncertaintyScore: cross.epistemicUncertaintyScore,
        daysToKickoff: cross.daysToKickoff,
        predictionIndexScore: indexScore,
        reliabilityScore,
        currentAction: action,
        dataQualityAssessment: quality,
        lineupStatus: lineup,
        xgEvidenceMode: xg
    });
    authority.finalNarrative = stakeAuthority.finalNarrative(authority, prediction);
    return { cross, quality, authority };
}

const bankroll = stakeAuthority.resolveAnalysisBankrollSnapshot({ requestedBankroll: null, currentCalcioBankroll: 1000 });
assert.deepStrictEqual(bankroll, { snapshot: 1000, source: 'BANKROLL_MANAGER_CALCIO', version: stakeAuthority.CALCIO_UNIFIED_STAKE_AUTHORITY_VERSION });
const requestBankroll = stakeAuthority.resolveAnalysisBankrollSnapshot({ requestedBankroll: 1234.56, currentCalcioBankroll: 1000 });
assert.strictEqual(requestBankroll.snapshot, 1234.56);

const torino = assess({
    prediction: 'O2.5', odd: 1.97, odd1: 4.70, oddX: 3.87, odd2: 1.85,
    model: 54.72, market: 50.76, matchDate: '2026-08-23T20:45:00+02:00',
    reliabilityScore: 61.4, indexScore: 61.77, sourceConfidence: 7, sourceCount: 11
});
assert(torino.cross.robustEvPct < 0);
assert.strictEqual(torino.authority.prePortfolioCapStake, 0);
assert.strictEqual(torino.authority.eligible, false);
assert.strictEqual(torino.authority.effectiveAction, 'RISCHIO MODELLO');
assert.strictEqual(torino.authority.qualityFinalLabel, 'BLOCCATA SOFT');
assert(torino.authority.reason.includes('EV robusto'));

const genoa = assess({
    prediction: 'U2.5', odd: 1.70, odd1: 5.10, oddX: 3.53, odd2: 1.92,
    model: 61.99, market: 58.82, matchDate: '2026-08-22T20:45:00+02:00',
    reliabilityScore: 67.9, indexScore: 63.45, sourceConfidence: 9, sourceCount: 9
});
assert(genoa.cross.robustEvPct >= 4);
assert.strictEqual(genoa.authority.prePortfolioCapStake, 2);
assert.strictEqual(genoa.authority.eligible, true);
assert.strictEqual(genoa.authority.qualityFinalLabel, 'APPROVATA CON CAP');
assert.strictEqual(genoa.authority.bankrollSnapshot, 1000);
assert(genoa.authority.modelStake > genoa.authority.prePortfolioCapStake);

const romaCross = {
    available: true,
    robustProbabilityPct: 51.64,
    robustEvPct: 3.29,
    epistemicUncertaintyScore: 57.5,
    daysToKickoff: 28.33,
    poissonStress: { available: true, status: 'ONE_X_TWO_POISSON_STRESS_USABLE' }
};
const romaQuality = dataQuality.assessDataQuality({
    oddsCertification: odds(10),
    identityCertified: true,
    marketIdentityCertified: true,
    reliabilityScore: 73,
    dataClass: 'BUONA',
    coverageMode: 'HISTORY_PROXY_STRONG',
    xgEvidenceMode: 'GOAL_SHOT_PROXY',
    lineupStatus: 'LINEUP_NOT_CONFIRMED',
    sourceConfidencePct: 22,
    reliabilityAssessment: romaCross,
    daysToKickoff: romaCross.daysToKickoff,
    now: NOW
});
const romaAuthority = stakeAuthority.evaluateStakeAuthority({
    bankrollSnapshot: 1000,
    bankrollSource: 'ANALYSIS_BATCH_IMMUTABLE_SNAPSHOT',
    netExecutableOdd: 2.00,
    productionProbabilityPct: 52.50,
    robustProbabilityPct: romaCross.robustProbabilityPct,
    robustEvPct: romaCross.robustEvPct,
    epistemicUncertaintyScore: romaCross.epistemicUncertaintyScore,
    daysToKickoff: romaCross.daysToKickoff,
    predictionIndexScore: 61.9,
    reliabilityScore: 73,
    currentAction: 'WATCHLIST LOW EDGE',
    dataQualityAssessment: romaQuality,
    lineupStatus: 'LINEUP_NOT_CONFIRMED',
    xgEvidenceMode: 'GOAL_SHOT_PROXY'
});
const roma = { cross: romaCross, quality: romaQuality, authority: romaAuthority };
assert(roma.cross.robustEvPct > 0 && roma.cross.robustEvPct < 4);
assert.strictEqual(roma.authority.prePortfolioCapStake, 0);
assert(roma.authority.hardVetoes.some(reason => reason.includes('sotto soglia')));

const prior = assess({
    prediction: '1', odd: 2.45, odd1: 2.45, oddX: 3.25, odd2: 3.05,
    model: 42.51, market: 40.82, matchDate: '2026-08-23T18:30:00+02:00',
    reliabilityScore: 24, indexScore: 44, dataClass: 'PRIOR_ONLY', xg: 'LEAGUE_PRIOR',
    coverage: 'PRIOR_ONLY', sourceConfidence: 9, sourceCount: 19
});
assert.strictEqual(prior.quality.blocking, true);
assert.strictEqual(prior.authority.prePortfolioCapStake, 0);
assert.strictEqual(prior.authority.effectiveAction, 'ALTO RISCHIO');
assert.strictEqual(prior.authority.qualityFinalLabel, 'BLOCCATA HARD');

const report = finalState.finalizeCandidateReport({
    action: '🟢 VIA LIBERA / VALUE',
    displayAction: '🟢 VIA LIBERA / VALUE',
    marketSummary: { modelProbabilityPct: 56.06, bookmakerFairProbabilityPct: 50 },
    deepScanAdvisory: { rationale: 'VIA LIBERA / VALUE' },
    medicalNews: { home: { confidence: 7 }, away: { confidence: 31 } },
    pillars: []
}, {
    edgePp: 3.96, evPct: 7.8, odd: 1.97, reliabilityScore: 61.4,
    predictionIndexScore: 61.77, dataClass: 'ATTENDIBILE', disagreementPp: 6.06,
    modelMarketGapPp: 6.06, xgEvidenceMode: 'GOAL_SHOT_PROXY', lineupStatus: 'LINEUP_NOT_CONFIRMED',
    timingStatus: 'EARLY_WATCHLIST', finalizationCertified: true
});
const authoritativeReport = finalState.applyStakeAuthorityOutcome(report, torino.authority, torino.quality, 'O2.5');
assert.strictEqual(authoritativeReport.action, 'RISCHIO MODELLO');
assert.strictEqual(authoritativeReport.qualityFinalLabel, 'BLOCCATA SOFT');
assert(authoritativeReport.deepScanAdvisory.rationale.includes('senza stake'));
assert(!authoritativeReport.deepScanAdvisory.rationale.includes('VIA LIBERA'));
const tactical = authoritativeReport.pillars.find(p => p.name.includes('Tattica'));
assert(tactical.evidence.some(item => item.includes('6.06 pp')));

console.log(JSON.stringify({
    success: true,
    patch: '26E-C',
    checks: 33,
    torino: { robustEv: torino.cross.robustEvPct, stake: torino.authority.prePortfolioCapStake, quality: torino.authority.qualityFinalLabel },
    genoa: { robustEv: genoa.cross.robustEvPct, stake: genoa.authority.prePortfolioCapStake, quality: genoa.authority.qualityFinalLabel },
    roma: { robustEv: roma.cross.robustEvPct, stake: roma.authority.prePortfolioCapStake }
}, null, 2));
