'use strict';

const assert = require('assert');
const contract = require('../backend/calcioFinalMarketDiagnosticContract');

const markets = {
    '1': { type: '1X2', final: 47.2, model: 48.1, mc: 46.8, market: 45.9 },
    'X': { type: '1X2', final: 27.4, model: 27.0, mc: 27.7, market: 26.8 },
    '2': { type: '1X2', final: 25.4, model: 24.9, mc: 25.5, market: 27.3 },
    'O2.5': { type: 'TOTALS', final: 54.7, model: 56.1, mc: 55.7, market: 50.0 },
    'U2.5': { type: 'TOTALS', final: 45.3, model: 43.9, mc: 44.3, market: 50.0 },
    'GG': { type: 'BTTS', final: 51.2, model: 52.0, mc: 51.5, market: 49.1 },
    'NG': { type: 'BTTS', final: 48.8, model: 48.0, mc: 48.5, market: 50.9 }
};

const integrity = {
    coverageMode: 'HISTORY_PROXY_STRONG',
    reliability: 'LOW',
    diagnostics: {},
    marketReliability: {}
};
for (const [prediction, row] of Object.entries(markets)) {
    integrity.diagnostics[prediction] = {
        modelProbabilityPct: row.model,
        monteCarloProbabilityPct: row.mc,
        marketProbabilityPct: row.market,
        disagreementPp: Math.max(row.model, row.mc, row.market) - Math.min(row.model, row.mc, row.market),
        monteCarloStdErrorPp: 0.5,
        reliability: 'MEDIUM'
    };
    integrity.marketReliability[prediction] = 'MEDIUM';
}

const ids = new Set();
for (const [prediction, row] of Object.entries(markets)) {
    const snapshot = contract.buildFinalMarketSnapshot({
        candidate: {
            prediction,
            market_type: row.type,
            odd: 2.05,
            estimatedProb: row.final,
            edge_pp: 2,
            ev_pct: 4.1,
            event_key: 'fixture-event',
            probabilityIntegrity: integrity,
            extData: { monteCarlo: { scoreDistribution: [{ score: '1-1', probability: 0.12 }] } }
        },
        predictionReliability: { score: 68, label: 'MEDIUM' },
        dataQuality: { status: 'DATA_QUALITY_LIMITED', score: 80, blocking: false },
        stakeAuthority: {
            version: 'FIXTURE_STAKE', modelStake: 4, reliabilityStake: 0,
            robustProbabilityPct: row.final - 1, robustEvPct: -1,
            epistemicUncertaintyScore: 60,
            timingPolicy: { code: 'EARLY_GT_21D' },
            reason: 'Fixture no value.'
        },
        decision: { dataClass: 'ATTENDIBILE', finalizationStatus: 'FULLY_FINALIZED' },
        finalOperationalStake: 0,
        eligible: false,
        allowBet: false,
        finalizationCertified: true
    });
    assert.strictEqual(snapshot.prediction, prediction);
    assert.strictEqual(snapshot.marketType, row.type);
    assert.strictEqual(snapshot.probabilityPct, row.final);
    assert.strictEqual(snapshot.probability.modelProbabilityPct, row.model);
    assert.strictEqual(snapshot.probability.monteCarloProbabilityPct, row.mc);
    assert.strictEqual(snapshot.probability.marketProbabilityPct, row.market);
    assert.strictEqual(snapshot.forecastConfidence.label, 'MEDIUM');
    assert.strictEqual(snapshot.decisionState.code, contract.DECISION_STATES.NO_BET_VALUE);
    assert.strictEqual(snapshot.coherence.status, contract.COHERENCE_CERTIFIED);
    assert(snapshot.scorelineDistribution.length === 1);
    ids.add(snapshot.marketId);
}
assert.strictEqual(ids.size, Object.keys(markets).length, 'Market ID non univoci per mercato');

