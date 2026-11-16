// ============================================================================
// AI BETTING QUANT PRO - CALCIO QUANT ENGINE
// File: backend/calcioQuantEngine.js
// Versione: 5.1
// ============================================================================
//
// CHANGELOG 5.0
// - Corretto plattScale: eliminato segno errato che comprimeva/invertiva le probabilità.
// - Corretto Elo 1X2: il pareggio non viene più calcolato come residuo impossibile.
// - Aggiunto modello Elo con draw probability dinamica.
// - Monte Carlo seedato e riproducibile.
// - Monte Carlo più coerente: simula scoreline da expected goals quando disponibili.
// - Over/Under e GG/NG ora derivano dalla stessa simulazione goal-based.
// - Aggiunti helpers edge_pp / ev_pct.
// - Mantenuta compatibilità con server.js v14+.
// - Mantenuta compatibilità con value_evaluator.js v8+.
// - Mantenuta compatibilità con vecchi export.
// - Nessun uso dello storico DB in questo file.
//
// CHANGELOG 5.1
// - Fix sintassi: rimossa doppia dichiarazione calculateEdgePp/calculateEvPct.
// - Mantenuta una sola implementazione standardizzata nella sezione market helpers.
// - Aggiunto alias calculateExpectedValuePct per compatibilità con naming value evaluator.
// - Nessuna modifica alla logica matematica del motore.
//
// CALCIO PATCH 1 - MONTE CARLO EXPECTED GOALS CONTRACT
// - Corretto il fallback degli expected goals: null/undefined/stringa vuota non diventano piu 0.
// - Aggiunta diagnostica additive expectedGoals/source senza cambiare il contratto legacy.
// - Il server passa ora esplicitamente gli xG prodotti dal modello Dixon-Coles/xG.
// CALCIO PATCH 5 - PROBABILITY INTEGRITY
// - Dati xG mancanti non collassano più a zero.
// - Proxy goal/shot shrunk al prior di lega.
// - Il peso xG richiesto non viene più forzato al minimo 45%.
// ============================================================================


// ============================================================================
// 1. IMPORTAZIONI
// ============================================================================

const valueEvaluator = require('./value_evaluator');


// ============================================================================
// 2. COSTANTI GLOBALI
// ============================================================================

const CALCIO_QUANT_ENGINE_VERSION = '5.1';
const CALCIO_QUANT_PATCH_VERSION = 'CALCIO_PATCH_1_MONTE_CARLO_EXPECTED_GOALS_CONTRACT';

const DEFAULT_MONTE_CARLO_ITERATIONS = 10000;
const DEFAULT_MONTE_CARLO_SEED = 987654321;

const MAX_GOALS_POISSON = 10;

const DEFAULT_HOME_ADVANTAGE_ELO = 50;


// ============================================================================
// 3. HELPERS BASE
// ============================================================================

function clamp(value, min, max) {
    const n = Number(value);

    if (!Number.isFinite(n)) return min;

    return Math.max(min, Math.min(max, n));
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);

    return Number.isFinite(n) ? n : fallback;
}

