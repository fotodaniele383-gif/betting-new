'use strict';

const fs = require('fs');
const path = require('path');
const teamSnapshot = require('./calcioTeamSnapshot');
const opponentForm = require('./calcioOpponentAdjustedForm');
const quant = require('./calcioQuantEngine');

const CALCIO_WALK_FORWARD_VERSION = 'CALCIO_PATCH_9_WALK_FORWARD_CALIBRATION_V1';
const DEFAULT_WARMUP_FRACTION = 0.20;
const DEFAULT_CALIBRATION_FRACTION = 0.50;
const DEFAULT_MIN_WARMUP_MATCHES = 60;
const DEFAULT_BASE_PRIOR_MATCHES = 5;
const DEFAULT_PROMOTION_MIN_MATCHES = 300;

const LEAGUES = Object.freeze([
    Object.freeze({ code: 'I1', key: 'serie_a', name: 'Serie A' }),
    Object.freeze({ code: 'I2', key: 'serie_b', name: 'Serie B' }),
    Object.freeze({ code: 'E0', key: 'premier_league', name: 'Premier League' }),
    Object.freeze({ code: 'SP1', key: 'la_liga', name: 'La Liga' }),
    Object.freeze({ code: 'F1', key: 'ligue_1', name: 'Ligue 1' }),
    Object.freeze({ code: 'D1', key: 'bundesliga', name: 'Bundesliga' })
]);

const DEFAULT_CANDIDATE_GRID = Object.freeze({
    priorMatches: Object.freeze([4, 6, 8]),
    recencyDecay: Object.freeze([0.82, 0.86, 0.90]),
    adjustmentCap: Object.freeze([0.05, 0.08]),
    window: Object.freeze([8, 10])
});

const preparedDatasetCache = new WeakMap();

function finite(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, finite(value, min)));
}

function round(value, decimals = 6) {
    const n = finite(value, null);
    return n === null ? null : Number(n.toFixed(decimals));
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function buildCandidateGrid(grid = DEFAULT_CANDIDATE_GRID) {
    const candidates = [];
    for (const priorMatches of grid.priorMatches || []) {
        for (const recencyDecay of grid.recencyDecay || []) {
            for (const adjustmentCap of grid.adjustmentCap || []) {
                for (const window of grid.window || []) {
                    candidates.push(Object.freeze({
                        priorMatches: Number(priorMatches),
                        recencyDecay: Number(recencyDecay),
                        adjustmentCap: Number(adjustmentCap),
                        window: Number(window),
                        evidenceBlend: 0.65
                    }));
                }
            }
        }
    }
    return candidates;
}

function readJson(file, fallback = null) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
}

function resolveDataDir(root, options = {}) {
    return path.resolve(options.dataDir || path.join(root, 'backend', 'data', 'calcio_football_data'));
}

function loadLeagueDatasets(root, options = {}) {
    const dataDir = resolveDataDir(root, options);
    const manifest = readJson(path.join(dataDir, 'manifest.json'), {});
    const datasets = [];
    const errors = [];
    for (const league of LEAGUES) {
        const csvPath = path.join(dataDir, `${league.code}.csv`);
        if (!fs.existsSync(csvPath)) {
            errors.push({ code: league.code, league: league.name, error: 'CSV_MISSING', path: csvPath });
            continue;
        }
        try {
            const csvData = fs.readFileSync(csvPath, 'utf8');
            const metadata = readJson(path.join(dataDir, `${league.code}.meta.json`), {});
            const revisionToken = metadata?.sha256?.slice?.(0, 24) || metadata?.revisionToken || manifest?.revisionToken || '';
            const index = teamSnapshot.getLeagueIndex({ csvData, leagueName: league.name, code: league.code, revisionToken });
            if (!index.matches.length) throw new Error('NO_VALID_MATCHES');
            datasets.push({ ...league, csvPath, metadata, index });
        } catch (error) {
            errors.push({ code: league.code, league: league.name, error: error.message, path: csvPath });
        }
    }
    return { dataDir, manifest, datasets, errors };
}