const base = contract.buildFinalMarketSnapshot({
    candidate: { prediction: 'U2.5', market_type: 'TOTALS', odd: 1.9, estimatedProb: 55, edge_pp: 2.37, ev_pct: 4.5, event_key: 'fixture-early', probabilityIntegrity: integrity },
    predictionReliability: { score: 70, label: 'MEDIUM' },
    dataQuality: { status: 'DATA_QUALITY_LIMITED', score: 82, blocking: false },
    stakeAuthority: { modelStake: 4, reliabilityStake: 2, robustProbabilityPct: 54, robustEvPct: 2.6, timingPolicy: { code: 'EARLY_GT_21D' }, reason: 'Analisi anticipata.' },
    decision: { dataClass: 'ATTENDIBILE', finalizationStatus: 'FULLY_FINALIZED' },
    finalOperationalStake: 0,
    eligible: false,
    finalizationCertified: true
});
assert.strictEqual(base.decisionState.code, contract.DECISION_STATES.EARLY_RECHECK);

const value = contract.buildFinalMarketSnapshot({
    candidate: { prediction: '1', market_type: '1X2', odd: 2.2, estimatedProb: 48, edge_pp: 2.55, ev_pct: 5.6, event_key: 'fixture-value', probabilityIntegrity: integrity },
    predictionReliability: { score: 71, label: 'MEDIUM' },
    dataQuality: { status: 'DATA_QUALITY_LIMITED', score: 84, blocking: false },
    stakeAuthority: { modelStake: 5, reliabilityStake: 2.5, robustProbabilityPct: 47, robustEvPct: 3.4, timingPolicy: { code: 'T48H' }, reason: 'Value non ancora operativo.' },
    decision: { dataClass: 'ATTENDIBILE', finalizationStatus: 'FULLY_FINALIZED' },
    finalOperationalStake: 0,
    eligible: false,
    finalizationCertified: true
});
assert.strictEqual(value.decisionState.code, contract.DECISION_STATES.VALUE_CANDIDATE);

const ready = contract.refreshAfterAllocation(value, {
    finalOperationalStake: 2.5,
    eligible: true,
    allowBet: true,
    finalizationStatus: 'FULLY_FINALIZED',
    finalizationCertified: true,
    dataClass: 'ATTENDIBILE',
    reason: 'Allocazione completata.'
});
assert.strictEqual(ready.decisionState.code, contract.DECISION_STATES.BET_READY);
assert.strictEqual(ready.stake.finalOperationalStake, 2.5);
assert.strictEqual(ready.coherence.status, contract.COHERENCE_CERTIFIED);

const blocked = contract.buildFinalMarketSnapshot({
    candidate: { prediction: '2', market_type: '1X2', odd: 3, estimatedProb: 35, edge_pp: 1.67, ev_pct: 5, event_key: 'fixture-blocked', probabilityIntegrity: { ...integrity, coverageMode: 'PRIOR_ONLY' } },
    predictionReliability: { score: 20, label: 'VERY_LOW' },
    dataQuality: { status: 'DATA_QUALITY_BLOCKED', score: 55, blocking: true },
    stakeAuthority: { robustEvPct: 5, timingPolicy: { code: 'T48H' }, reason: 'Dati bloccanti.' },
    decision: { dataClass: 'INATTENDIBILE', finalizationStatus: 'FULLY_FINALIZED' },
    finalOperationalStake: 0,
    eligible: false,
    finalizationCertified: true
});
assert.strictEqual(blocked.decisionState.code, contract.DECISION_STATES.NO_BET_DATA);

const failed = contract.refreshAfterAllocation(value, {
    finalOperationalStake: 0,
    eligible: false,
    failed: true,
    failureReason: 'DeepScan failed',
    finalizationStatus: 'FAILED_FINALIZATION',
    finalizationCertified: false
});
assert.strictEqual(failed.decisionState.code, contract.DECISION_STATES.FAILED_ANALYSIS);

const fields = contract.persistenceFields(ready);
assert.strictEqual(fields.calcio_final_market_id, ready.marketId);
assert.strictEqual(fields.calcio_decision_state, 'BET_READY');
assert.strictEqual(fields.calcio_diagnostic_coherence_status, contract.COHERENCE_CERTIFIED);

console.log(JSON.stringify({
    success: true,
    marketsTested: Object.keys(markets),
    uniqueMarketIds: ids.size,
    decisionStatesTested: ['NO_BET_VALUE','EARLY_RECHECK','VALUE_CANDIDATE','BET_READY','NO_BET_DATA','FAILED_ANALYSIS'],
    checks: 76
}, null, 2));
