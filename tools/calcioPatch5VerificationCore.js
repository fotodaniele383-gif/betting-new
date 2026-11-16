'use strict';

const fs = require('fs');
const path = require('path');
const quant = require('../backend/calcioQuantEngine');
const integrity = require('../backend/calcioProbabilityIntegrity');
const registry = require('../backend/calcioPatchRegistry');

function assert(condition, message, details = null) {
    if (!condition) {
        const error = new Error(message);
        error.details = details;
        throw error;
    }
}

function approx(actual, expected, tolerance, label) {
    const delta = Math.abs(Number(actual) - Number(expected));
    assert(delta <= tolerance, `${label}: delta ${delta} > ${tolerance}`, { actual, expected, delta, tolerance });
}

function buildProxyMatches() {
    const goalsFor = [2, 1, 3, 1, 2, 0, 2, 1, 3, 2];
    const goalsAgainst = [1, 1, 0, 2, 1, 2, 1, 0, 1, 1];
    return goalsFor.map((value, index) => ({
        goalsFor: value,
        goalsAgainst: goalsAgainst[index],
        shots: 11 + (index % 4),
        shotsOnTarget: 4 + (index % 2),
        shotsAgainst: 9 + (index % 3),
        shotsOnTargetAgainst: 3 + (index % 2)
    }));
}

