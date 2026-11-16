'use strict';
const assert = require('assert');
const finalState = require('../backend/calcioDeepScanFinalState');

const baseReport = {
    action: '🟢 VIA LIBERA / VALUE',
    rawAction: '🟢 VIA LIBERA / VALUE',
    pillars: [
        { name: 'Market traps / no-vig reference', risk: 12 },
        { name: 'Tattica, xG e market regime', risk: 22 },
        { name: 'Team news / medical / assenze', risk: 8 },
        { name: 'Motivazione / calendario / rotazioni', risk: 14 },
        { name: 'Overconfidence modello', risk: 4 },
        { name: 'Data quality / copertura fonti', risk: 18 }
    ],
    medicalNews: { home: { confidence: 60 }, away: { confidence: 65 } },
    deepScanAdvisory: { mode: 'WAIT_IN_PLAY' }
};

const common = {
    odd: 1.97,
    reliabilityScore: 65,
    xgEvidenceMode: 'STRONG_REAL_XG',
    lineupStatus: 'LINEUP_CONFIRMED',
    timingStatus: 'MATCH_WINDOW',
    finalizationCertified: true,
    modelMarketGapPp: 3,
    disagreementPp: 3
};

const strong = finalState.finalizeCandidateReport(baseReport, { ...common, edgePp: 5, evPct: 8, predictionIndexScore: 66, dataClass: 'BUONA' });
assert(['VALUE CONFERMATO / MICRO', 'EDGE TECNICO'].includes(strong.action));
const watch = finalState.finalizeCandidateReport(baseReport, { ...common, edgePp: 1.8, evPct: 3, predictionIndexScore: 60.5, dataClass: 'ATTENDIBILE' });
assert.strictEqual(watch.action, 'WATCHLIST LOW EDGE');
const modelRisk = finalState.finalizeCandidateReport(baseReport, { ...common, edgePp: 0.7, evPct: 1.4, predictionIndexScore: 56, dataClass: 'BUONA' });
assert.strictEqual(modelRisk.action, 'RISCHIO MODELLO');
const prior = finalState.finalizeCandidateReport(baseReport, { ...common, edgePp: 4, evPct: 9, predictionIndexScore: 62, reliabilityScore: 15, dataClass: 'PRIOR_ONLY' });
assert.strictEqual(prior.action, 'ALTO RISCHIO');
const noStakeContextA = finalState.finalizeCandidateReport(baseReport, { ...common, edgePp: 3, evPct: 5, predictionIndexScore: 61, dataClass: 'BUONA', theoreticalStake: 0 });
const noStakeContextB = finalState.finalizeCandidateReport(baseReport, { ...common, edgePp: 3, evPct: 5, predictionIndexScore: 61, dataClass: 'BUONA', theoreticalStake: 99 });
assert.strictEqual(noStakeContextA.action, noStakeContextB.action, 'Lo stake preliminare non deve cambiare la tassonomia');
assert.strictEqual(noStakeContextA.canonicalDeepScan.timingAdvisory, 'WAIT_IN_PLAY');
assert.strictEqual(noStakeContextA.canonicalDeepScan.advisoryHasStakeAuthority, false);
console.log(JSON.stringify({ success: true, patch: '26E-A', checks: 7 }, null, 2));