function posteriorMean(value, sample, prior, strength = DEFAULT_BASE_PRIOR_MATCHES) {
    const n = Math.max(0, finite(sample, 0));
    const observed = finite(value, prior);
    return ((Math.max(0.05, observed) * n) + (Math.max(0.05, prior) * strength)) / Math.max(1, n + strength);
}

function buildBaseExpectedGoals(index, match, cutoff, options = {}) {
    const prior = opponentForm.calculateLeaguePriorAtCutoff(index, cutoff);
    const snapshots = teamSnapshot.buildMatchSnapshots(index, match.home, match.away, cutoff);
    const priorStrength = clamp(options.basePriorMatches ?? DEFAULT_BASE_PRIOR_MATCHES, 2, 12);
    const homeVenue = snapshots.home.home || {};
    const awayVenue = snapshots.away.away || {};

    const homeAttack = posteriorMean(homeVenue.goalsForPerMatch, homeVenue.sample, prior.homeGoalsPerMatch, priorStrength);
    const awayDefense = posteriorMean(awayVenue.goalsAgainstPerMatch, awayVenue.sample, prior.homeGoalsPerMatch, priorStrength);
    const awayAttack = posteriorMean(awayVenue.goalsForPerMatch, awayVenue.sample, prior.awayGoalsPerMatch, priorStrength);
    const homeDefense = posteriorMean(homeVenue.goalsAgainstPerMatch, homeVenue.sample, prior.awayGoalsPerMatch, priorStrength);

    const expHomeGoals = clamp(Math.sqrt(homeAttack * awayDefense), 0.20, 4.50);
    const expAwayGoals = clamp(Math.sqrt(awayAttack * homeDefense), 0.15, 4.00);
    return {
        expHomeGoals: round(expHomeGoals, 5),
        expAwayGoals: round(expAwayGoals, 5),
        prior,
        samples: {
            homeVenue: homeVenue.sample || 0,
            awayVenue: awayVenue.sample || 0
        },
        contract: 'PATCH7_NEUTRAL_BASELINE_ISOLATING_PATCH8_INCREMENT'
    };
}

function rhoForLeague(name = '') {
    const map = {
        'Serie A': -0.12,
        'Serie B': -0.14,
        'La Liga': -0.10,
        'Ligue 1': -0.11,
        Bundesliga: -0.06,
        'Premier League': -0.08
    };
    return map[name] ?? -0.10;
}

function probabilityVector(homeGoals, awayGoals, leagueName) {
    const probs = quant.getDixonColesProbabilities(homeGoals, awayGoals, rhoForLeague(leagueName));
    const vector = [finite(probs['1'], 33.33), finite(probs.X, 33.33), finite(probs['2'], 33.34)].map(value => Math.max(1e-9, value / 100));
    const total = vector.reduce((sum, value) => sum + value, 0) || 1;
    return vector.map(value => value / total);
}

function actualOutcome(match) {
    if (match.homeGoals > match.awayGoals) return 0;
    if (match.homeGoals === match.awayGoals) return 1;
    return 2;
}

function emptyAccumulator() {
    return {
        matches: 0,
        logLoss: 0,
        brier: 0,
        rps: 0,
        homeGoalsMae: 0,
        awayGoalsMae: 0,
        totalGoalsMae: 0,
        correct: 0,
        calibration: Array.from({ length: 10 }, () => ({ sample: 0, predicted: 0, observed: 0 }))
    };
}

function addPrediction(acc, probabilities, match, expectedGoals) {
    const actual = actualOutcome(match);
    const p = probabilities.map(value => clamp(value, 1e-9, 1));
    const oneHot = [0, 0, 0]; oneHot[actual] = 1;
    acc.matches += 1;
    acc.logLoss += -Math.log(p[actual]);
    acc.brier += p.reduce((sum, value, index) => sum + Math.pow(value - oneHot[index], 2), 0) / 3;
    const cdfP1 = p[0], cdfP2 = p[0] + p[1];
    const cdfO1 = oneHot[0], cdfO2 = oneHot[0] + oneHot[1];
    acc.rps += (Math.pow(cdfP1 - cdfO1, 2) + Math.pow(cdfP2 - cdfO2, 2)) / 2;
    acc.homeGoalsMae += Math.abs(expectedGoals.expHomeGoals - match.homeGoals);
    acc.awayGoalsMae += Math.abs(expectedGoals.expAwayGoals - match.awayGoals);
    acc.totalGoalsMae += Math.abs((expectedGoals.expHomeGoals + expectedGoals.expAwayGoals) - (match.homeGoals + match.awayGoals));
    const predicted = p.indexOf(Math.max(...p));
    if (predicted === actual) acc.correct += 1;
    const maxP = p[predicted];
    const bucket = Math.min(9, Math.floor(maxP * 10));
    acc.calibration[bucket].sample += 1;
    acc.calibration[bucket].predicted += maxP;
    acc.calibration[bucket].observed += predicted === actual ? 1 : 0;
}