function runCalcioPatch5Verification(projectRoot = path.resolve(__dirname, '..')) {
    const checks = [];
    function check(name, fn) {
        const value = fn();
        checks.push({ name, ok: true });
        return value;
    }

    const proxyMatches = buildProxyMatches();
    const proxyResult = check('Missing xG uses goal/shot proxy and never null-to-zero collapse', () => {
        const result = quant.getXGAdjustedDixonColesProbabilities({
            homeStats: { teamName: 'Home', seasonXGFor: null, seasonXGAgainst: null, matches: proxyMatches },
            awayStats: { teamName: 'Away', seasonXGFor: null, seasonXGAgainst: null, matches: proxyMatches.map(row => ({
                ...row,
                goalsFor: row.goalsAgainst,
                goalsAgainst: row.goalsFor
            })) },
            leagueName: 'Serie A',
            goalBasedHome: 1.50,
            goalBasedAway: 1.10,
            xgWeight: 0.20
        });
        assert(result.xg.evidenceMode === 'GOAL_SHOT_PROXY', 'Expected GOAL_SHOT_PROXY', result.xg);
        assert(result.expHomeGoals > 0.75 && result.expAwayGoals > 0.60, 'Expected goals collapsed implausibly', result);
        assert(result.xg.homeProfile.recentXG > 0.50, 'Home proxy xG collapsed', result.xg.homeProfile);
        return result;
    });

    check('Requested 20% xG weight is not forced to legacy 45% floor', () => {
        assert(proxyResult.xg.weightRequested === 0.2, 'Requested weight changed', proxyResult.xg);
        assert(proxyResult.xg.weightUsed > 0 && proxyResult.xg.weightUsed < 0.20, 'Proxy weight must be prudent and below request', proxyResult.xg);
    });

    const realXgResult = check('Real xG remains authoritative with high evidence weight', () => {
        const result = quant.getXGAdjustedDixonColesProbabilities({
            homeStats: { teamName: 'Home', seasonXGFor: 1.72, seasonXGAgainst: 1.02, matches: proxyMatches.map(row => ({ ...row, xG: 1.65, xGA: 1.00 })) },
            awayStats: { teamName: 'Away', seasonXGFor: 1.20, seasonXGAgainst: 1.48, matches: proxyMatches.map(row => ({ ...row, xG: 1.18, xGA: 1.46 })) },
            leagueName: 'Serie A',
            goalBasedHome: 1.55,
            goalBasedAway: 1.05,
            xgWeight: 0.75
        });
        assert(result.xg.evidenceMode === 'REAL_XG', 'Expected REAL_XG', result.xg);
        assert(result.xg.weightUsed > 0.55 && result.xg.weightUsed <= 0.85, 'Real xG weight unexpectedly weak/strong', result.xg);
        return result;
    });

    const analytic = quant.getDixonColesProbabilities(1.50, 1.10, 0);
    const mcAnalytic = check('Monte Carlo converges to analytic independent Poisson when shocks are disabled', () => {
        const result = quant.runMonteCarlo({}, 80000, {
            expHomeGoals: 1.50,
            expAwayGoals: 1.10,
            redCardRisk: 0,
            injuryRisk: 0,
            weatherNoise: 0,
            tempoNoise: 0,
            volatilityFactor: 1,
            seed: 'PATCH5_ANALYTIC_AUDIT'
        });
        approx(result.homeWinProb * 100, analytic['1'], 0.85, 'Home MC vs analytic');
        approx(result.drawProb * 100, analytic.X, 0.85, 'Draw MC vs analytic');
        approx(result.awayWinProb * 100, analytic['2'], 0.85, 'Away MC vs analytic');
        approx(result.over2_5Prob * 100, analytic['O2.5'], 0.85, 'O2.5 MC vs analytic');
        approx(result.golProb * 100, analytic.GG, 0.85, 'GG MC vs analytic');
        return result;
    });

    check('Monte Carlo is deterministic per seed and exposes assumptions', () => {
        const options = {
            expHomeGoals: 1.42,
            expAwayGoals: 1.08,
            seed: 'MILAN|ROMA|2026-08-20',
            redCardRisk: 0.05,
            injuryRisk: 0.03,
            weatherNoise: 0.02,
            tempoNoise: 0.18
        };
        const a = quant.runMonteCarlo({}, 12000, options);
        const b = quant.runMonteCarlo({}, 12000, options);
        assert(JSON.stringify(a) === JSON.stringify(b), 'Same seed must be byte-deterministic');
        assert(a.simulationAssumptions.tempoNoise === 0.18, 'Assumptions missing', a.simulationAssumptions);
        assert(a.seed === b.seed, 'Normalized seed mismatch');
    });

    check('Different match seeds do not reuse the same simulation stream', () => {
        const common = { expHomeGoals: 1.42, expAwayGoals: 1.08 };
        const a = quant.runMonteCarlo({}, 10000, { ...common, seed: 'MATCH_A' });
        const b = quant.runMonteCarlo({}, 10000, { ...common, seed: 'MATCH_B' });
        assert(JSON.stringify(a.scoreDistribution) !== JSON.stringify(b.scoreDistribution), 'Different seeds reused identical score distribution');
        approx(a.homeWinProb, b.homeWinProb, 0.03, 'Different seeds should remain statistically coherent');
    });

    const consensus = check('Probability consensus normalizes all market groups and keeps source diagnostics', () => {
        const mc = quant.runMonteCarlo(realXgResult.probabilities, 20000, {
            expHomeGoals: realXgResult.expHomeGoals,
            expAwayGoals: realXgResult.expAwayGoals,
            seed: 'CONSENSUS'
        });
        const result = integrity.buildCalcioProbabilityIntegrity({
            modelProbabilities: realXgResult.probabilities,
            mcResult: mc,
            marketFairOdds: { '1': 2.10, X: 3.45, '2': 3.70, 'O2.5': 1.95, 'U2.5': 2.05 },
            coverage: { homeMatched: true, awayMatched: true, homeSample: 12, awaySample: 12, xgEvidenceMode: 'REAL_XG' },
            iterations: 20000,
            seed: 'CONSENSUS'
        });
        approx(result.probabilities['1'] + result.probabilities.X + result.probabilities['2'], 100, 0.01, '1X2 normalization');
        approx(result.probabilities['O2.5'] + result.probabilities['U2.5'], 100, 0.01, 'Totals normalization');
        approx(result.probabilities.GG + result.probabilities.NG, 100, 0.01, 'BTTS normalization');
        assert(result.marketAnchorUsed === true, 'No-vig market anchor not used');
        assert(result.diagnostics['1'].monteCarloStdErrorPp > 0, 'MC standard error missing');
        assert(['HIGH', 'MEDIUM', 'LOW', 'VERY_LOW'].includes(result.reliability), 'Unexpected reliability', result);
        return result;
    });

    check('Prior-only coverage remains visible but explicitly low authority', () => {
        const mc = quant.runMonteCarlo({}, 10000, { expHomeGoals: 1.45, expAwayGoals: 1.12, seed: 'PRIOR' });
        const result = integrity.buildCalcioProbabilityIntegrity({
            modelProbabilities: { '1': 43, X: 29, '2': 28, 'O2.5': 48, 'U2.5': 52, GG: 51, NG: 49 },
            mcResult: mc,
            marketFairOdds: { '1': 2.20, X: 3.40, '2': 3.50, 'O2.5': 2, 'U2.5': 2 },
            coverage: { homeMatched: false, awayMatched: false, homeSample: 0, awaySample: 0, xgEvidenceMode: 'LEAGUE_PRIOR' },
            iterations: 10000
        });
        assert(result.coverageMode === 'PRIOR_ONLY', 'Expected prior coverage', result);
        assert(result.reliability === 'PRIOR', 'Expected PRIOR reliability', result);
        assert(result.probabilities['1'] > 0, 'Prior forecast was excluded', result);
    });

    check('Best available forecast is returned even when every edge is negative', () => {
        const result = integrity.selectBestAvailableForecast({
            probabilities: { '1': 42, X: 28, '2': 30, 'O2.5': 48, 'U2.5': 52, GG: 50, NG: 50 },
            odds: { '1': 2.20, X: 3.20, '2': 3.10, 'O2.5': 1.85, 'U2.5': 1.80 },
            integrity: consensus
        });
        assert(result.success && result.best, 'No best-available forecast returned', result);
        assert(result.candidates.length >= 5, 'Candidate coverage incomplete', result);
    });

    const serverSource = fs.readFileSync(path.join(projectRoot, 'backend/server.js'), 'utf8');
    check('Server keeps insufficient-data matches visible and uses match-specific Monte Carlo seed', () => {
        assert(serverSource.includes('buildAnalysisOnlyCalcioBet'), 'Analysis-only forecast helper missing');
        assert(serverSource.includes('Miglior pronostico disponibile con dati incompleti'), 'Insufficient-data visibility marker missing');
        assert(serverSource.includes('const mcSeed = buildCalcioMatchSeed(config, m);'), 'Match-specific MC seed missing');
        assert((serverSource.match(/probabilityIntegrity\.probabilities/g) || []).length >= 2, 'Live/backtest consensus probabilities not wired');
        assert(serverSource.includes('const mcSeed = buildCalcioMatchSeed(config, m);'), 'Live match-specific seed not wired');
        assert(serverSource.includes("'CALCIO_PATCH5_BACKTEST'"), 'Backtest match-specific seed not wired');
        assert(!serverSource.includes("reason: 'Campione storico casa/trasferta insufficiente.' });\n                        return;"), 'Legacy insufficient-history exclusion remains');
    });

    const publicApp = fs.readFileSync(path.join(projectRoot, 'public/app.js'), 'utf8');
    const backendApp = fs.readFileSync(path.join(projectRoot, 'backend/public/app.js'), 'utf8');
    check('UI identifies analysis-only best forecast and probability integrity', () => {
        assert(publicApp.includes('MIGLIOR PRONOSTICO · ANALISI'), 'Analysis-only badge missing');
        assert(publicApp.includes('Integrità statistica e probabilistica — Patch 5'), 'Probability integrity panel missing');
        assert(publicApp === backendApp, 'Frontend duplicates differ');
    });

    check('Registry advances to Patch 5 without DB, Tennis or stake authority', () => {
        const status = registry.getCalcioPatchStatus();
        assert(Number(status.currentPatchVersion) >= 5, 'Registry current patch is older than 5', status);
        const patch = status.patches.find(row => row.version === '5');
        assert(patch && patch.databaseMutation === false, 'Patch 5 DB invariant missing', patch);
        assert(patch.tennisAuthorityChanged === false, 'Patch 5 Tennis invariant missing', patch);
        assert(patch.stakeAuthorityChanged === false, 'Patch 5 stake invariant missing', patch);
        assert(patch.insufficientDataExclusionRemoved === true, 'Coverage contract missing', patch);
    });

    return {
        success: true,
        patch: 'CALCIO_PATCH_5',
        version: integrity.CALCIO_PROBABILITY_INTEGRITY_VERSION,
        diagnostics: {
            proxyExpectedGoals: {
                home: proxyResult.expHomeGoals,
                away: proxyResult.expAwayGoals,
                evidenceMode: proxyResult.xg.evidenceMode,
                requestedWeight: proxyResult.xg.weightRequested,
                usedWeight: proxyResult.xg.weightUsed
            },
            realXgWeight: realXgResult.xg.weightUsed,
            analyticMonteCarlo: {
                analytic: {
                    home: analytic['1'],
                    draw: analytic.X,
                    away: analytic['2'],
                    over25: analytic['O2.5'],
                    btts: analytic.GG
                },
                simulated: {
                    home: mcAnalytic.homeWinProb * 100,
                    draw: mcAnalytic.drawProb * 100,
                    away: mcAnalytic.awayWinProb * 100,
                    over25: mcAnalytic.over2_5Prob * 100,
                    btts: mcAnalytic.golProb * 100
                },
                iterations: mcAnalytic.iterations
            },
            consensus: {
                coverageMode: consensus.coverageMode,
                reliability: consensus.reliability,
                maxDisagreementPp: consensus.maxDisagreementPp,
                maxMonteCarloStdErrorPp: consensus.maxMonteCarloStdErrorPp
            }
        },
        checks
    };
}

module.exports = {
    runCalcioPatch5Verification
};