// CALCIO PATCH 5: null, undefined e stringa vuota non sono osservazioni numeriche.
// safeNumber resta compatibile con il contratto legacy; observedNumber protegge
// esclusivamente i nuovi percorsi statistici/xG dalla coercizione Number(null) === 0.
function observedNumber(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 2) {
    const n = Number(value);

    if (!Number.isFinite(n)) return 0;

    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function average(values, fallback = 0) {
    if (!Array.isArray(values) || values.length === 0) return fallback;

    const clean = values
        .map(v => safeNumber(v, null))
        .filter(v => v !== null && Number.isFinite(v));

    if (clean.length === 0) return fallback;

    return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function normalizeProbabilityPct(value, fallback = 50) {
    return clamp(safeNumber(value, fallback), 0.01, 99.99);
}

function normalizeProbabilityMap1X2(probabilities = {}) {
    const home = safeNumber(
        probabilities.home ??
        probabilities.homeWin ??
        probabilities['1'],
        0
    );

    const draw = safeNumber(
        probabilities.draw ??
        probabilities.x ??
        probabilities['X'],
        0
    );

    const away = safeNumber(
        probabilities.away ??
        probabilities.awayWin ??
        probabilities['2'],
        0
    );

    const total = home + draw + away;

    if (!Number.isFinite(total) || total <= 0) {
        return {
            home: 33.33,
            draw: 33.33,
            away: 33.34
        };
    }

    return {
        home: round((home / total) * 100, 2),
        draw: round((draw / total) * 100, 2),
        away: round((away / total) * 100, 2)
    };
}

function normalizeBinaryPair(probA, probB) {
    const a = clamp(safeNumber(probA, 50), 0.01, 99.99);
    const b = clamp(safeNumber(probB, 50), 0.01, 99.99);
    const total = a + b;

    if (total <= 0) {
        return {
            a: 50,
            b: 50
        };
    }

    return {
        a: round((a / total) * 100, 2),
        b: round((b / total) * 100, 2)
    };
}


// ============================================================================
// 4. RNG SEEDATO
// ============================================================================

function normalizeSeed(seed = DEFAULT_MONTE_CARLO_SEED) {
    if (seed === undefined || seed === null || seed === '') {
        return DEFAULT_MONTE_CARLO_SEED;
    }

    if (typeof seed === 'number' && Number.isFinite(seed)) {
        return Math.abs(Math.floor(seed)) || DEFAULT_MONTE_CARLO_SEED;
    }

    const str = String(seed);
    let hash = 2166136261;

    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return Math.abs(hash >>> 0) || DEFAULT_MONTE_CARLO_SEED;
}

function createSeededRng(seed = DEFAULT_MONTE_CARLO_SEED) {
    let t = normalizeSeed(seed);

    return function rng() {
        t += 0x6D2B79F5;

        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);

        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}


// ============================================================================
// 5. PROBABILITY CALIBRATION HELPERS
// ============================================================================

function clampNumber(value, min = 0, max = 100) {
    const n = Number(value);

    if (!Number.isFinite(n)) return min;

    return Math.max(min, Math.min(max, n));
}

function buildFootballCalibrationContext(options = {}) {
    const reliabilityReport = options.reliabilityReport || null;
    const calibrationReport = options.calibrationReport || reliabilityReport?.calibration || null;

    const brierScore = safeNumber(
        options.brierScore ??
        reliabilityReport?.brier?.avgBrier ??
        reliabilityReport?.brierScore,
        0.25
    );

    const calibrationError = safeNumber(
        options.calibrationError ??
        reliabilityReport?.calibration?.summary?.weightedCalibrationError ??
        reliabilityReport?.calibrationError,
        0
    );

    const clv = safeNumber(
        options.clv ??
        reliabilityReport?.clv?.avgCLV ??
        reliabilityReport?.clv,
        0
    );

    return {
        calibrationReport,
        brierScore,
        calibrationError,
        clv,
        decision: reliabilityReport?.decision || options.decision || null
    };
}

function applyFootballProbabilityCalibration(probabilityPct, context = {}) {
    const {
        calibrationReport = null,
        marketProbability = null,
        brierScore = 0.25,
        calibrationError = 0,
        minReliableSample = 20,
        maxAdjustment = 8
    } = context;

    const probability = clampNumber(probabilityPct, 1, 99);

    if (
        calibrationReport &&
        Array.isArray(calibrationReport.buckets) &&
        typeof valueEvaluator.calibrateProbabilityByBuckets === 'function'
    ) {
        const calibrated = valueEvaluator.calibrateProbabilityByBuckets(
            probability,
            calibrationReport,
            {
                maxAdjustment,
                minReliableSample,
                shrinkToMarket: marketProbability
            }
        );

        return {
            probability: calibrated.probability,
            originalProbability: calibrated.originalProbability,
            adjustment: calibrated.adjustment,
            bucket: calibrated.bucket,
            reliability: calibrated.reliability,
            reason: calibrated.reason,
            bucketStatus: calibrated.bucketStatus || null,
            bucketSample: calibrated.bucketSample || 0,
            bucketObservedWinRate: calibrated.bucketObservedWinRate ?? null,
            bucketPredictedProb: calibrated.bucketPredictedProb ?? null
        };
    }

    const fallbackProbability = typeof valueEvaluator.calibrateConfidence === 'function'
        ? valueEvaluator.calibrateConfidence(probability, brierScore, calibrationError)
        : probability;

    return {
        probability: round(fallbackProbability, 2),
        originalProbability: round(probability, 2),
        adjustment: round(fallbackProbability - probability, 2),
        bucket: null,
        reliability: 'FALLBACK_CONFIDENCE_CALIBRATION',
        reason: 'Calibrazione fallback tramite Brier/calibration error',
        bucketStatus: null,
        bucketSample: 0,
        bucketObservedWinRate: null,
        bucketPredictedProb: null
    };
}

function calibrateFootball1X2Probabilities(rawProbabilities = {}, options = {}) {
    const normalized = normalizeProbabilityMap1X2(rawProbabilities);
    const context = buildFootballCalibrationContext(options);

    const marketProbabilities = options.marketProbabilities
        ? normalizeProbabilityMap1X2(options.marketProbabilities)
        : null;

    const homeCalibration = applyFootballProbabilityCalibration(
        normalized.home,
        {
            ...context,
            marketProbability: marketProbabilities?.home ?? null
        }
    );

    const drawCalibration = applyFootballProbabilityCalibration(
        normalized.draw,
        {
            ...context,
            marketProbability: marketProbabilities?.draw ?? null
        }
    );

    const awayCalibration = applyFootballProbabilityCalibration(
        normalized.away,
        {
            ...context,
            marketProbability: marketProbabilities?.away ?? null
        }
    );

    const calibratedNormalized = normalizeProbabilityMap1X2({
        home: homeCalibration.probability,
        draw: drawCalibration.probability,
        away: awayCalibration.probability
    });

    return {
        raw: normalized,
        calibrated: calibratedNormalized,
        details: {
            home: {
                ...homeCalibration,
                finalProbability: calibratedNormalized.home
            },
            draw: {
                ...drawCalibration,
                finalProbability: calibratedNormalized.draw
            },
            away: {
                ...awayCalibration,
                finalProbability: calibratedNormalized.away
            }
        },
        reliability: {
            brierScore: round(context.brierScore || 0, 4),
            calibrationError: round(context.calibrationError || 0, 2),
            clv: round(context.clv || 0, 2),
            decision: context.decision || null
        }
    };
}

function calibrateFootballBinaryMarket(rawProbabilityPct, options = {}) {
    const context = buildFootballCalibrationContext(options);
    const marketProbability = options.marketProbability ?? options.marketProb ?? null;

    const calibrated = applyFootballProbabilityCalibration(
        rawProbabilityPct,
        {
            ...context,
            marketProbability
        }
    );

    return {
        rawProbability: round(clampNumber(rawProbabilityPct, 1, 99), 2),
        calibratedProbability: calibrated.probability,
        adjustment: calibrated.adjustment,
        bucket: calibrated.bucket,
        reliability: calibrated.reliability,
        reason: calibrated.reason,
        bucketStatus: calibrated.bucketStatus || null,
        bucketSample: calibrated.bucketSample || 0,
        bucketObservedWinRate: calibrated.bucketObservedWinRate ?? null,
        bucketPredictedProb: calibrated.bucketPredictedProb ?? null
    };
}

function getFootballReliabilityMultiplier(reliability = {}) {
    const decisionLevel = reliability?.decision?.level || reliability?.level || null;

    const brierScore = safeNumber(
        reliability?.brierScore ??
        reliability?.brier,
        0.25
    );

    const calibrationError = safeNumber(
        reliability?.calibrationError,
        0
    );

    const clv = safeNumber(
        reliability?.clv,
        0
    );

    let multiplier = 1;

    if (decisionLevel === 'SUSPEND') multiplier = 0;
    else if (decisionLevel === 'NO_BET_OR_MICRO_STAKE') multiplier = 0.25;
    else if (decisionLevel === 'REDUCE') multiplier = 0.5;
    else if (decisionLevel === 'CAUTION') multiplier = 0.75;
    else if (decisionLevel === 'BOOTSTRAP') multiplier = 1;

    if (brierScore > 0.27) multiplier *= 0.50;
    else if (brierScore > 0.245) multiplier *= 0.75;

    if (calibrationError > 10) multiplier *= 0.50;
    else if (calibrationError > 7.5) multiplier *= 0.75;

    if (clv < 0) multiplier *= 0.75;

    return clamp(multiplier, 0, 1.25);
}

function adjustFootballEdgeByReliability(edgePct, reliability = {}) {
    const edge = safeNumber(edgePct, 0);
    const multiplier = getFootballReliabilityMultiplier(reliability);

    return round(edge * multiplier, 2);
}


// ============================================================================
// 6. PLATT SCALE / CALIBRAZIONE LOGISTICA
// ============================================================================
//
// Vecchio problema:
//     calibrated = 1 / (1 + exp(A * logOdds + B))
// con A negativo produceva comportamento non intuitivo e spesso compressione
// sbagliata.
//
// Nuova forma corretta:
//     sigmoid(alpha * logit(p) + beta)
// Dove:
//     alpha < 1 = shrink verso 50
//     alpha = 1 = identità
//     alpha > 1 = maggiore confidenza
// ============================================================================

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function logit(p) {
    const q = clamp(p, 0.0001, 0.9999);
    return Math.log(q / (1 - q));
}

function plattScale(rawProb, alpha = 0.92, beta = 0) {
    const p = clamp(safeNumber(rawProb, 50) / 100, 0.0001, 0.9999);
    const calibrated = sigmoid((alpha * logit(p)) + beta);

    return clamp(round(calibrated * 100, 4), 0.01, 99.99);
}

function estimateUncertainty(homeMatches, awayMatches, eloDiff) {
    const minSample = Math.min(
        safeNumber(homeMatches, 0),
        safeNumber(awayMatches, 0)
    );

    let sampleUncertainty = 1.0;

    if (minSample < 10) sampleUncertainty = 1.5;
    else if (minSample < 20) sampleUncertainty = 1.2;
    else if (minSample > 30) sampleUncertainty = 0.8;

    let tightnessUncertainty = 1.0;

    if (Math.abs(eloDiff) < 50) tightnessUncertainty = 1.2;
    else if (Math.abs(eloDiff) > 200) tightnessUncertainty = 0.8;

    return clamp(0.15 * sampleUncertainty * tightnessUncertainty, 0.05, 0.35);
}


// ============================================================================
// 7. TIME DECAY & DYNAMIC ELO
// ============================================================================

function getExponentialMovingAverage(arr, alpha = 0.35) {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return 0;

    let ema = safeNumber(arr[0], 0);

    for (let i = 1; i < arr.length; i++) {
        const val = safeNumber(arr[i], null);

        if (val !== null) {
            ema = (val * alpha) + (ema * (1 - alpha));
        }
    }

    return ema;
}

function updateElo(eloHome, eloAway, hg, ag, K = 20) {
    const homeElo = Number.isFinite(Number(eloHome)) ? Number(eloHome) : 1500;
    const awayElo = Number.isFinite(Number(eloAway)) ? Number(eloAway) : 1500;

    const homeGoals = Number(hg);
    const awayGoals = Number(ag);

    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) {
        return {
            newHome: homeElo,
            newAway: awayElo
        };
    }

    const HFA = DEFAULT_HOME_ADVANTAGE_ELO;

    const expectedHome = 1 / (1 + Math.pow(10, ((awayElo - (homeElo + HFA)) / 400)));

    let actualHome = 0.5;

    if (homeGoals > awayGoals) actualHome = 1;
    else if (homeGoals < awayGoals) actualHome = 0;

    const margin = Math.abs(homeGoals - awayGoals);

    const movMult = margin === 0
        ? 1
        : (margin === 1 ? 1.5 : (11 + margin) / 8);

    const homeDiff = K * movMult * (actualHome - expectedHome);

    return {
        newHome: Number.isFinite(homeElo + homeDiff) ? homeElo + homeDiff : homeElo,
        newAway: Number.isFinite(awayElo - homeDiff) ? awayElo - homeDiff : awayElo
    };
}

function estimateFootballDrawProbabilityFromElo(eloDiff, options = {}) {
    const absDiff = Math.abs(safeNumber(eloDiff, 0));

    const baseDraw = safeNumber(options.baseDrawPct, 26.5);
    const minDraw = safeNumber(options.minDrawPct, 16);
    const maxDraw = safeNumber(options.maxDrawPct, 31);

    // Più le squadre sono vicine, più il pareggio è plausibile.
    // Riduzione morbida: a 400 punti Elo il pareggio scende molto.
    const diffPenalty = Math.min(10.5, absDiff / 38);

    let draw = baseDraw - diffPenalty;

    // Piccolo boost per partite molto equilibrate.
    if (absDiff < 40) draw += 2.0;
    else if (absDiff < 80) draw += 1.0;

    return clamp(draw, minDraw, maxDraw);
}

function getEloProbabilities(eloHome, eloAway, HFA = DEFAULT_HOME_ADVANTAGE_ELO) {
    const homeElo = safeNumber(eloHome, 1500);
    const awayElo = safeNumber(eloAway, 1500);

    const effectiveHomeElo = homeElo + HFA;
    const eloDiff = effectiveHomeElo - awayElo;

    const homeVsAwayNoDraw = 1 / (1 + Math.pow(10, ((awayElo - effectiveHomeElo) / 400)));

    const drawPct = estimateFootballDrawProbabilityFromElo(eloDiff);
    const nonDrawPct = 100 - drawPct;

    const homePct = nonDrawPct * homeVsAwayNoDraw;
    const awayPct = nonDrawPct * (1 - homeVsAwayNoDraw);

    const normalized = normalizeProbabilityMap1X2({
        home: homePct,
        draw: drawPct,
        away: awayPct
    });

    return {
        '1': normalized.home,
        'X': normalized.draw,
        '2': normalized.away
    };
}


// ============================================================================
// 8. DIXON-COLES / POISSON
// ============================================================================

function getDynamicRho(leagueName, expHome, expAway) {
    const baseRhos = {
        'Serie A': -0.12,
        'Serie B': -0.14,
        'La Liga': -0.10,
        'Ligue 1': -0.11,
        Bundesliga: -0.06,
        Premier: -0.08,
        'Premier League': -0.08
    };

    let base = baseRhos[leagueName] || -0.10;

    const totalExp = safeNumber(expHome, 1.2) + safeNumber(expAway, 1.0);

    if (totalExp < 2.3) base -= 0.04;
    if (Math.abs(expHome - expAway) > 1.2) base += 0.05;

    return clamp(base, -0.20, 0);
}

function factorial(n) {
    const k = Math.floor(Number(n));

    if (k === 0 || k === 1) return 1;

    let r = 1;

    for (let i = 2; i <= k; i++) {
        r *= i;
    }

    return r;
}

function poisson(k, lambda) {
    const l = clamp(lambda, 0.01, 10);

    return (Math.pow(l, k) * Math.exp(-l)) / factorial(k);
}

function getDixonColesProbabilities(expHomeGoals, expAwayGoals, rho) {
    const homeLambda = clamp(expHomeGoals, 0.05, 6);
    const awayLambda = clamp(expAwayGoals, 0.05, 6);
    const dcRho = clamp(rho, -0.25, 0.10);

    let prob1 = 0;
    let probX = 0;
    let prob2 = 0;
    let probU25 = 0;
    let probO15 = 0;
    let probNG = 0;

    let totalProb = 0;

    const matrix = {};

    for (let i = 0; i <= MAX_GOALS_POISSON; i++) {
        for (let j = 0; j <= MAX_GOALS_POISSON; j++) {
            let p = poisson(i, homeLambda) * poisson(j, awayLambda);

            if (i === 0 && j === 0) {
                p *= (1 - homeLambda * awayLambda * dcRho);
            } else if (i === 0 && j === 1) {
                p *= (1 + homeLambda * dcRho);
            } else if (i === 1 && j === 0) {
                p *= (1 + awayLambda * dcRho);
            } else if (i === 1 && j === 1) {
                p *= (1 - dcRho);
            }

            p = Math.max(0, p);

            matrix[`${i}-${j}`] = p;
            totalProb += p;
        }
    }

    if (totalProb <= 0) {
        return {
            '1': 33.33,
            X: 33.33,
            '2': 33.34,
            '1X': 66.66,
            X2: 66.67,
            '12': 66.67,
            'U2.5': 50,
            'O2.5': 50,
            'O1.5': 70,
            GG: 50,
            NG: 50,
            scoreMatrix: {}
        };
    }

    const normalizedMatrix = {};

    for (let i = 0; i <= MAX_GOALS_POISSON; i++) {
        for (let j = 0; j <= MAX_GOALS_POISSON; j++) {
            const normalizedP = matrix[`${i}-${j}`] / totalProb;

            normalizedMatrix[`${i}-${j}`] = normalizedP;

            if (i > j) prob1 += normalizedP;
            else if (i === j) probX += normalizedP;
            else prob2 += normalizedP;

            if (i + j <= 2) probU25 += normalizedP;
            if (i + j > 1) probO15 += normalizedP;
            if (i === 0 || j === 0) probNG += normalizedP;
        }
    }

    return {
        '1': prob1 * 100,
        X: probX * 100,
        '2': prob2 * 100,

        '1X': (prob1 + probX) * 100,
        X2: (probX + prob2) * 100,
        '12': (prob1 + prob2) * 100,

        'U2.5': probU25 * 100,
        'O2.5': (1 - probU25) * 100,
        'O1.5': probO15 * 100,

        GG: (1 - probNG) * 100,
        NG: probNG * 100,

        scoreMatrix: normalizedMatrix
    };
}


// ============================================================================
// 9. ENSEMBLE MODELING & MARKET MECHANICS
// ============================================================================

function getEnsembleProbabilities(poissonProbs, eloProbs, poissonWeight = 0.8, options = {}) {
    const weight = clamp(poissonWeight, 0, 1);
    const alpha = safeNumber(options.plattAlpha, 0.92);
    const beta = safeNumber(options.plattBeta, 0);

    const ensemble = {};

    const oneXTwoRaw = {
        home: (poissonProbs['1'] * weight) + (eloProbs['1'] * (1 - weight)),
        draw: (poissonProbs.X * weight) + (eloProbs.X * (1 - weight)),
        away: (poissonProbs['2'] * weight) + (eloProbs['2'] * (1 - weight))
    };

    const oneXTwoCalibrated = normalizeProbabilityMap1X2({
        home: plattScale(oneXTwoRaw.home, alpha, beta),
        draw: plattScale(oneXTwoRaw.draw, alpha, beta),
        away: plattScale(oneXTwoRaw.away, alpha, beta)
    });

    ensemble['1'] = oneXTwoCalibrated.home;
    ensemble.X = oneXTwoCalibrated.draw;
    ensemble['2'] = oneXTwoCalibrated.away;

    ensemble['1X'] = ensemble['1'] + ensemble.X;
    ensemble.X2 = ensemble.X + ensemble['2'];
    ensemble['12'] = ensemble['1'] + ensemble['2'];

    const binaryMarkets = [
        'U2.5',
        'O2.5',
        'O1.5',
        'GG',
        'NG'
    ];

    for (const key of binaryMarkets) {
        if (poissonProbs[key] !== undefined) {
            ensemble[key] = plattScale(poissonProbs[key], alpha, beta);
        }
    }

    if (ensemble.GG !== undefined) {
        const normalizedBtts = normalizeBinaryPair(ensemble.GG, ensemble.NG ?? (100 - ensemble.GG));
        ensemble.GG = normalizedBtts.a;
        ensemble.NG = normalizedBtts.b;
    }

    if (ensemble['O2.5'] !== undefined) {
        const normalizedTotals = normalizeBinaryPair(
            ensemble['O2.5'],
            ensemble['U2.5'] ?? (100 - ensemble['O2.5'])
        );

        ensemble['O2.5'] = normalizedTotals.a;
        ensemble['U2.5'] = normalizedTotals.b;
    }

    return ensemble;
}

function simulateOpeningOdds(odds) {
    if (!odds || !odds['1'] || Number.isNaN(Number(odds['1']))) {
        return odds;
    }

    const one = safeNumber(odds['1'], 0);
    const draw = safeNumber(odds.X, 0);
    const two = safeNumber(odds['2'], 0);

    if (one <= 1 || draw <= 1 || two <= 1) return odds;

    const margin = (1 / one) + (1 / draw) + (1 / two);

    const p1 = (1 / one) / margin;
    const pX = (1 / draw) / margin;
    const p2 = (1 / two) / margin;

    const flatten = 0.05;

    const op1 = p1 * (1 - flatten) + (1 / 3) * flatten;
    const opX = pX * (1 - flatten) + (1 / 3) * flatten;
    const op2 = p2 * (1 - flatten) + (1 / 3) * flatten;

    return {
        '1': 1 / (op1 * 1.05),
        X: 1 / (opX * 1.05),
        '2': 1 / (op2 * 1.05),
        source: 'SIMULATED_OPENING_FROM_CLOSING'
    };
}

function simulateOpeningTotals(o, u) {
    const over = safeNumber(o, 0);
    const under = safeNumber(u, 0);

    if (over <= 1 || under <= 1) {
        return {
            'O2.5': o,
            'U2.5': u,
            source: 'INVALID_INPUT'
        };
    }

    const margin = (1 / over) + (1 / under);

    const pO = (1 / over) / margin;
    const pU = (1 / under) / margin;

    const flatten = 0.05;

    return {
        'O2.5': 1 / ((pO * (1 - flatten) + 0.5 * flatten) * 1.05),
        'U2.5': 1 / ((pU * (1 - flatten) + 0.5 * flatten) * 1.05),
        source: 'SIMULATED_OPENING_FROM_CLOSING'
    };
}

function calculateExactDerivatives(odds) {
    if (!odds) return odds;

    const result = { ...odds };

    if (result['1'] && result.X) {
        result['1X'] = 1 / ((1 / result['1']) + (1 / result.X));
    }

    if (result.X && result['2']) {
        result.X2 = 1 / ((1 / result.X) + (1 / result['2']));
    }

    if (result['1'] && result['2']) {
        result['12'] = 1 / ((1 / result['1']) + (1 / result['2']));
    }

    return result;
}

function calculateNoVigOdds(odds) {
    if (!odds || !odds['1'] || !odds.X || !odds['2']) return odds;

    const one = safeNumber(odds['1'], 0);
    const draw = safeNumber(odds.X, 0);
    const two = safeNumber(odds['2'], 0);

    if (one <= 1 || draw <= 1 || two <= 1) return odds;

    const margin = (1 / one) + (1 / draw) + (1 / two);

    return {
        '1': 1 / ((1 / one) / margin),
        X: 1 / ((1 / draw) / margin),
        '2': 1 / ((1 / two) / margin)
    };
}

function calculateNoVigTotals(o, u) {
    const over = safeNumber(o, 0);
    const under = safeNumber(u, 0);

    if (over <= 1 || under <= 1) {
        return {
            'O2.5': o,
            'U2.5': u
        };
    }

    const margin = (1 / over) + (1 / under);

    return {
        'O2.5': 1 / ((1 / over) / margin),
        'U2.5': 1 / ((1 / under) / margin)
    };
}

function calculateKelly(prob, odd, uncertainty = 0) {
    const probDec = clamp(safeNumber(prob, 0) / 100, 0, 1);
    const o = safeNumber(odd, 0);

    if (o <= 1) return 0;

    const pShrink = probDec * (1 - clamp(uncertainty, 0, 0.75));
    const b = o - 1;
    const edge = (pShrink * o) - 1;

    if (edge <= 0) return 0;

    const volCap = o > 3.0
        ? 0.15
        : (o > 2.0 ? 0.20 : 0.25);

    const stakePercent = (edge / b) * volCap * 100;

    return clamp(stakePercent, 0, 1.25);
}

function getSmoothedConversion(goals, shotsTarget) {
    return (safeNumber(goals, 0) + 10) / (safeNumber(shotsTarget, 0) + 30);
}

function calculateEdgePp(probabilityPct, odd) {
    const p = normalizeProbabilityPct(probabilityPct);
    const o = safeNumber(odd, 0);

    if (o <= 1) return 0;

    return round(p - (100 / o), 2);
}

function calculateEvPct(probabilityPct, odd) {
    const p = normalizeProbabilityPct(probabilityPct) / 100;
    const o = safeNumber(odd, 0);

    if (o <= 1) return 0;

    return round(((p * o) - 1) * 100, 2);
}

function calculateExpectedValuePct(probabilityPct, odd) {
    return calculateEvPct(probabilityPct, odd);
}


// ============================================================================
// 10. REAL xG ENGINE
// ============================================================================

function getWeightedXGForm(matches = [], field = 'xG', alpha = 0.38, fallback = 1.25) {
    if (!Array.isArray(matches) || matches.length === 0) return fallback;

    const clean = matches
        .map(m => observedNumber(m[field], null))
        .filter(v => v !== null && v >= 0);

    if (clean.length === 0) return fallback;

    let ema = clean[0];

    for (let i = 1; i < clean.length; i++) {
        ema = (clean[i] * alpha) + (ema * (1 - alpha));
    }

    return ema;
}

function getObservedValues(matches = [], field = '') {
    if (!Array.isArray(matches)) return [];
    return matches
        .map(row => observedNumber(row?.[field], null))
        .filter(value => value !== null && value >= 0);
}

function calculateGoalShotProxy(matches = [], direction = 'for', leaguePrior = 1.25) {
    const goalsField = direction === 'against' ? 'goalsAgainst' : 'goalsFor';
    const shotsField = direction === 'against' ? 'shotsAgainst' : 'shots';
    const sotField = direction === 'against' ? 'shotsOnTargetAgainst' : 'shotsOnTarget';

    const goals = getObservedValues(matches, goalsField);
    const shots = getObservedValues(matches, shotsField);
    const shotsOnTarget = getObservedValues(matches, sotField);

    if (!goals.length && !shots.length && !shotsOnTarget.length) {
        return {
            value: leaguePrior,
            sampleSize: 0,
            source: 'LEAGUE_PRIOR'
        };
    }

    const goalEma = goals.length
        ? getExponentialMovingAverage(goals, 0.34)
        : leaguePrior;
    const shotProxy = shots.length
        ? average(shots, 10) * 0.075
        : leaguePrior;
    const sotProxy = shotsOnTarget.length
        ? average(shotsOnTarget, 3.5) * 0.27
        : leaguePrior;

    const observedComponents = [];
    if (goals.length) observedComponents.push({ value: goalEma, weight: 0.55 });
    if (shots.length) observedComponents.push({ value: shotProxy, weight: 0.20 });
    if (shotsOnTarget.length) observedComponents.push({ value: sotProxy, weight: 0.25 });

    const componentWeight = observedComponents.reduce((sum, component) => sum + component.weight, 0);
    const observedEstimate = componentWeight > 0
        ? observedComponents.reduce((sum, component) => sum + (component.value * component.weight), 0) / componentWeight
        : leaguePrior;

    const sampleSize = Math.max(goals.length, shots.length, shotsOnTarget.length);
    const sampleCredibility = clamp(sampleSize / 10, 0.15, 0.75);
    const shrunk = (observedEstimate * sampleCredibility) + (leaguePrior * (1 - sampleCredibility));

    return {
        value: clamp(shrunk, 0.35, 3.50),
        sampleSize,
        source: 'GOAL_SHOT_PROXY',
        rawEstimate: observedEstimate,
        credibility: sampleCredibility
    };
}

function calculateShotQualityIndex(matches = []) {
    if (!Array.isArray(matches) || matches.length === 0) return 1.0;

    const xgValues = [];
    const shotValues = [];
    const sotValues = [];
    const bigChanceValues = [];

    for (const m of matches) {
        const xG = observedNumber(m.xG, null);
        const shots = observedNumber(m.shots, null);
        const shotsOnTarget = observedNumber(m.shotsOnTarget, null);
        const bigChances = observedNumber(m.bigChances, null);

        if (xG !== null) xgValues.push(xG);
        if (shots !== null) shotValues.push(shots);
        if (shotsOnTarget !== null) sotValues.push(shotsOnTarget);
        if (bigChances !== null) bigChanceValues.push(bigChances);
    }

    const avgShots = average(shotValues, 10);
    const avgSOT = average(sotValues, 3.5);
    const avgXG = xgValues.length
        ? average(xgValues, 1.25)
        : ((avgShots * 0.075 * 0.45) + (avgSOT * 0.27 * 0.55));
    const avgBigChances = average(bigChanceValues, 1.5);

    const xgPerShot = avgShots > 0 ? avgXG / avgShots : 0.10;
    const sotRatio = avgShots > 0 ? avgSOT / avgShots : 0.35;

    let quality = 1.0;

    if (xgPerShot > 0.14) quality += 0.08;
    if (xgPerShot < 0.08) quality -= 0.08;
    if (sotRatio > 0.42) quality += 0.05;
    if (sotRatio < 0.28) quality -= 0.05;
    if (avgBigChances >= 2.2) quality += 0.07;
    if (avgBigChances <= 0.8) quality -= 0.07;

    return clamp(quality, 0.82, 1.18);
}

function calculateXGVariance(matches = []) {
    if (!Array.isArray(matches) || matches.length < 2) return 0.60;

    let values = getObservedValues(matches, 'xG');
    if (values.length < 2) {
        values = getObservedValues(matches, 'goalsFor');
    }
    if (values.length < 2) return 0.60;

    const mean = average(values, 1.25);

    const variance = values.reduce((sum, v) => {
        return sum + Math.pow(v - mean, 2);
    }, 0) / values.length;

    return Math.sqrt(variance);
}

function normalizeTeamXGProfile(teamStats = {}, venue = 'neutral', leagueDefaults = {}) {
    const matches = Array.isArray(teamStats.matches)
        ? teamStats.matches
        : [];

    const priorFor = venue === 'away'
        ? observedNumber(leagueDefaults.avgAwayXG, 1.12)
        : observedNumber(leagueDefaults.avgHomeXG, 1.45);
    const priorAgainst = venue === 'home'
        ? observedNumber(leagueDefaults.avgAwayXG, 1.12)
        : observedNumber(leagueDefaults.avgHomeXG, 1.45);

    const seasonFor = observedNumber(teamStats.seasonXGFor, null);
    const seasonAgainst = observedNumber(teamStats.seasonXGAgainst, null);
    const matchXGFor = getObservedValues(matches, 'xG');
    const matchXGAgainst = getObservedValues(matches, 'xGA');

    const proxyFor = calculateGoalShotProxy(matches, 'for', priorFor);
    const proxyAgainst = calculateGoalShotProxy(matches, 'against', priorAgainst);

    const hasRealFor = seasonFor !== null || matchXGFor.length >= 3;
    const hasRealAgainst = seasonAgainst !== null || matchXGAgainst.length >= 3;
    const hasProxy = proxyFor.sampleSize > 0 || proxyAgainst.sampleSize > 0;

    let evidenceMode = 'LEAGUE_PRIOR';
    if (hasRealFor && hasRealAgainst) evidenceMode = 'REAL_XG';
    else if (hasProxy) evidenceMode = 'GOAL_SHOT_PROXY';

    const baseFor = seasonFor ?? proxyFor.value ?? priorFor;
    const baseAgainst = seasonAgainst ?? proxyAgainst.value ?? priorAgainst;

    const recentXG = hasRealFor
        ? getWeightedXGForm(matches, 'xG', 0.38, baseFor)
        : baseFor;
    const recentXGA = hasRealAgainst
        ? getWeightedXGForm(matches, 'xGA', 0.38, baseAgainst)
        : baseAgainst;

    let venueXGFor = baseFor;
    let venueXGAgainst = baseAgainst;

    if (venue === 'home') {
        venueXGFor = observedNumber(teamStats.homeXGFor, venueXGFor);
        venueXGAgainst = observedNumber(teamStats.homeXGAgainst, venueXGAgainst);
    }

    if (venue === 'away') {
        venueXGFor = observedNumber(teamStats.awayXGFor, venueXGFor);
        venueXGAgainst = observedNumber(teamStats.awayXGAgainst, venueXGAgainst);
    }

    const shotQuality = calculateShotQualityIndex(matches);
    const sampleSize = matches.length;

    let confidence = 1.0;

    if (sampleSize < 5) confidence *= 0.70;
    else if (sampleSize < 10) confidence *= 0.84;
    else if (sampleSize < 20) confidence *= 0.94;
    else confidence *= 1.04;

    if (evidenceMode === 'GOAL_SHOT_PROXY') confidence *= 0.72;
    if (evidenceMode === 'LEAGUE_PRIOR') confidence *= 0.55;

    const xGVariance = calculateXGVariance(matches);

    if (xGVariance > 0.65) confidence *= 0.86;
    else if (xGVariance < 0.30) confidence *= 1.05;

    return {
        teamName: teamStats.teamName || 'Unknown',
        recentXG: clamp(recentXG, 0.20, 3.80),
        recentXGA: clamp(recentXGA, 0.20, 3.80),
        venueXGFor: clamp(venueXGFor, 0.20, 3.80),
        venueXGAgainst: clamp(venueXGAgainst, 0.20, 3.80),
        shotQuality,
        sampleSize,
        xGVariance,
        confidence: clamp(confidence, 0.30, 1.15),
        evidenceMode,
        proxyFor,
        proxyAgainst,
        observed: {
            seasonXGFor: seasonFor,
            seasonXGAgainst: seasonAgainst,
            matchXGForCount: matchXGFor.length,
            matchXGAgainstCount: matchXGAgainst.length
        }
    };
}

function getLeagueXGDefaults(leagueName = '') {
    const league = String(leagueName).toLowerCase();

    if (league.includes('bundesliga')) {
        return {
            avgHomeXG: 1.62,
            avgAwayXG: 1.28,
            avgTotalXG: 2.90,
            homeAdvantage: 1.08
        };
    }

    if (league.includes('serie a')) {
        return {
            avgHomeXG: 1.45,
            avgAwayXG: 1.12,
            avgTotalXG: 2.57,
            homeAdvantage: 1.07
        };
    }

    if (league.includes('serie b')) {
        return {
            avgHomeXG: 1.32,
            avgAwayXG: 1.02,
            avgTotalXG: 2.34,
            homeAdvantage: 1.08
        };
    }

    if (league.includes('premier')) {
        return {
            avgHomeXG: 1.55,
            avgAwayXG: 1.22,
            avgTotalXG: 2.77,
            homeAdvantage: 1.06
        };
    }

    if (league.includes('liga') || league.includes('la liga')) {
        return {
            avgHomeXG: 1.42,
            avgAwayXG: 1.08,
            avgTotalXG: 2.50,
            homeAdvantage: 1.07
        };
    }

    if (league.includes('ligue 1')) {
        return {
            avgHomeXG: 1.40,
            avgAwayXG: 1.06,
            avgTotalXG: 2.46,
            homeAdvantage: 1.07
        };
    }

    return {
        avgHomeXG: 1.45,
        avgAwayXG: 1.12,
        avgTotalXG: 2.57,
        homeAdvantage: 1.07
    };
}

function calculateExpectedGoalsFromXG(homeStats = {}, awayStats = {}, context = {}) {
    const {
        leagueName = '',
        homeElo = 1500,
        awayElo = 1500,
        weatherPenalty = 1.0,
        tempoFactor = 1.0,
        lineupAttackHome = 1.0,
        lineupAttackAway = 1.0,
        lineupDefenseHome = 1.0,
        lineupDefenseAway = 1.0
    } = context;

    const league = getLeagueXGDefaults(leagueName);

    const home = normalizeTeamXGProfile(homeStats, 'home', league);
    const away = normalizeTeamXGProfile(awayStats, 'away', league);

    const homeAttackIndex = (
        (home.recentXG * 0.55) +
        (home.venueXGFor * 0.45)
    ) / league.avgHomeXG;

    const awayAttackIndex = (
        (away.recentXG * 0.55) +
        (away.venueXGFor * 0.45)
    ) / league.avgAwayXG;

    const homeDefenseWeakness = (
        (home.recentXGA * 0.55) +
        (home.venueXGAgainst * 0.45)
    ) / league.avgAwayXG;

    const awayDefenseWeakness = (
        (away.recentXGA * 0.55) +
        (away.venueXGAgainst * 0.45)
    ) / league.avgHomeXG;

    const eloDiff = safeNumber(homeElo, 1500) - safeNumber(awayElo, 1500);

    const eloHomeBoost = clamp(1 + (eloDiff / 1800), 0.88, 1.14);
    const eloAwayBoost = clamp(1 - (eloDiff / 1800), 0.88, 1.14);

    let expHomeGoals =
        league.avgHomeXG *
        homeAttackIndex *
        awayDefenseWeakness *
        league.homeAdvantage *
        home.shotQuality *
        eloHomeBoost *
        weatherPenalty *
        tempoFactor *
        lineupAttackHome *
        lineupDefenseAway;

    let expAwayGoals =
        league.avgAwayXG *
        awayAttackIndex *
        homeDefenseWeakness *
        away.shotQuality *
        eloAwayBoost *
        weatherPenalty *
        tempoFactor *
        lineupAttackAway *
        lineupDefenseHome;

    expHomeGoals = clamp(expHomeGoals, 0.20, 4.50);
    expAwayGoals = clamp(expAwayGoals, 0.20, 4.50);

    const confidence = clamp(
        ((home.confidence + away.confidence) / 2),
        0.55,
        1.15
    );

    const volatility = clamp(
        ((home.xGVariance + away.xGVariance) / 2),
        0.20,
        1.20
    );

    const evidenceMode = (
        home.evidenceMode === 'REAL_XG' && away.evidenceMode === 'REAL_XG'
    )
        ? 'REAL_XG'
        : (
            home.evidenceMode === 'LEAGUE_PRIOR' || away.evidenceMode === 'LEAGUE_PRIOR'
                ? 'LEAGUE_PRIOR'
                : 'GOAL_SHOT_PROXY'
        );

    return {
        expHomeGoals,
        expAwayGoals,
        confidence,
        volatility,
        evidenceMode,
        homeProfile: home,
        awayProfile: away,
        attackIndex: {
            home: homeAttackIndex,
            away: awayAttackIndex
        },
        defenseWeakness: {
            home: homeDefenseWeakness,
            away: awayDefenseWeakness
        },
        league
    };
}

function blendExpectedGoalsWithXG(goalBasedHome, goalBasedAway, xgModel, xgWeight = 0.72) {
    const safeHome = observedNumber(goalBasedHome, xgModel.expHomeGoals);
    const safeAway = observedNumber(goalBasedAway, xgModel.expAwayGoals);
    const requestedWeight = clamp(observedNumber(xgWeight, 0.72), 0, 0.90);
    const evidenceMode = String(xgModel.evidenceMode || 'LEAGUE_PRIOR').toUpperCase();

    const evidenceMultiplier = evidenceMode === 'REAL_XG'
        ? 1.0
        : (evidenceMode === 'GOAL_SHOT_PROXY' ? 0.55 : 0.20);

    // Patch 5: il peso richiesto dal chiamante è un tetto semantico, non viene
    // più forzato al minimo 45%. Dati proxy/prior ricevono un peso prudente.
    const confidenceWeight = clamp(
        requestedWeight * clamp(xgModel.confidence, 0.30, 1.15) * evidenceMultiplier,
        0,
        0.85
    );

    return {
        expHomeGoals: (xgModel.expHomeGoals * confidenceWeight) + (safeHome * (1 - confidenceWeight)),
        expAwayGoals: (xgModel.expAwayGoals * confidenceWeight) + (safeAway * (1 - confidenceWeight)),
        xgWeightRequested: requestedWeight,
        xgWeightUsed: confidenceWeight,
        xgEvidenceMultiplier: evidenceMultiplier,
        xgEvidenceMode: evidenceMode,
        xgConfidence: xgModel.confidence,
        xgVolatility: xgModel.volatility
    };
}


// ============================================================================
// 11. XG + DIXON-COLES + CALIBRATION ENGINE
// ============================================================================

function getXGAdjustedDixonColesProbabilities(params = {}) {
    const {
        homeStats,
        awayStats,
        leagueName = '',
        homeElo = 1500,
        awayElo = 1500,
        goalBasedHome = null,
        goalBasedAway = null,
        xgWeight = 0.72,
        context = {}
    } = params;

    const reliabilityReport = params.reliabilityReport || null;

    const xgModel = calculateExpectedGoalsFromXG(
        homeStats,
        awayStats,
        {
            ...context,
            leagueName,
            homeElo,
            awayElo
        }
    );

    const blended = blendExpectedGoalsWithXG(
        goalBasedHome,
        goalBasedAway,
        xgModel,
        xgWeight
    );

    const rho = getDynamicRho(
        leagueName,
        blended.expHomeGoals,
        blended.expAwayGoals
    );

    const poissonProbs = getDixonColesProbabilities(
        blended.expHomeGoals,
        blended.expAwayGoals,
        rho
    );

    const eloProbs = getEloProbabilities(homeElo, awayElo);

    const ensemble = getEnsembleProbabilities(
        poissonProbs,
        eloProbs,
        0.82,
        {
            plattAlpha: params.plattAlpha ?? 0.92,
            plattBeta: params.plattBeta ?? 0
        }
    );

    const raw1X2 = {
        home: ensemble['1'],
        draw: ensemble.X,
        away: ensemble['2']
    };

    const calibrated1X2 = calibrateFootball1X2Probabilities(raw1X2, {
        reliabilityReport,
        calibrationReport: params.calibrationReport || null,
        brierScore: params.brierScore,
        calibrationError: params.calibrationError,
        clv: params.clv,
        marketProbabilities: params.marketProbabilities || null
    });

    const calibratedOver25 = calibrateFootballBinaryMarket(ensemble['O2.5'], {
        reliabilityReport,
        calibrationReport: params.calibrationReport || null,
        brierScore: params.brierScore,
        calibrationError: params.calibrationError,
        clv: params.clv,
        marketProbability: params.marketProbabilities?.over25 ?? null
    });

    const calibratedUnder25 = calibrateFootballBinaryMarket(ensemble['U2.5'], {
        reliabilityReport,
        calibrationReport: params.calibrationReport || null,
        brierScore: params.brierScore,
        calibrationError: params.calibrationError,
        clv: params.clv,
        marketProbability: params.marketProbabilities?.under25 ?? null
    });

    const calibratedBTTS = calibrateFootballBinaryMarket(ensemble.GG, {
        reliabilityReport,
        calibrationReport: params.calibrationReport || null,
        brierScore: params.brierScore,
        calibrationError: params.calibrationError,
        clv: params.clv,
        marketProbability: params.marketProbabilities?.btts ?? null
    });

    const calibratedNoBTTS = 100 - calibratedBTTS.calibratedProbability;

    const binaryBttsNorm = normalizeBinaryPair(
        calibratedBTTS.calibratedProbability,
        calibratedNoBTTS
    );

    const binaryTotalsNorm = normalizeBinaryPair(
        calibratedOver25.calibratedProbability,
        calibratedUnder25.calibratedProbability
    );

    return {
        probabilities: {
            '1': calibrated1X2.calibrated.home,
            X: calibrated1X2.calibrated.draw,
            '2': calibrated1X2.calibrated.away,

            '1X': calibrated1X2.calibrated.home + calibrated1X2.calibrated.draw,
            X2: calibrated1X2.calibrated.away + calibrated1X2.calibrated.draw,
            '12': calibrated1X2.calibrated.home + calibrated1X2.calibrated.away,

            'O2.5': binaryTotalsNorm.a,
            'U2.5': binaryTotalsNorm.b,

            O1_5: ensemble['O1.5'],
            'O1.5': ensemble['O1.5'],

            GG: binaryBttsNorm.a,
            NG: binaryBttsNorm.b
        },

        rawPoisson: poissonProbs,
        rawElo: eloProbs,
        rawEnsemble: ensemble,

        rho,
        expHomeGoals: round(blended.expHomeGoals, 3),
        expAwayGoals: round(blended.expAwayGoals, 3),

        xg: {
            confidence: round(xgModel.confidence, 3),
            volatility: round(xgModel.volatility, 3),
            weightRequested: round(blended.xgWeightRequested, 3),
            weightUsed: round(blended.xgWeightUsed, 3),
            evidenceMultiplier: round(blended.xgEvidenceMultiplier, 3),
            evidenceMode: blended.xgEvidenceMode,
            homeProfile: xgModel.homeProfile,
            awayProfile: xgModel.awayProfile,
            attackIndex: xgModel.attackIndex,
            defenseWeakness: xgModel.defenseWeakness
        },

        rawProbabilities: {
            homeWin: round(ensemble['1'], 2),
            draw: round(ensemble.X, 2),
            awayWin: round(ensemble['2'], 2),
            over25: round(ensemble['O2.5'], 2),
            under25: round(ensemble['U2.5'], 2),
            btts: round(ensemble.GG, 2)
        },

        calibratedProbabilities: {
            homeWin: calibrated1X2.calibrated.home,
            draw: calibrated1X2.calibrated.draw,
            awayWin: calibrated1X2.calibrated.away,
            over25: binaryTotalsNorm.a,
            under25: binaryTotalsNorm.b,
            btts: binaryBttsNorm.a,
            noBtts: binaryBttsNorm.b
        },

        calibrationAudit: {
            market: 'football',
            oneXTwo: calibrated1X2,
            over25: calibratedOver25,
            under25: calibratedUnder25,
            btts: calibratedBTTS,
            reliabilityMode: reliabilityReport?.mode || null,
            reliabilityDecision: reliabilityReport?.decision || null
        },

        engineVersion: CALCIO_QUANT_ENGINE_VERSION
    };
}


// ============================================================================
// 12. BAYESIAN CONFIDENCE
// ============================================================================

function betaMean(alpha, beta) {
    const a = Math.max(0.0001, safeNumber(alpha, 1));
    const b = Math.max(0.0001, safeNumber(beta, 1));

    return a / (a + b);
}

function betaVariance(alpha, beta) {
    const a = Math.max(0.0001, safeNumber(alpha, 1));
    const b = Math.max(0.0001, safeNumber(beta, 1));
    const total = a + b;

    return (a * b) / (Math.pow(total, 2) * (total + 1));
}

function getBayesianConfidence(probability, sampleSize = 100, priorStrength = 20) {
    const p = clamp(probability, 0.01, 0.99);
    const n = Math.max(1, safeNumber(sampleSize, 100));
    const prior = Math.max(0, safeNumber(priorStrength, 20));

    const alpha = 1 + (p * n) + (0.5 * prior);
    const beta = 1 + ((1 - p) * n) + (0.5 * prior);

    const mean = betaMean(alpha, beta);
    const stdDev = Math.sqrt(betaVariance(alpha, beta));

    return {
        mean,
        lowerBound: clamp(mean - 1.96 * stdDev, 0, 1),
        upperBound: clamp(mean + 1.96 * stdDev, 0, 1),
        uncertainty: clamp(stdDev * 100, 0, 50),
        confidenceScore: clamp(100 - (stdDev * 220), 0, 100)
    };
}


// ============================================================================
// 13. MONTE CARLO SCORELINE ENGINE
// ============================================================================

function samplePoisson(lambda, rng) {
    const l = clamp(lambda, 0.01, 10);
    const L = Math.exp(-l);

    let k = 0;
    let p = 1;

    do {
        k++;
        p *= rng();
    } while (p > L && k < 20);

    return k - 1;
}

function resolveExpectedGoalsInput(probabilities = {}, options = {}) {
    const inferred = deriveExpectedGoalsFromProbabilities(probabilities);

    const hasFiniteInput = value => (
        value !== null &&
        value !== undefined &&
        value !== '' &&
        Number.isFinite(Number(value))
    );

    const hasHome = hasFiniteInput(options.expHomeGoals);
    const hasAway = hasFiniteInput(options.expAwayGoals);

    return {
        expHomeGoals: hasHome ? Number(options.expHomeGoals) : inferred.expHomeGoals,
        expAwayGoals: hasAway ? Number(options.expAwayGoals) : inferred.expAwayGoals,
        source: hasHome && hasAway
            ? 'EXPLICIT_EXPECTED_GOALS'
            : (!hasHome && !hasAway ? 'INFERRED_FROM_PROBABILITIES' : 'MIXED_EXPECTED_GOALS'),
        explicit: {
            home: hasHome,
            away: hasAway
        },
        inferred
    };
}

function deriveExpectedGoalsFromProbabilities(probabilities = {}) {
    const over25 = clamp(
        safeNumber(probabilities['O2.5'] ?? probabilities.pOver2_5, 50),
        1,
        99
    ) / 100;

    const homeProb = clamp(
        safeNumber(probabilities['1'], 33),
        1,
        98
    ) / 100;

    const awayProb = clamp(
        safeNumber(probabilities['2'], 33),
        1,
        98
    ) / 100;

    // Stima prudente del total goals da Over 2.5.
    // Non è usata se vengono passati expHomeGoals/expAwayGoals.
    const totalGoals = clamp(
        1.7 + (over25 * 1.8),
        1.4,
        3.8
    );

    const homeShare = clamp(
        0.50 + ((homeProb - awayProb) * 0.35),
        0.35,
        0.68
    );

    return {
        expHomeGoals: totalGoals * homeShare,
        expAwayGoals: totalGoals * (1 - homeShare)
    };
}

function runMonteCarlo(probabilities, iterations = DEFAULT_MONTE_CARLO_ITERATIONS, options = {}) {
    const {
        sampleSize = 100,
        priorStrength = 20,
        marketDisagreement = 0,
        volatilityFactor = 1.0,

        redCardRisk = 0.05,
        injuryRisk = 0.03,
        weatherNoise = 0.02,
        tempoNoise = 0.18,

        expHomeGoals = null,
        expAwayGoals = null,
        seed = DEFAULT_MONTE_CARLO_SEED
    } = options;

    const normalizedIterations = Math.max(
        100,
        Math.min(100000, Math.floor(safeNumber(iterations, DEFAULT_MONTE_CARLO_ITERATIONS)))
    );

    const rng = createSeededRng(seed);

    const expectedGoalsInput = resolveExpectedGoalsInput(probabilities, {
        expHomeGoals,
        expAwayGoals
    });

    const baseHomeGoals = clamp(expectedGoalsInput.expHomeGoals, 0.05, 5);
    const baseAwayGoals = clamp(expectedGoalsInput.expAwayGoals, 0.05, 5);

    const baseVolatility = clamp(safeNumber(volatilityFactor, 1.0), 0.5, 1.8);

    const results = {
        home: 0,
        draw: 0,
        away: 0,
        over1_5: 0,
        over2_5: 0,
        gol: 0,
        scoreCounts: {}
    };

    for (let i = 0; i < normalizedIterations; i++) {
        let iterHomeGoals = baseHomeGoals;
        let iterAwayGoals = baseAwayGoals;

        // Shock partita: rosso, infortunio o condizioni meteo.
        if (rng() < redCardRisk) {
            if (rng() < 0.5) {
                iterHomeGoals *= 0.65;
                iterAwayGoals *= 1.25;
            } else {
                iterAwayGoals *= 0.65;
                iterHomeGoals *= 1.25;
            }
        }

        if (rng() < injuryRisk) {
            if (rng() < 0.5) iterHomeGoals *= 0.88;
            else iterAwayGoals *= 0.88;
        }

        const weatherFactor = 1 + ((rng() - 0.5) * weatherNoise * 2);

        iterHomeGoals *= weatherFactor;
        iterAwayGoals *= weatherFactor;

        // Rumore controllato su tempo/volatilità.
        const tempoNoiseFactor = 1 + (
            (rng() - 0.5) *
            clamp(observedNumber(tempoNoise, 0.18), 0, 0.50) *
            baseVolatility
        );

        iterHomeGoals = clamp(iterHomeGoals * tempoNoiseFactor, 0.03, 6);
        iterAwayGoals = clamp(iterAwayGoals * tempoNoiseFactor, 0.03, 6);

        const hg = samplePoisson(iterHomeGoals, rng);
        const ag = samplePoisson(iterAwayGoals, rng);

        if (hg > ag) results.home++;
        else if (hg === ag) results.draw++;
        else results.away++;

        if (hg + ag > 1.5) results.over1_5++;
        if (hg + ag > 2.5) results.over2_5++;

        if (hg > 0 && ag > 0) results.gol++;

        const scoreKey = `${hg}-${ag}`;
        results.scoreCounts[scoreKey] = (results.scoreCounts[scoreKey] || 0) + 1;
    }

    const homeWinProb = results.home / normalizedIterations;
    const drawProb = results.draw / normalizedIterations;
    const awayWinProb = results.away / normalizedIterations;
    const over1_5Prob = results.over1_5 / normalizedIterations;
    const over2_5Prob = results.over2_5 / normalizedIterations;
    const golProb = results.gol / normalizedIterations;

    const homeConfidence = getBayesianConfidence(homeWinProb, sampleSize, priorStrength);
    const drawConfidence = getBayesianConfidence(drawProb, sampleSize, priorStrength);
    const awayConfidence = getBayesianConfidence(awayWinProb, sampleSize, priorStrength);
    const over2_5Confidence = getBayesianConfidence(over2_5Prob, sampleSize, priorStrength);
    const golConfidence = getBayesianConfidence(golProb, sampleSize, priorStrength);

    const disagreementPenalty = clamp(1 - (marketDisagreement / 100), 0.70, 1);
    const volPenalty = clamp(1 / baseVolatility, 0.70, 1.10);

    const globalConfidence = (
        homeConfidence.confidenceScore +
        drawConfidence.confidenceScore +
        awayConfidence.confidenceScore +
        over2_5Confidence.confidenceScore +
        golConfidence.confidenceScore
    ) / 5 * disagreementPenalty * volPenalty;

    const scoreDistribution = Object.entries(results.scoreCounts)
        .map(([score, count]) => ({
            score,
            probability: round(count / normalizedIterations, 4)
        }))
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 10);

    return {
        homeWinProb,
        drawProb,
        awayWinProb,

        p1X: homeWinProb + drawProb,
        pX2: awayWinProb + drawProb,

        p1_DNB: homeWinProb + awayWinProb > 0
            ? homeWinProb / (homeWinProb + awayWinProb)
            : 0,

        p2_DNB: homeWinProb + awayWinProb > 0
            ? awayWinProb / (homeWinProb + awayWinProb)
            : 0,

        over1_5Prob,
        over2_5Prob,
        golProb,

        confidence: {
            global: round(globalConfidence, 2),
            home: {
                probability: round(homeWinProb, 4),
                lowerBound: round(homeConfidence.lowerBound, 4),
                upperBound: round(homeConfidence.upperBound, 4),
                confidenceScore: round(homeConfidence.confidenceScore, 2)
            },
            draw: {
                probability: round(drawProb, 4),
                lowerBound: round(drawConfidence.lowerBound, 4),
                upperBound: round(drawConfidence.upperBound, 4),
                confidenceScore: round(drawConfidence.confidenceScore, 2)
            },
            away: {
                probability: round(awayWinProb, 4),
                lowerBound: round(awayConfidence.lowerBound, 4),
                upperBound: round(awayConfidence.upperBound, 4),
                confidenceScore: round(awayConfidence.confidenceScore, 2)
            },
            over2_5: {
                probability: round(over2_5Prob, 4),
                lowerBound: round(over2_5Confidence.lowerBound, 4),
                upperBound: round(over2_5Confidence.upperBound, 4),
                confidenceScore: round(over2_5Confidence.confidenceScore, 2)
            },
            gol: {
                probability: round(golProb, 4),
                lowerBound: round(golConfidence.lowerBound, 4),
                upperBound: round(golConfidence.upperBound, 4),
                confidenceScore: round(golConfidence.confidenceScore, 2)
            }
        },

        scoreDistribution,
        iterations: normalizedIterations,
        seed: normalizeSeed(seed),
        expectedGoals: {
            home: round(baseHomeGoals, 4),
            away: round(baseAwayGoals, 4),
            source: expectedGoalsInput.source,
            explicit: expectedGoalsInput.explicit
        },
        simulationAssumptions: {
            redCardRisk: round(clamp(redCardRisk, 0, 1), 4),
            injuryRisk: round(clamp(injuryRisk, 0, 1), 4),
            weatherNoise: round(clamp(weatherNoise, 0, 1), 4),
            tempoNoise: round(clamp(observedNumber(tempoNoise, 0.18), 0, 0.50), 4),
            volatilityFactor: round(baseVolatility, 4)
        },
        patchVersion: CALCIO_QUANT_PATCH_VERSION,
        engineVersion: CALCIO_QUANT_ENGINE_VERSION
    };
}


