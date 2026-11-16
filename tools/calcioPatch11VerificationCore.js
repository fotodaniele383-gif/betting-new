'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const understat = require('../backend/calcioUnderstatProviderV2');
const probabilityIntegrity = require('../backend/calcioProbabilityIntegrity');
const coherence = require('../backend/calcioProgramCoherence');
const registry = require('../backend/calcioPatchRegistry');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function buildAjaxTeams(count = 18) {
    const teams = {};
    for (let i = 0; i < count; i++) {
        teams[String(i + 1)] = {
            id: String(i + 1),
            title: `Serie A Team ${i + 1}`,
            history: [
                { xG: String(1.15 + i * 0.01), xGA: String(0.95 + i * 0.01) },
                { xG: String(1.35 + i * 0.01), xGA: String(1.05 + i * 0.01) }
            ]
        };
    }
    return { teams, players: [], dates: [] };
}

async function runPatch11Checks() {
    const parsedAjax = understat.parseUnderstatLeagueJson(buildAjaxTeams(), {
        seasonStart: 2025,
        source: 'TEST_AJAX_FIXTURE'
    });
    assert(parsedAjax.metadata.parser === 'AJAX_GET_LEAGUE_DATA_JSON', 'Understat V3 AJAX parser missing');
    assert(parsedAjax.metadata.teamCount === 18, 'Understat AJAX named-team validation failed');

    const tempCache = fs.mkdtempSync(path.join(os.tmpdir(), 'calcio-p11-understat-'));
    understat.resetUnderstatRuntimeForTests();
    const calls = [];
    const teams = await understat.getUnderstatxG('Serie A', {
        force: true,
        cacheDir: tempCache,
        seasonCandidates: [2026, 2025],
        fetchJson: async (url, ctx) => {
            calls.push({ url, seasonStart: ctx.seasonStart });
            if (ctx.seasonStart === 2026) {
                const error = new Error('UNDERSTAT_AJAX_HTTP_404');
                error.code = 'UNDERSTAT_AJAX_HTTP_404';
                error.notFound = true;
                throw error;
            }
            return buildAjaxTeams();
        }
    });
    assert(calls.length === 2 && calls[0].seasonStart === 2026 && calls[1].seasonStart === 2025, 'Understat current-to-prior season fallback invalid');
    assert(Object.keys(teams).length === 18, 'Understat prior season fallback returned no teams');
    const understatState = understat.getUnderstatState('Serie A');
    assert(understatState.source === 'DIRECT_AJAX_JSON' && understatState.season === '2025/2026', 'Understat runtime state does not expose AJAX prior');
    fs.rmSync(tempCache, { recursive: true, force: true });

    const integrity = probabilityIntegrity.buildCalcioProbabilityIntegrity({
        modelProbabilities: { '1': 55, X: 25, '2': 20, 'O2.5': 80, 'U2.5': 20, GG: 55, NG: 45 },
        mcResult: { homeWinProb: 0.54, drawProb: 0.26, awayWinProb: 0.20, over2_5Prob: 0.79, golProb: 0.56 },
        marketFairOdds: { '1': 1.85, X: 4.0, '2': 5.0, 'O2.5': 2.0, 'U2.5': 2.0, GG: 1.9, NG: 2.1 },
        coverage: { mode: 'HISTORY_PROXY_STRONG', homeMatched: true, awayMatched: true, homeSample: 19, awaySample: 19, xgEvidenceMode: 'GOAL_SHOT_PROXY' },
        iterations: 10000,
        seed: 'PATCH11_SELECTED_MARKET'
    });
    assert(integrity.marketReliability && integrity.marketReliability['1'], 'Market-specific reliability missing');
    assert(integrity.diagnostics['1'].disagreementPp < integrity.maxDisagreementPp, 'Fixture did not create unrelated-market disagreement');

    const professionalAudit = {
        risk: 28,
        teamMatching: { confidence: 100 },
        dataReliability: { score: 83 },
        timing: { status: 'EARLY_WATCHLIST' }
    };
    const reliability = coherence.buildPredictionReliability({
        integrity,
        market: '1',
        professionalAudit,
        sourceAudit: { coveragePct: 75, matchImpactConfidence: 15 }
    });
    assert(reliability.score >= 50 && reliability.score <= 100, 'Reliability score is not finite/usable');
    assert(reliability.factors.selectedMarket === '1', 'Reliability does not use selected market');

    const nonOperational = coherence.buildAnalysisStage({
        candidate: { odd: 6.2, estimatedProb: 23.3, edge_pp: 5.39, theoreticalStake: 0, invested: 0 },
        thresholds: { maxOdd: 5, requiredProbability: 45, requiredEdge: 5, crPassed: true }
    });
    assert(nonOperational.code === 'VALUE_NON_OPERATIVO', 'Value/no-theoretical stage contradiction not resolved');
    assert(nonOperational.reasons.some(reason => reason.includes('quota oltre')) && nonOperational.reasons.some(reason => reason.includes('probabilità sotto')), 'Threshold reasons not explicit');
    const theoreticalOnly = coherence.buildAnalysisStage({ candidate: { odd: 2, estimatedProb: 58, edge_pp: 7, theoreticalStake: 8, invested: 0 } });
    assert(theoreticalOnly.code === 'THEORETICAL_ONLY', 'Theoretical-only lifecycle not represented');
    const operational = coherence.buildAnalysisStage({ candidate: { odd: 2, estimatedProb: 58, edge_pp: 7, theoreticalStake: 8, invested: 3 } });
    assert(operational.code === 'OPERATIONAL_VALUE', 'Operational value lifecycle not represented');

    const backtestHealth = coherence.buildBacktestHealth({ rowsParsed: 2132, eligibleMatches: 1800, leagueCount: 6, historicalOdds: true, chronological: true, asOfSafe: true, productionParity: true });
    assert(backtestHealth.status === 'VALID' && backtestHealth.validationMode === 'MODEL_AND_HISTORICAL_ODDS_VALIDATION', 'Backtest health contract invalid');

    const appSource = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    const appMirror = fs.readFileSync(path.join(ROOT, 'backend', 'public', 'app.js'), 'utf8');
    const indexSource = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const indexMirror = fs.readFileSync(path.join(ROOT, 'backend', 'public', 'index.html'), 'utf8');
    const serverSource = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
    const supportSource = fs.readFileSync(path.join(ROOT, 'tools', 'create-tennis-safe-support-bundle.js'), 'utf8');
    assert(appSource === appMirror && indexSource === indexMirror, 'Frontend mirrors are not byte-identical');
    for (const required of ['DeepScan Calcio — 6 pilastri qualitativi', "Esito consigliato dall'IA", 'Medical & News Check', 'DeepScan Calcio v']) {
        assert(appSource.includes(required), `Compact DeepScan required section missing: ${required}`);
    }
    assert(appSource.includes('Affidabilità totale') && appSource.includes('Diagnostica completa e fonti'), 'Compact reliability/collapsed diagnostics missing');
    assert(indexSource.includes('Qualità / Gate'), 'Analisi AI Quality/Gate column missing');
    assert(appSource.includes('getPortfolioSegmentOptionsBefore87') && appSource.includes("{ key: 'SERIE_A', label: 'Serie A' }"), 'Calcio Portfolio league options not preserved after Step87');
    assert(appSource.includes('0 esiti completati') && appSource.includes('segnali pendenti'), 'Trading pending summaries missing');
    assert(appSource.includes('MIGLIOR PRONOSTICO · ANALISI') && appSource.includes('calcio_theoretical_stake'), 'Trading best forecast/stake lifecycle visibility missing');
    assert(serverSource.includes('backtestHealth') && serverSource.includes('calcio_prediction_reliability_score'), 'Backtest/reliability persistence wiring missing');
    assert(serverSource.includes('VALUE QUALITATIVO · NON OPERATIVO') && serverSource.includes('VIA LIBERA OPERATIVA'), 'Three-stage action coherence missing');

    const assigned = /(?:^|[,{;\s])(?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|secret|password)\s*[:=]\s*["']([^"'\r\n]{12,})["']/igm;
    assert(!assigned.test("const fixture = { seasonToken: 'patch8-fixture-v1' };"), 'Safe-support still flags seasonToken');
    assigned.lastIndex = 0;
    assert(assigned.test("const api" + "Key = 'real-secret-value-12345';"), 'Safe-support no longer detects explicit apiKey');
    assert(supportSource.includes('seasonToken/revisionToken') && supportSource.includes('access[_-]?token'), 'Safe-support scanner patch not present');

    assert(Number(registry.CALCIO_CURRENT_PATCH_VERSION) >= 11, 'Registry regressed below Patch 11');
    const patch = registry.PATCHES.find(row => row.version === '11');
    assert(patch && patch.tennisAuthorityChanged === false && patch.databaseSchemaOnly === true && patch.newOddsApiCalls === 0, 'Patch 11 authority boundaries invalid');

    const checks = [
        'Understat AJAX JSON contract parses named teams',
        'Unavailable current season falls back to previous season',
        'Reliability is market-specific and scored 0-100',
        'Value signal, theoretical eligibility and operational gate are separated',
        'Compact DeepScan preserves required sections and collapses audit detail',
        'Analisi AI exposes Quality/Gate',
        'Trading exposes best forecast, reliability and dual stake',
        'Trading summaries show pending signals without inventing ROI',
        'Portfolio Calcio retains all league filters after Step87 override',
        'Backtest exposes chronological/as-of/production-parity health',
        'Safe Support ignores seasonToken but detects explicit credentials',
        'Frontend mirrors remain byte-identical',
        'Registry advances with schema-only DB migration and Tennis isolation'
    ].map(name => ({ name, ok: true }));

    return {
        success: true,
        patch: 'CALCIO_PATCH_11',
        version: 'CALCIO_PATCH_11_FULL_PROGRAM_COHERENCE_UI_ANALYTICS_SUPPORT',
        diagnostics: {
            understat: { calls, state: understatState, parsed: parsedAjax.metadata },
            probability: { globalReliability: integrity.reliability, marketReliability: integrity.marketReliability, selectedDisagreementPp: integrity.diagnostics['1'].disagreementPp, maxDisagreementPp: integrity.maxDisagreementPp },
            reliability,
            stages: { nonOperational, theoreticalOnly, operational },
            backtestHealth
        },
        checks
    };
}

module.exports = { ROOT, buildAjaxTeams, runPatch11Checks };