function finalizeAccumulator(acc) {
    const n = Math.max(1, acc.matches);
    let ece = 0;
    const buckets = acc.calibration.map((bucket, index) => {
        const sample = bucket.sample;
        const predicted = sample ? bucket.predicted / sample : null;
        const observed = sample ? bucket.observed / sample : null;
        if (sample) ece += (sample / n) * Math.abs(predicted - observed);
        return {
            range: `${index * 10}-${(index + 1) * 10}%`,
            sample,
            predictedPct: predicted === null ? null : round(predicted * 100, 2),
            observedPct: observed === null ? null : round(observed * 100, 2)
        };
    });
    return {
        matches: acc.matches,
        logLoss: round(acc.logLoss / n),
        brierScore: round(acc.brier / n),
        rankedProbabilityScore: round(acc.rps / n),
        expectedCalibrationError: round(ece),
        homeGoalsMae: round(acc.homeGoalsMae / n),
        awayGoalsMae: round(acc.awayGoalsMae / n),
        totalGoalsMae: round(acc.totalGoalsMae / n),
        accuracyPct: round((acc.correct / n) * 100, 2),
        calibrationBuckets: buckets
    };
}

function percentImprovement(championValue, challengerValue) {
    const base = finite(championValue, 0);
    if (base <= 0) return null;
    return round(((base - finite(challengerValue, base)) / base) * 100, 4);
}

function compareMetrics(champion, challenger) {
    return {
        logLossImprovementPct: percentImprovement(champion.logLoss, challenger.logLoss),
        brierImprovementPct: percentImprovement(champion.brierScore, challenger.brierScore),
        rpsImprovementPct: percentImprovement(champion.rankedProbabilityScore, challenger.rankedProbabilityScore),
        calibrationImprovementPct: percentImprovement(champion.expectedCalibrationError, challenger.expectedCalibrationError),
        totalGoalsMaeImprovementPct: percentImprovement(champion.totalGoalsMae, challenger.totalGoalsMae),
        accuracyDeltaPp: round(challenger.accuracyPct - champion.accuracyPct, 3)
    };
}

function makeSplit(index, options = {}) {
    const total = index.matches.length;
    const warmup = Math.min(total - 2, Math.max(options.minWarmupMatches ?? DEFAULT_MIN_WARMUP_MATCHES, Math.floor(total * (options.warmupFraction ?? DEFAULT_WARMUP_FRACTION))));
    const remaining = Math.max(0, total - warmup);
    const calibrationCount = Math.max(1, Math.floor(remaining * (options.calibrationFraction ?? DEFAULT_CALIBRATION_FRACTION)));
    return {
        warmupEnd: warmup,
        calibrationEnd: Math.min(total, warmup + calibrationCount),
        total
    };
}

function phaseForIndex(matchIndex, split) {
    if (matchIndex < split.warmupEnd) return 'WARMUP';
    if (matchIndex < split.calibrationEnd) return 'CALIBRATION';
    return 'HOLDOUT';
}

function upperBoundByDate(items, cutoffMs) {
    let low = 0;
    let high = items.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (items[mid].date.getTime() < cutoffMs) low = mid + 1;
        else high = mid;
    }
    return low;
}