// ============================================================================
// 14. EXPORTS
// ============================================================================

module.exports = {
    // Metadata
    CALCIO_QUANT_ENGINE_VERSION,
    CALCIO_QUANT_PATCH_VERSION,

    // Helpers base
    clamp,
    safeNumber,
    observedNumber,
    round,
    average,

    // RNG
    normalizeSeed,
    createSeededRng,

    // Calibration
    plattScale,
    estimateUncertainty,
    calibrateFootball1X2Probabilities,
    calibrateFootballBinaryMarket,
    applyFootballProbabilityCalibration,
    buildFootballCalibrationContext,
    adjustFootballEdgeByReliability,
    getFootballReliabilityMultiplier,

    // Elo / time decay
    getExponentialMovingAverage,
    updateElo,
    getEloProbabilities,
    estimateFootballDrawProbabilityFromElo,

    // Dixon-Coles / Poisson
    getDynamicRho,
    factorial,
    poisson,
    getDixonColesProbabilities,

    // Ensemble / market
    getEnsembleProbabilities,
    simulateOpeningOdds,
    simulateOpeningTotals,
    calculateExactDerivatives,
    calculateNoVigOdds,
    calculateNoVigTotals,
    calculateKelly,
    getSmoothedConversion,
    calculateEdgePp,
    calculateEvPct,
    calculateExpectedValuePct,

    // xG
    getWeightedXGForm,
    getObservedValues,
    calculateGoalShotProxy,
    calculateShotQualityIndex,
    calculateXGVariance,
    normalizeTeamXGProfile,
    getLeagueXGDefaults,
    calculateExpectedGoalsFromXG,
    blendExpectedGoalsWithXG,
    getXGAdjustedDixonColesProbabilities,

    // Monte Carlo
    runMonteCarlo,
    getBayesianConfidence,
    samplePoisson,
    deriveExpectedGoalsFromProbabilities,
    resolveExpectedGoalsInput
};