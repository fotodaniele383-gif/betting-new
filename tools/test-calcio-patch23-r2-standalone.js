'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const contract = require('../backend/calcioDeepScanPayloadContract');
const index = require('../backend/calcioUnifiedPredictionIndex');
const resilience = require('../backend/deepScanRuntimeResilience');
const registry = require('../backend/calcioPatchRegistry');

const PATCH = 'BETTING_PATCH_23_R2_CALCIO_DEEPSCAN_COMPACT_PAYLOAD_RUNTIME_RECOVERY';
const checks = [];
function check(name, fn) {
    return Promise.resolve().then(fn).then(details => checks.push({ name, ok: true, details }));
}

function odds(market, odd, home = 'Alpha', away = 'Beta') {
    const marketKey = ['1', 'X', '2'].includes(market) ? 'h2h' : 'totals';
    const outcomeName = market === '1' ? home : market === '2' ? away : market === 'X' ? 'Draw' : market === 'O2.5' ? 'Over' : 'Under';
    return {
        market,
        status: 'CERTIFIED_MULTI_SOURCE',
        certified: true,
        operationalEligible: true,
        realDirect: true,
        crossVerified: true,
        sourceCount: 8,
        selectedPrice: odd,
        selectedSource: {
            provider: 'THE_ODDS_API', providerEventId: 'evt-r2', bookmakerKey: 'onexbet', bookmakerTitle: '1xBet',
            lastUpdate: '2026-07-24T08:00:00Z', marketKey, outcomeName, point: marketKey === 'totals' ? 2.5 : null,
            price: odd, direct: true, derived: false
        },
        sources: Array.from({ length: 8 }, (_, i) => ({ bookmakerKey: `book-${i}`, price: odd - i * 0.01 }))
    };
}

function genoaFixture() {
    return {
        home: 'Genoa', away: 'Napoli', home_team: 'Genoa', away_team: 'Napoli',
        providerHome: 'Genoa', providerAway: 'Napoli', provider_event_id: 'evt-r2', event_key: 'evt-r2',
        requireIdentityCertification: true, decisionIdentity: { certified: true }, prediction: 'U2.5', market: 'U2.5',
        odd: 1.70, probability: 61.94, estimated_prob: 61.94, edge_pp: 2.34, ev_pct: 3.97,
        reliabilityScore: 73, bankroll: 2003.69, deepScanAction: 'WATCHLIST LOW EDGE', historicalSample: 0,
        monteCarloProbabilityPct: 63.7, modelProbabilityPct: 62.5, marketProbabilityPct: 58.5,
        oddsCertification: odds('U2.5', 1.70, 'Genoa', 'Napoli')
    };
}