function fastTeamForm(evidence, team, cutoffMs, config) {
    const all = evidence.byTeam.get(team) || [];
    const end = upperBoundByDate(all, cutoffMs);
    const window = Math.max(3, Math.min(20, finite(config.window, opponentForm.DEFAULT_FORM_WINDOW)));
    const priorMatches = Math.max(2, Math.min(12, finite(config.priorMatches, opponentForm.DEFAULT_PRIOR_MATCHES)));
    const recencyDecay = clamp(config.recencyDecay ?? opponentForm.DEFAULT_RECENCY_DECAY, 0.70, 0.98);
    const start = Math.max(0, end - window);
    let weight = 1;
    let weightTotal = 0;
    let attackWeighted = 0;
    let defenseWeighted = 0;
    let scheduleWeighted = 0;
    for (let i = end - 1; i >= start; i--) {
        const item = all[i];
        attackWeighted += item.attackObservation * weight;
        defenseWeighted += item.defenseObservation * weight;
        scheduleWeighted += Math.sqrt(item.opponentAttackStrength * item.opponentDefenseWeakness) * weight;
        weightTotal += weight;
        weight *= recencyDecay;
    }
    const sample = end - start;
    const rawAttackIndex = weightTotal > 0 ? attackWeighted / weightTotal : 1;
    const rawDefenseWeakness = weightTotal > 0 ? defenseWeighted / weightTotal : 1;
    return {
        sample,
        rawAttackIndex,
        rawDefenseWeakness,
        attackIndex: ((rawAttackIndex * sample) + priorMatches) / (sample + priorMatches),
        defenseWeaknessIndex: ((rawDefenseWeakness * sample) + priorMatches) / (sample + priorMatches),
        strengthOfSchedule: weightTotal > 0 ? scheduleWeighted / weightTotal : 1,
        priorMatches
    };
}

function fastAdjustment(prepared, event, config) {
    const home = fastTeamForm(prepared.evidence, event.match.home, event.cutoffMs, config);
    const away = fastTeamForm(prepared.evidence, event.match.away, event.cutoffMs, config);
    const minSample = Math.min(home.sample, away.sample);
    const priorMatches = Math.max(home.priorMatches, away.priorMatches);
    const sampleAuthority = minSample <= 0 ? 0 : minSample / (minSample + priorMatches);
    const evidenceBlend = clamp(config.evidenceBlend ?? 0.65, 0.25, 0.85);
    const authority = clamp(sampleAuthority * evidenceBlend, 0, 0.65);
    const rawHomeFactor = Math.sqrt(home.attackIndex * away.defenseWeaknessIndex);
    const rawAwayFactor = Math.sqrt(away.attackIndex * home.defenseWeaknessIndex);
    const cap = clamp(config.adjustmentCap ?? opponentForm.DEFAULT_ADJUSTMENT_CAP, 0.02, 0.12);
    const homeFactor = clamp(1 + ((rawHomeFactor - 1) * authority), 1 - cap, 1 + cap);
    const awayFactor = clamp(1 + ((rawAwayFactor - 1) * authority), 1 - cap, 1 + cap);
    return {
        homeFactor,
        awayFactor,
        status: minSample === 0 ? 'PRIOR_ONLY' : (minSample < priorMatches ? 'EARLY_SEASON' : (minSample < config.window ? 'PARTIAL' : 'MATURE')),
        minSample
    };
}

function prepareDataset(dataset, options = {}) {
    const cacheKey = JSON.stringify({
        warmupFraction: options.warmupFraction ?? DEFAULT_WARMUP_FRACTION,
        calibrationFraction: options.calibrationFraction ?? DEFAULT_CALIBRATION_FRACTION,
        minWarmupMatches: options.minWarmupMatches ?? DEFAULT_MIN_WARMUP_MATCHES,
        basePriorMatches: options.basePriorMatches ?? DEFAULT_BASE_PRIOR_MATCHES
    });
    const cached = preparedDatasetCache.get(dataset.index);
    if (cached?.key === cacheKey) return cached.value;
    const split = makeSplit(dataset.index, options);
    const evidence = opponentForm.buildEvidenceIndex(dataset.index);
    const events = [];
    for (let i = split.warmupEnd; i < dataset.index.matches.length; i++) {
        const match = dataset.index.matches[i];
        const base = buildBaseExpectedGoals(dataset.index, match, match.date, options);
        events.push({
            index: i,
            phase: phaseForIndex(i, split),
            match,
            cutoffMs: match.date.getTime(),
            base,
            championProb: probabilityVector(base.expHomeGoals, base.expAwayGoals, dataset.name)
        });
    }
    const value = { split, evidence, events };
    preparedDatasetCache.set(dataset.index, { key: cacheKey, value });
    return value;
}

