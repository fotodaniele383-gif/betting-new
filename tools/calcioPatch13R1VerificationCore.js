'use strict';

const fs = require('fs');
const path = require('path');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function assertCondition(condition, name, details = null) {
    if (!condition) {
        const error = new Error(name);
        error.details = details;
        throw error;
    }
    return { name, ok: true, details };
}

async function run(root = path.resolve(__dirname, '..')) {
    const probability = require(path.join(root, 'backend', 'calcioProbabilityIntegrity'));
    const macro = require(path.join(root, 'backend', 'bettingMacroCausal'));
    const coherence = require(path.join(root, 'backend', 'calcioProgramCoherence'));
    const runtime = require(path.join(root, 'backend', 'deepScanRuntimeResilience'));
    const registry = require(path.join(root, 'backend', 'calcioPatchRegistry'));

    runtime.resetForTests();
    const checks = [];
    const diagnostics = {};

    const integrity = probability.buildCalcioProbabilityIntegrity({
        modelProbabilities: { '1': 40, X: 30, '2': 30, 'O2.5': 50, 'U2.5': 50, GG: 50, NG: 50 },
        mcResult: { homeWinProb: 0.42, drawProb: 0.28, awayWinProb: 0.30, over2_5Prob: 0.50, golProb: 0.50 },
        marketFairOdds: { '1': 2.5, X: 3.333333333, '2': 3.333333333 },
        coverage: { mode: 'HISTORY_PROXY_STRONG' },
        iterations: 10000,
        seed: 131
    });
    checks.push(assertCondition(Math.abs(integrity.sources.market['1X'] - 70) < 0.01, 'No-vig 1X = P1 + PX'));
    checks.push(assertCondition(Math.abs(integrity.sources.market.X2 - 60) < 0.01, 'No-vig X2 = PX + P2'));
    checks.push(assertCondition(Math.abs(integrity.sources.market['12'] - 70) < 0.01, 'No-vig 12 = P1 + P2'));
    for (const market of ['1X', 'X2', '12']) {
        const row = integrity.diagnostics[market];
        checks.push(assertCondition(
            row && Number.isFinite(row.modelProbabilityPct) && Number.isFinite(row.monteCarloProbabilityPct) && Number.isFinite(row.marketProbabilityPct),
            `Model/Monte Carlo/market probabilities derived for ${market}`,
            row
        ));
        checks.push(assertCondition(Array.isArray(row.derivedFrom) && row.derivedFrom.length === 2, `Derived components recorded for ${market}`, row.derivedFrom));
    }

    const deepSource = fs.readFileSync(path.join(root, 'backend', 'deepScanCalcio.js'), 'utf8');
    checks.push(assertCondition(deepSource.includes('derived_double_chance_no_vig_reference'), 'DeepScan uses derived_double_chance_no_vig_reference'));

    const expectedDs = new Set(['RISCHIO MODELLO', 'EDGE TECNICO', 'VALUE CONFERMATO / MICRO', 'ALTO RISCHIO', 'WATCHLIST LOW EDGE']);
    const observedDs = new Set([
        macro.deepScanMacro({ edge_pp: -1, reliabilityScore: 70, theoreticalStake: 0 }),
        macro.deepScanMacro({ edge_pp: 5, reliabilityScore: 55, theoreticalStake: 0 }),
        macro.deepScanMacro({ edge_pp: 5, reliabilityScore: 70, theoreticalStake: 10 }),
        macro.deepScanMacro({ action: 'VALUE TRAP', professionalRisk: 75 }),
        macro.deepScanMacro({ edge_pp: 1, reliabilityScore: 50, theoreticalStake: 0 })
    ]);
    checks.push(assertCondition([...expectedDs].every(value => observedDs.has(value)), 'All canonical DeepScan macros are reachable', [...observedDs]));

    const expectedGate = ['WATCHLIST MICRO', 'BLOCCATA SOFT', 'BLOCCATA HARD', 'APPROVATA CON CAP', 'APPROVATA'];
    const observedGate = [
        macro.qualityMacro({ theoreticalStake: 10, operationalStake: 0, gateStatus: 'EARLY_WATCHLIST' }),
        macro.qualityMacro({ theoreticalStake: 0, operationalStake: 0 }),
        macro.qualityMacro({ theoreticalStake: 10, operationalStake: 0, gateStatus: 'BLOCKED_HARD' }),
        macro.qualityMacro({ theoreticalStake: 10, operationalStake: 4, maxStake: 4 }),
        macro.qualityMacro({ theoreticalStake: 10, operationalStake: 10, gateStatus: 'FULL_STAKE' })
    ];
    checks.push(assertCondition(expectedGate.every(value => observedGate.includes(value)), 'All canonical Quality Gate labels are reachable', observedGate));
    checks.push(assertCondition(!observedGate.includes('SENZA RESA QUALITÀ'), 'SENZA RESA QUALITÀ removed when Gate is determinable'));

    const proxyReliability = coherence.buildPredictionReliability({
        integrity: { coverageMode: 'HISTORY_PROXY_STRONG', diagnostics: { '1X': { disagreementPp: 1, monteCarloStdErrorPp: 0.4 } } },
        market: '1X',
        professionalAudit: { teamMatching: { confidence: 100 }, dataReliability: { score: 92 }, risk: 8 },
        sourceAudit: { coveragePct: 96, matchImpactConfidence: 35 },
        multiProviderEvidence: { status: 'MULTI_PROVIDER_USABLE', quantitativeProviders: 2 }
    });
    checks.push(assertCondition(proxyReliability.score <= 79 && proxyReliability.label === 'BUONA' && !proxyReliability.canReachHigh, 'Proxy-only reliability capped at 79/100 BUONA', proxyReliability));
    checks.push(assertCondition(proxyReliability.legacyLabel && proxyReliability.legacyLabel !== proxyReliability.label, 'Total reliability is distinct from legacy reliability'));

    const xgReliability = coherence.buildPredictionReliability({
        integrity: { coverageMode: 'STRONG_REAL_XG', diagnostics: { '1X': { disagreementPp: 0.5, monteCarloStdErrorPp: 0.25 } } },
        market: '1X',
        professionalAudit: { teamMatching: { confidence: 100 }, dataReliability: { score: 95 }, risk: 5 },
        sourceAudit: { coveragePct: 98, matchImpactConfidence: 40 },
        multiProviderEvidence: { status: 'MULTI_PROVIDER_USABLE', quantitativeProviders: 2 }
    });
    checks.push(assertCondition(xgReliability.canReachHigh && xgReliability.label === 'ALTA', 'ALTA allowed with reconciled real xG', xgReliability));

    const providersReliability = coherence.buildPredictionReliability({
        integrity: { coverageMode: 'HISTORY_PROXY_STRONG', diagnostics: { '1X': { disagreementPp: 0.5, monteCarloStdErrorPp: 0.25 } } },
        market: '1X',
        professionalAudit: { teamMatching: { confidence: 100 }, dataReliability: { score: 98 }, risk: 3 },
        sourceAudit: { coveragePct: 99, matchImpactConfidence: 40 },
        multiProviderEvidence: { status: 'MULTI_PROVIDER_STRONG', quantitativeProviders: 3 }
    });
    checks.push(assertCondition(providersReliability.canReachHigh && providersReliability.label === 'ALTA', 'ALTA allowed with at least three authoritative quantitative providers', providersReliability));

    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, (_, index) => runtime.runDeepScan({
        eventKey: `runtime-match-${index}`,
        timeoutMs: 1000,
        task: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await sleep(25);
            active -= 1;
            return { success: true, index };
        }
    }));
    await Promise.all(tasks);
    checks.push(assertCondition(maxActive <= 2 && runtime.diagnostics().deepScanQueue.maxObserved <= 2, 'DeepScan queue executes at most two matches concurrently', { maxActive, queue: runtime.diagnostics().deepScanQueue }));

    let executions = 0;
    const duplicatedA = runtime.runDeepScan({ eventKey: 'same-event-key', timeoutMs: 1000, task: async () => { executions += 1; await sleep(30); return { success: true, marker: 'shared' }; } });
    const duplicatedB = runtime.runDeepScan({ eventKey: 'same-event-key', timeoutMs: 1000, task: async () => { executions += 1; return { success: true, marker: 'duplicate' }; } });
    const [dedupeA, dedupeB] = await Promise.all([duplicatedA, duplicatedB]);
    checks.push(assertCondition(executions === 1 && dedupeA.marker === 'shared' && dedupeB.marker === 'shared', 'DeepScan requests deduplicated by eventKey', { executions }));

    let newsExecutions = 0;
    const [newsA, newsB] = await Promise.all([
        runtime.getSharedNews('team-news-key', async () => { newsExecutions += 1; await sleep(20); return { articles: 3 }; }, { ttlMs: 5000 }),
        runtime.getSharedNews('team-news-key', async () => { newsExecutions += 1; return { articles: 9 }; }, { ttlMs: 5000 })
    ]);
    const newsC = await runtime.getSharedNews('team-news-key', async () => { newsExecutions += 1; return { articles: 12 }; }, { ttlMs: 5000 });
    checks.push(assertCondition(newsExecutions === 1 && newsA.articles === 3 && newsB.articles === 3 && newsC.articles === 3, 'News cache is shared across concurrent and subsequent requests', { newsExecutions }));

    runtime.resetForTests();
    let timeoutCode = null;
    try {
        await runtime.runProvider('SLOW_PROVIDER', async () => { await sleep(60); return true; }, { timeoutMs: 10, failureThreshold: 2, cooldownMs: 1000 });
    } catch (error) { timeoutCode = error.code; }
    try {
        await runtime.runProvider('SLOW_PROVIDER', async () => { await sleep(60); return true; }, { timeoutMs: 10, failureThreshold: 2, cooldownMs: 1000 });
    } catch (_) {}
    let circuitCode = null;
    try {
        await runtime.runProvider('SLOW_PROVIDER', async () => true, { timeoutMs: 10, failureThreshold: 2, cooldownMs: 1000 });
    } catch (error) { circuitCode = error.code; }
    checks.push(assertCondition(timeoutCode === 'PROVIDER_TIMEOUT' && circuitCode === 'PROVIDER_CIRCUIT_OPEN', 'Provider timeout and circuit breaker are active', { timeoutCode, circuitCode }));

    runtime.resetForTests();
    const partial = await runtime.runDeepScan({
        eventKey: 'partial-event',
        timeoutMs: 10,
        task: async () => { await sleep(60); return { success: true, late: true }; }
    });
    checks.push(assertCondition(partial.status === 'DEEPSCAN_PARZIALE' && partial.persistence?.reason === 'PARTIAL_RESPONSE_NO_DB_MUTATION', 'DEEPSCAN_PARZIALE replaces full timeout and does not persist', partial));
    await sleep(70);

    let writes = 0;
    const unchanged = runtime.persistIfChanged({ current: { ds_action: 'EDGE TECNICO' }, next: { ds_action: 'EDGE TECNICO' }, write: () => { writes += 1; } });
    const changed = runtime.persistIfChanged({ current: { ds_action: 'EDGE TECNICO' }, next: { ds_action: 'VALUE CONFERMATO / MICRO' }, write: patch => { writes += 1; diagnostics.persistedPatch = patch; } });
    checks.push(assertCondition(writes === 1 && unchanged.idempotent && changed.persisted, 'Persistence is idempotent and creates no duplicate revision', { writes, unchanged, changed }));

    const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
    const appMirror = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'), 'utf8');
    checks.push(assertCondition(app === appMirror, 'Frontend app mirror is byte-identical'));
    checks.push(assertCondition(app.includes("'APPROVATA CON CAP','APPROVATA'"), 'Tennis APPROVATA category remains visible with zero sample'));

    const serverSource = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
    checks.push(assertCondition(serverSource.includes("status: 'DEEPSCAN_PARZIALE'") || serverSource.includes("report?.status === 'DEEPSCAN_PARZIALE'"), 'Server exposes partial DeepScan response'));
    checks.push(assertCondition(serverSource.includes('PARTIAL_NO_PERSISTENCE'), 'Partial DeepScan bypasses DB persistence'));
    checks.push(assertCondition(!serverSource.includes('recordOddsApiUsage({'), 'No fixed or new Odds API debit path introduced'));

    const patch13 = registry.PATCHES.find(row => row.version === '13');
    checks.push(assertCondition(
        registry.CALCIO_CURRENT_PATCH_VERSION === '13' && patch13?.id === 'BETTING_PATCH_13_R1_DEEPSCAN_RUNTIME_RESILIENCE' && patch13?.newOddsApiCalls === 0 && patch13?.tennisAuthorityChanged === false,
        'Registry boundaries: Patch 13 R1, no Tennis authority change, zero new Odds API calls',
        patch13
    ));

    diagnostics.integrity = {
        sources: integrity.sources,
        doubleChanceDiagnostics: Object.fromEntries(['1X', 'X2', '12'].map(key => [key, integrity.diagnostics[key]]))
    };
    diagnostics.proxyReliability = proxyReliability;
    diagnostics.highAuthorityReliability = { realXg: xgReliability, threeProviders: providersReliability };
    diagnostics.runtime = runtime.diagnostics();

    return {
        success: checks.every(check => check.ok),
        patch: 'BETTING_PATCH_13_R1_DEEPSCAN_RUNTIME_RESILIENCE',
        version: runtime.DEEPSCAN_RUNTIME_RESILIENCE_VERSION,
        checks,
        diagnostics,
        boundaries: {
            databaseSchemaChanged: false,
            historicalTennisRowsChanged: false,
            tennisAuthorityChanged: false,
            newOddsApiCalls: 0,
            maxConcurrentDeepScans: 2
        }
    };
}

module.exports = { run };