(async () => {
    await check('Huge analysis context is reduced to the compact allow-list', () => {
        const huge = {
            league: 'Serie A', footballDataLoaded: true, xgEvidenceMode: 'GOAL_SHOT_PROXY',
            understatData: { dump: 'x'.repeat(500000) },
            teamSnapshots: Array.from({ length: 2000 }, (_, i) => ({ i, text: 'snapshot'.repeat(20) })),
            monteCarlo: { scoreDistribution: Array.from({ length: 5000 }, (_, i) => ({ score: i, p: 0.0001 })) },
            marketSelectionAudit: { ranking: Array.from({ length: 1000 }, (_, i) => ({ i, detail: 'audit'.repeat(20) })) },
            probabilityIntegrity: { coverageMode: 'STRONG', reliability: 'MEDIUM', diagnostics: { 'U2.5': { monteCarloProbabilityPct: 63.7, modelProbabilityPct: 62.5, marketProbabilityPct: 58.5 } } },
            opponentAdjustedForm: { version: 'V1', status: 'EARLY_SEASON', confidence: 40, expectedGoals: { expHomeGoals: 1.2, expAwayGoals: 0.9 }, rawRows: 'y'.repeat(200000) }
        };
        const compact = contract.sanitizeExtData(huge, 'U2.5');
        const result = contract.assertCompactPayload({ homeTeam: 'Genoa', awayTeam: 'Napoli', prediction: 'U2.5', extData: compact });
        assert(result.ok, JSON.stringify(result));
        assert(!Object.prototype.hasOwnProperty.call(compact, 'understatData'));
        assert(!Object.prototype.hasOwnProperty.call(compact, 'teamSnapshots'));
        assert(!Object.prototype.hasOwnProperty.call(compact, 'monteCarlo'));
        assert(!Object.prototype.hasOwnProperty.call(compact, 'marketSelectionAudit'));
        return result;
    });

    await check('Legacy request above the old Express 100 KB limit is accepted by the new parser contract and compacted', () => {
        const serverSource = fs.readFileSync(path.resolve(__dirname, '../backend/server.js'), 'utf8');
        assert(serverSource.includes("express.json({ limit: calcioDeepScanPayloadContract.EXPRESS_JSON_LIMIT })"));
        const body = { homeTeam: 'Genoa', awayTeam: 'Napoli', prediction: 'U2.5', odd: 1.7, prob: 61.94, extData: { league: 'Serie A', legacyNoise: 'z'.repeat(150000) } };
        const compact = contract.sanitizeRequestBody(body, { league: 'Serie A', estimated_prob: 61.94, calcio_prediction_reliability_score: 73 });
        assert(compact.diagnostics.originalBytes > 100 * 1024);
        assert(compact.diagnostics.compactBytes < contract.CLIENT_TARGET_BYTES);
        return compact.diagnostics;
    });

    await check('Payloads above the bounded server contract return explicit HTTP 413', () => {
        const body = { homeTeam: 'A', awayTeam: 'B', prediction: '1', extData: { noise: 'n'.repeat(contract.SERVER_MAX_BYTES + 10000) } };
        assert.throws(() => contract.sanitizeRequestBody(body, {}), error => error.code === 'CALCIO_DEEPSCAN_PAYLOAD_TOO_LARGE' && error.httpStatus === 413);
        return { maxBytes: contract.SERVER_MAX_BYTES };
    });

    await check('Server-side row rehydration restores probability and reliability without the huge browser object', () => {
        const row = {
            league: 'Serie A', match_date: '2026-08-22T18:45:00.000Z', estimated_prob: 61.94,
            calcio_prediction_reliability_score: 73.2, calcio_prediction_reliability_label: 'BUONA',
            calcio_prediction_index_components: JSON.stringify({ probability: { monteCarlo: 63.7, model: 62.5, marketProbability: 58.5, probability: 61.94 }, reliability: { score: 73.2 } }),
            calcio_odds_provenance_json: JSON.stringify({ selectedSource: { providerEventId: 'evt-row' } })
        };
        const compact = contract.sanitizeRequestBody({ homeTeam: 'Genoa', awayTeam: 'Napoli', prediction: 'U2.5', odd: 1.7, prob: 61.94, extData: {} }, row);
        assert.equal(compact.extData.probabilityIntegrity.selectedMarket.modelProbabilityPct, 62.5);
        assert.equal(compact.extData.probabilityIntegrity.selectedMarket.monteCarloProbabilityPct, 63.7);
        assert.equal(compact.extData.predictionReliability.score, 73.2);
        return compact.extData;
    });

    await check('Patch 22 IPM and positive stake authority remain unchanged', () => {
        const result = index.evaluatePrediction(genoaFixture());
        assert(result.score >= 60 && result.score < 70, JSON.stringify(result));
        assert(result.operationalStake >= 7, JSON.stringify(result));
        return { score: result.score, label: result.label, stake: result.operationalStake };
    });

    await check('Runtime partial result is bounded and does not claim persistence', async () => {
        resilience.resetForTests();
        const result = await resilience.runDeepScan({
            eventKey: 'evt-timeout-r2', homeTeam: 'A', awayTeam: 'B', prediction: '1', timeoutMs: 20,
            task: () => new Promise(resolve => setTimeout(() => resolve({ success: true, action: 'VALUE' }), 100))
        });
        assert.equal(result.partial, true);
        assert.equal(result.persistence.persisted, false);
        return { status: result.status, action: result.action, persistence: result.persistence };
    });

    await check('Registry exposes the corrected replacement Patch 23', () => {
        assert.equal(registry.CALCIO_CURRENT_PATCH_VERSION, '23');
        const patch = registry.PATCHES.find(item => item.version === '23');
        assert(patch && patch.id === PATCH);
        return patch;
    });

    console.log(JSON.stringify({ success: true, patch: PATCH, checks }, null, 2));
})().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