function evaluateDataset(dataset, config, options = {}) {
    const prepared = prepareDataset(dataset, options);
    const requestedPhase = options.phase || 'ALL_EVALUATION';
    const champion = emptyAccumulator();
    const challenger = emptyAccumulator();
    const statusCounts = {};

    for (const event of prepared.events) {
        if (requestedPhase !== 'ALL_EVALUATION' && event.phase !== requestedPhase) continue;
        const adjustment = fastAdjustment(prepared, event, config);
        const adjusted = {
            expHomeGoals: round(event.base.expHomeGoals * adjustment.homeFactor, 5),
            expAwayGoals: round(event.base.expAwayGoals * adjustment.awayFactor, 5)
        };
        const challengerProb = probabilityVector(adjusted.expHomeGoals, adjusted.expAwayGoals, dataset.name);
        addPrediction(champion, event.championProb, event.match, event.base);
        addPrediction(challenger, challengerProb, event.match, adjusted);
        statusCounts[adjustment.status] = (statusCounts[adjustment.status] || 0) + 1;
    }

    const championFinal = finalizeAccumulator(champion);
    const challengerFinal = finalizeAccumulator(challenger);
    return {
        league: dataset.name,
        code: dataset.code,
        split: prepared.split,
        phase: requestedPhase,
        champion: championFinal,
        challenger: challengerFinal,
        comparison: compareMetrics(championFinal, challengerFinal),
        statusCounts
    };
}

function aggregateEvaluations(evaluations = []) {
    const champion = emptyAccumulator();
    const challenger = emptyAccumulator();
    // Re-evaluate from weighted finalized values to avoid retaining every match.
    for (const evaluation of evaluations) {
        const n = evaluation.champion.matches;
        if (!n) continue;
        champion.matches += n;
        champion.logLoss += evaluation.champion.logLoss * n;
        champion.brier += evaluation.champion.brierScore * n;
        champion.rps += evaluation.champion.rankedProbabilityScore * n;
        champion.homeGoalsMae += evaluation.champion.homeGoalsMae * n;
        champion.awayGoalsMae += evaluation.champion.awayGoalsMae * n;
        champion.totalGoalsMae += evaluation.champion.totalGoalsMae * n;
        champion.correct += (evaluation.champion.accuracyPct / 100) * n;
        challenger.matches += n;
        challenger.logLoss += evaluation.challenger.logLoss * n;
        challenger.brier += evaluation.challenger.brierScore * n;
        challenger.rps += evaluation.challenger.rankedProbabilityScore * n;
        challenger.homeGoalsMae += evaluation.challenger.homeGoalsMae * n;
        challenger.awayGoalsMae += evaluation.challenger.awayGoalsMae * n;
        challenger.totalGoalsMae += evaluation.challenger.totalGoalsMae * n;
        challenger.correct += (evaluation.challenger.accuracyPct / 100) * n;
    }
    const n = Math.max(1, champion.matches);
    const championFinal = {
        matches: champion.matches,
        logLoss: round(champion.logLoss / n),
        brierScore: round(champion.brier / n),
        rankedProbabilityScore: round(champion.rps / n),
        expectedCalibrationError: round(evaluations.reduce((sum, item) => sum + (finite(item.champion.expectedCalibrationError, 0) * item.champion.matches), 0) / n),
        homeGoalsMae: round(champion.homeGoalsMae / n),
        awayGoalsMae: round(champion.awayGoalsMae / n),
        totalGoalsMae: round(champion.totalGoalsMae / n),
        accuracyPct: round((champion.correct / n) * 100, 2)
    };
    const challengerFinal = {
        matches: challenger.matches,
        logLoss: round(challenger.logLoss / n),
        brierScore: round(challenger.brier / n),
        rankedProbabilityScore: round(challenger.rps / n),
        expectedCalibrationError: round(evaluations.reduce((sum, item) => sum + (finite(item.challenger.expectedCalibrationError, 0) * item.challenger.matches), 0) / n),
        homeGoalsMae: round(challenger.homeGoalsMae / n),
        awayGoalsMae: round(challenger.awayGoalsMae / n),
        totalGoalsMae: round(challenger.totalGoalsMae / n),
        accuracyPct: round((challenger.correct / n) * 100, 2)
    };
    return { champion: championFinal, challenger: challengerFinal, comparison: compareMetrics(championFinal, challengerFinal) };
}

function scoreCandidate(aggregate) {
    const c = aggregate.comparison;
    return round(
        (finite(c.logLossImprovementPct, -100) * 0.35) +
        (finite(c.brierImprovementPct, -100) * 0.25) +
        (finite(c.rpsImprovementPct, -100) * 0.20) +
        (finite(c.calibrationImprovementPct, -100) * 0.10) +
        (finite(c.totalGoalsMaeImprovementPct, -100) * 0.10),
        6
    );
}

function evaluateConfigAcrossDatasets(datasets, config, options = {}) {
    const leagues = datasets.map(dataset => evaluateDataset(dataset, config, options));
    const aggregate = aggregateEvaluations(leagues);
    return { config, phase: options.phase || 'ALL_EVALUATION', leagues, aggregate, score: scoreCandidate(aggregate) };
}

function recommendationForHoldout(result, options = {}) {
    const aggregate = result.aggregate;
    const comparison = aggregate.comparison;
    const minMatches = options.promotionMinMatches ?? DEFAULT_PROMOTION_MIN_MATCHES;
    const positiveLeagues = result.leagues.filter(item => finite(item.comparison.logLossImprovementPct, -999) > 0).length;
    const severeRegressions = result.leagues.filter(item => finite(item.comparison.logLossImprovementPct, 0) < -1.5).map(item => item.code);
    let status = 'HOLD_SHADOW';
    const reasons = [];
    if (aggregate.champion.matches < minMatches) {
        status = 'INSUFFICIENT_SAMPLE';
        reasons.push(`Holdout ${aggregate.champion.matches} < minimo ${minMatches}.`);
    } else if (finite(comparison.logLossImprovementPct, -999) < -0.25 || finite(comparison.brierImprovementPct, -999) < -0.50) {
        status = 'REJECT';
        reasons.push('Regressione fuori campione sulle metriche probabilistiche principali.');
    } else if (severeRegressions.length) {
        status = 'HOLD_SHADOW';
        reasons.push(`Regressione >1,5% in: ${severeRegressions.join(', ')}.`);
    } else if (finite(comparison.calibrationImprovementPct, 0) < -25) {
        status = 'HOLD_SHADOW';
        reasons.push('Calibration error peggiorato oltre il limite prudenziale del 25%.');
    } else if (
        finite(comparison.logLossImprovementPct, -999) >= 0.50 &&
        finite(comparison.brierImprovementPct, -999) >= 0 &&
        finite(comparison.rpsImprovementPct, -999) >= 0 &&
        positiveLeagues >= Math.ceil(result.leagues.length * 2 / 3)
    ) {
        status = 'PROMOTE_WITH_CAP';
        reasons.push('Miglioramento fuori campione coerente; promozione consigliata solo con cap prudenziale e canary.');
    } else {
        reasons.push('Evidenza fuori campione non sufficiente per modificare automaticamente il modello production.');
    }
    return {
        status,
        reasons,
        holdoutMatches: aggregate.champion.matches,
        positiveLeagues,
        totalLeagues: result.leagues.length,
        severeRegressionLeagues: severeRegressions,
        automaticProductionChange: false,
        stakeAuthorityChanged: false
    };
}

function runWalkForward(root, options = {}) {
    const loaded = loadLeagueDatasets(root, options);
    if (!loaded.datasets.length) throw new Error(`Nessun dataset football-data utilizzabile in ${loaded.dataDir}`);
    const config = {
        priorMatches: options.priorMatches ?? opponentForm.DEFAULT_PRIOR_MATCHES,
        recencyDecay: options.recencyDecay ?? opponentForm.DEFAULT_RECENCY_DECAY,
        adjustmentCap: options.adjustmentCap ?? opponentForm.DEFAULT_ADJUSTMENT_CAP,
        window: options.window ?? opponentForm.DEFAULT_FORM_WINDOW,
        evidenceBlend: options.evidenceBlend ?? 0.65
    };
    const calibration = evaluateConfigAcrossDatasets(loaded.datasets, config, { ...options, phase: 'CALIBRATION' });
    const holdout = evaluateConfigAcrossDatasets(loaded.datasets, config, { ...options, phase: 'HOLDOUT' });
    return {
        success: true,
        version: CALCIO_WALK_FORWARD_VERSION,
        mode: 'SHADOW_ONLY_NO_MODEL_NO_STAKE',
        generatedAt: new Date().toISOString(),
        data: {
            dataDir: loaded.dataDir,
            leagues: loaded.datasets.map(item => ({ code: item.code, name: item.name, matches: item.index.matches.length, revisionToken: item.index.revisionToken })),
            errors: loaded.errors
        },
        config,
        calibration,
        holdout,
        recommendation: recommendationForHoldout(holdout, options),
        safeguards: {
            chronologicalCutoffPerMatch: true,
            futureRowsExcluded: true,
            holdoutNeverSelectsParameters: true,
            databaseReadOnly: true,
            newApiCalls: 0,
            productionProbabilityChanged: false,
            stakeChanged: false
        }
    };
}

function runCalibration(root, options = {}) {
    const loaded = loadLeagueDatasets(root, options);
    if (!loaded.datasets.length) throw new Error(`Nessun dataset football-data utilizzabile in ${loaded.dataDir}`);
    const candidates = options.candidates || buildCandidateGrid(options.grid || DEFAULT_CANDIDATE_GRID);
    if (!candidates.length) throw new Error('Griglia calibrazione vuota');
    const evaluated = [];
    for (const config of candidates) {
        const result = evaluateConfigAcrossDatasets(loaded.datasets, config, { ...options, phase: 'CALIBRATION' });
        evaluated.push({ config, score: result.score, aggregate: result.aggregate, perLeague: result.leagues.map(item => ({ code: item.code, comparison: item.comparison, matches: item.champion.matches })) });
    }
    evaluated.sort((a, b) => b.score - a.score || stableStringify(a.config).localeCompare(stableStringify(b.config)));
    const selected = evaluated[0];
    const holdout = evaluateConfigAcrossDatasets(loaded.datasets, selected.config, { ...options, phase: 'HOLDOUT' });
    return {
        success: true,
        version: CALCIO_WALK_FORWARD_VERSION,
        mode: 'SHADOW_ONLY_GRID_SELECTION_ON_CALIBRATION_HOLDOUT_LOCKED',
        generatedAt: new Date().toISOString(),
        data: {
            dataDir: loaded.dataDir,
            leagueCount: loaded.datasets.length,
            matchCount: loaded.datasets.reduce((sum, item) => sum + item.index.matches.length, 0),
            errors: loaded.errors
        },
        grid: {
            candidateCount: candidates.length,
            definition: options.grid || DEFAULT_CANDIDATE_GRID
        },
        selected: {
            config: selected.config,
            calibrationScore: selected.score,
            calibration: selected.aggregate
        },
        leaderboard: evaluated.slice(0, options.leaderboardSize || 10),
        holdout,
        recommendation: recommendationForHoldout(holdout, options),
        safeguards: {
            parameterSelectionUsesCalibrationOnly: true,
            holdoutLocked: true,
            chronologicalCutoffPerMatch: true,
            futureRowsExcluded: true,
            noAutomaticPromotion: true,
            databaseReadOnly: true,
            newApiCalls: 0,
            productionProbabilityChanged: false,
            stakeChanged: false
        }
    };
}

module.exports = {
    CALCIO_WALK_FORWARD_VERSION,
    DEFAULT_CANDIDATE_GRID,
    LEAGUES,
    buildCandidateGrid,
    loadLeagueDatasets,
    buildBaseExpectedGoals,
    probabilityVector,
    makeSplit,
    evaluateDataset,
    evaluateConfigAcrossDatasets,
    compareMetrics,
    recommendationForHoldout,
    runWalkForward,
    runCalibration,
    _private: { posteriorMean, actualOutcome, phaseForIndex, scoreCandidate, stableStringify, prepareDataset, fastTeamForm, fastAdjustment }
};
