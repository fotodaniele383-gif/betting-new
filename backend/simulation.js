// ============================================================================
// AI BETTING QUANT PRO - UNIVERSAL SIMULATION ENGINE
// Versione: 7.0 (Enterprise: TDD Verified, Fully Seeded & Modular)
// Sport: CALCIO + TENNIS
// ============================================================================

const ENGINE_VERSION = '7.1-PATCH19';

let ProfessionalMarkov = null;
try { ProfessionalMarkov = require('./markov'); } catch (_) { ProfessionalMarkov = null; }

// ============================================================================
// 1. HELPERS NUMERICI E STATISTICI
// ============================================================================

function clamp(value, min, max) {
    if (isNaN(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = 0) {
    const n = parseFloat(value);
    return isNaN(n) ? fallback : n;
}

function average(arr = [], fallback = 0) {
    if (!Array.isArray(arr) || arr.length === 0) return fallback;
    const clean = arr.map(v => safeNumber(v, null)).filter(v => v !== null);
    if (clean.length === 0) return fallback;
    return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function stdDev(arr = []) {
    if (!Array.isArray(arr) || arr.length < 2) return 0;
    const mean = average(arr);
    const variance = arr.reduce((sum, val) => {
        return sum + Math.pow(val - mean, 2);
    }, 0) / arr.length;
    return Math.sqrt(variance);
}

// Supporto per il TDD (edge_pp e ev_pct globali)
function calculateEdgePp(probabilityPct, odd) {
    const p = clamp(safeNumber(probabilityPct, 0), 0, 100);
    const o = safeNumber(odd, 0);
    if (o <= 1) return 0;
    return p - (100 / o);
}

function calculateEvPct(probabilityPct, odd) {
    const p = clamp(safeNumber(probabilityPct, 0), 0, 100) / 100;
    const o = safeNumber(odd, 0);
    if (o <= 1) return 0;
    return ((p * o) - 1) * 100;
}

// ============================================================================
// 2. RANDOM NUMBER GENERATOR (RNG) DETERMINISTICO E GAUSSIANO
// ============================================================================

function normalizeSeed(seed) {
    if (seed === undefined || seed === null || seed === '') return 123456789;
    if (typeof seed === 'number' && Number.isFinite(seed)) return Math.abs(Math.floor(seed)) || 123456789;

    const str = String(seed);
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0) || 123456789;
}

function createSeededRng(seed) {
    let t = normalizeSeed(seed);
    return function() {
        t += 0x6D2B79F5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function randomNormalSeeded(rng, mean = 0, std = 1) {
    let u = 0; let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * std + mean;
}

// ============================================================================
// 3. BAYESIAN CONFIDENCE ENGINE
// ============================================================================

function betaMean(alpha, beta) {
    return alpha / (alpha + beta);
}

function betaVariance(alpha, beta) {
    const total = alpha + beta;
    return (alpha * beta) / (Math.pow(total, 2) * (total + 1));
}

function calculateBayesianConfidence(probability, sampleSize = 100, priorStrength = 20) {
    const p = clamp(probability, 0.01, 0.99);
    const alpha = 1 + (p * sampleSize) + (0.5 * priorStrength);
    const beta = 1 + ((1 - p) * sampleSize) + (0.5 * priorStrength);

    const mean = betaMean(alpha, beta);
    const stdDev = Math.sqrt(betaVariance(alpha, beta));

    return {
        mean,
        lowerBound: clamp(mean - (1.96 * stdDev), 0, 1),
        upperBound: clamp(mean + (1.96 * stdDev), 0, 1),
        uncertainty: clamp(stdDev * 100, 0, 50),
        confidenceScore: clamp(100 - (stdDev * 220), 0, 100)
    };
}

// ============================================================================
// 4. MARKET REGIME DETECTION (Sport Agnostico)
// ============================================================================

function detectSimulationRegime(context = {}) {
    const sport = String(context.sport || 'football').toLowerCase();

    if (sport.includes('tennis')) {
        const surface = String(context.surface || 'hard').toLowerCase();
        const tournament = String(context.tournamentType || '').toLowerCase();
        const gender = String(context.gender || 'ATP').toUpperCase();

        let variance = 1.0;
        if (gender === 'WTA') variance *= 1.18;
        if (tournament.includes('challenger') || tournament.includes('itf')) variance *= 1.15;
        if (surface.includes('grass')) variance *= 1.12;
        if (surface.includes('indoor')) variance *= 1.06;

        return { sport: 'TENNIS', variance, regime: variance >= 1.25 ? 'HIGH_VARIANCE' : 'NORMAL' };
    }

    const avgGoals = safeNumber(context.avgGoals, 2.5);
    const xgVolatility = safeNumber(context.xgVolatility, 0.45);
    const weatherPenalty = safeNumber(context.weatherPenalty, 1);

    let variance = 1.0;
    if (avgGoals >= 3.0) variance *= 1.08;
    if (xgVolatility >= 0.65) variance *= 1.12;
    if (weatherPenalty < 1) variance *= 1.05; 

    return { sport: 'CALCIO', variance, regime: variance >= 1.15 ? 'VOLATILE' : 'NORMAL' };
}

function calculateAdaptiveIterations(context = {}) {
    const variance = safeNumber(context.variance, 1);
    const confidence = safeNumber(context.confidence, 0.8);
    let iterations = 10000;
    iterations *= variance;
    iterations *= (1.15 - confidence);
    return Math.round(clamp(iterations, 8000, 50000));
}

function perturbProbabilitySeeded(probability, varianceFactor, rng) {
    probability = clamp(probability, 0.01, 0.99);
    const noise = randomNormalSeeded(rng, 0, varianceFactor * 0.025);
    return clamp(probability + noise, 0.01, 0.99);
}

// ============================================================================
// 5. FOOTBALL MONTE CARLO (Deterministico & Strutturato)
// ============================================================================

function runFootballMonteCarlo(probabilities, args2, args3) {
    // TDD Object-style / Parameter-style Handling
    let iterations = 10000;
    let context = {};
    if (typeof args2 === 'number') { iterations = args2; context = args3 || {}; } 
    else if (typeof args2 === 'object') { context = args2; iterations = context.iterations || 10000; }
    
    const regime = detectSimulationRegime({ ...context, sport: 'football' });
    const variance = regime.variance;
    
    // Override iterazioni dinamico (solo se non forzato nei parametri)
    if (!context.iterations && typeof args2 !== 'number') {
        iterations = calculateAdaptiveIterations({ variance, confidence: safeNumber(context.modelConfidence, 0.8) });
    }

    const seed = normalizeSeed(context.seed);
    const rng = createSeededRng(seed);

    const redCardRisk = safeNumber(context.redCardRisk, 0.05);
    const injuryRisk = safeNumber(context.injuryRisk, 0.03);

    let results = { home: 0, draw: 0, away: 0, over1_5: 0, over2_5: 0, gol: 0 };

    const extractProb = (val) => val > 1 ? val / 100 : val;

    const p1 = clamp(extractProb(probabilities.p1 || probabilities.home || probabilities["1"] || 0), 0, 1);
    const pX = clamp(extractProb(probabilities.pX || probabilities.draw || probabilities["X"] || 0), 0, 1);
    const p2 = clamp(extractProb(probabilities.p2 || probabilities.away || probabilities["2"] || 0), 0, 1);
    const total1X2 = p1 + pX + p2 || 1;

    const baseP1 = p1 / total1X2;
    const basePX = pX / total1X2;
    const baseP2 = p2 / total1X2;
    
    const baseO15 = clamp(extractProb(probabilities.pOver1_5 || probabilities.over15 || probabilities["O1.5"] || 0), 0, 1);
    const baseO25 = clamp(extractProb(probabilities.pOver2_5 || probabilities.over25 || probabilities["O2.5"] || 0), 0, 1);
    const baseGol = clamp(extractProb(probabilities.pGol || probabilities.gg || probabilities["GG"] || 0), 0, 1);

    for (let i = 0; i < iterations; i++) {
        let iterP1 = perturbProbabilitySeeded(baseP1, variance, rng);
        let iterPX = perturbProbabilitySeeded(basePX, variance, rng);
        let iterP2 = perturbProbabilitySeeded(baseP2, variance, rng);

        if (rng() < redCardRisk) {
            if (rng() < 0.5) { iterP1 *= 0.65; iterP2 *= 1.35; iterPX *= 1.10; } 
            else { iterP2 *= 0.65; iterP1 *= 1.35; iterPX *= 1.10; }
        }

        if (rng() < injuryRisk) {
            if (rng() < 0.5) iterP1 *= 0.85; else iterP2 *= 0.85;
        }

        iterP1 = Math.max(0.01, iterP1);
        iterPX = Math.max(0.01, iterPX);
        iterP2 = Math.max(0.01, iterP2);
        let iterTotal = iterP1 + iterPX + iterP2;
        let n1 = iterP1 / iterTotal;
        let nX = iterPX / iterTotal;

        let rand1X2 = rng();
        if (rand1X2 < n1) results.home++;
        else if (rand1X2 < n1 + nX) results.draw++;
        else results.away++;

        let randGoals = rng();
        let iterO25 = perturbProbabilitySeeded(baseO25, variance, rng);
        let iterO15 = perturbProbabilitySeeded(baseO15, variance, rng);

        if (randGoals < iterO25) { results.over2_5++; results.over1_5++; } 
        else if (randGoals < iterO15) { results.over1_5++; }

        if (rng() < perturbProbabilitySeeded(baseGol, variance, rng)) results.gol++;
    }

    const homeWinProb = results.home / iterations;
    const drawProb = results.draw / iterations;
    const awayWinProb = results.away / iterations;
    const over1_5Prob = results.over1_5 / iterations;
    const over2_5Prob = results.over2_5 / iterations;
    const golProb = results.gol / iterations;

    const sampleSize = safeNumber(context.sampleSize, 100);
    const priorStrength = safeNumber(context.priorStrength, 20);

    const homeConfidence = calculateBayesianConfidence(homeWinProb, sampleSize, priorStrength);
    const drawConfidence = calculateBayesianConfidence(drawProb, sampleSize, priorStrength);
    const awayConfidence = calculateBayesianConfidence(awayWinProb, sampleSize, priorStrength);
    const over2_5Confidence = calculateBayesianConfidence(over2_5Prob, sampleSize, priorStrength);
    const golConfidence = calculateBayesianConfidence(golProb, sampleSize, priorStrength);

    const marketDisagreement = safeNumber(context.marketDisagreement, 0);
    const volatilityFactor = safeNumber(context.volatilityFactor, 1.0);

    const disagreementPenalty = clamp(1 - marketDisagreement / 100, 0.70, 1);
    const volPenalty = clamp(1 / volatilityFactor, 0.70, 1.10);

    const globalConfidence = (
        homeConfidence.confidenceScore + drawConfidence.confidenceScore +
        awayConfidence.confidenceScore + over2_5Confidence.confidenceScore +
        golConfidence.confidenceScore
    ) / 5 * disagreementPenalty * volPenalty;

    return {
        // TDD Output Formatting
        sport_type: 'CALCIO',
        engineVersion: ENGINE_VERSION,
        seed,
        iterations,
        regime,
        
        homeWinProb, drawProb, awayWinProb,
        p1X: homeWinProb + drawProb, pX2: awayWinProb + drawProb,
        p1_DNB: homeWinProb + awayWinProb > 0 ? homeWinProb / (homeWinProb + awayWinProb) : 0,
        p2_DNB: homeWinProb + awayWinProb > 0 ? awayWinProb / (homeWinProb + awayWinProb) : 0,
        over1_5Prob, over2_5Prob, golProb,
        
        probabilities: {
            home: Number(homeWinProb.toFixed(4)), draw: Number(drawProb.toFixed(4)), away: Number(awayWinProb.toFixed(4)),
            over15: Number(over1_5Prob.toFixed(4)), over25: Number(over2_5Prob.toFixed(4)), gg: Number(golProb.toFixed(4))
        },
        confidence: {
            global: Number(globalConfidence.toFixed(2)),
            home: homeConfidence, draw: drawConfidence, away: awayConfidence,
            over2_5: over2_5Confidence, gol: golConfidence
        }
    };
}

// ============================================================================
// 6. TENNIS MONTE CARLO (Deterministico)
// ============================================================================

function runTennisMonteCarlo(probabilities, args2, args3) {
    let iterations = 5000;
    let context = {};
    if (typeof args2 === 'number') { iterations = args2; context = args3 || {}; }
    else if (typeof args2 === 'object' && args2 !== null) { context = args2; iterations = context.iterations || 5000; }

    const regime = detectSimulationRegime({ ...context, sport: 'tennis' });
    if (!context.iterations && typeof args2 !== 'number') {
        iterations = calculateAdaptiveIterations({ variance: regime.variance, confidence: safeNumber(context.modelConfidence, 0.8) });
    }
    iterations = Math.round(clamp(iterations, 1000, 50000));
    const seed = normalizeSeed(context.seed);
    const extractProb = value => {
        const number = safeNumber(value, 0.5);
        return clamp(number > 1 ? number / 100 : number, 0.01, 0.99);
    };

    const scoringRules = require('./tennisScoringRulesAudit02').modelRules(context);
    const p1ServePoint = context.p1ServePoint ?? context.player1ServePoint ?? probabilities.p1ServePoint ?? probabilities.player1ServePoint;
    const p2ServePoint = context.p2ServePoint ?? context.player2ServePoint ?? probabilities.p2ServePoint ?? probabilities.player2ServePoint;
    const serviceInputsAvailable = Number.isFinite(Number(p1ServePoint)) && Number.isFinite(Number(p2ServePoint));

    if (serviceInputsAvailable && ProfessionalMarkov && typeof ProfessionalMarkov.runProfessionalMarkovMatchModel === 'function') {
        const result = ProfessionalMarkov.runProfessionalMarkovMatchModel({
            pA: extractProb(p1ServePoint),
            pB: extractProb(p2ServePoint),
            bpA: extractProb(context.p1BreakPointServe ?? probabilities.p1BreakPointServe ?? p1ServePoint),
            bpB: extractProb(context.p2BreakPointServe ?? probabilities.p2BreakPointServe ?? p2ServePoint),
            sampleA: safeNumber(context.p1Sample ?? context.sampleSizeP1 ?? context.sampleSize, 40),
            sampleB: safeNumber(context.p2Sample ?? context.sampleSizeP2 ?? context.sampleSize, 40),
            bestOf: scoringRules.bestOf,
            scoringRules,
            finalSetTieBreakTarget: context.finalSetTieBreakTarget,
            iterations,
            seed,
            priorStrength: safeNumber(context.priorStrength, 16),
            startServerIsA: context.startServerIsA !== false
        });

        return {
            sport_type: 'TENNIS',
            engineVersion: ENGINE_VERSION,
            seed,
            iterations: result.iterations,
            regime,
            modelMode: 'HIERARCHICAL_POINT_LEVEL_MARKOV_MONTE_CARLO',
            degradedFallback: false,
            probabilities: result.probabilities,
            expectedTieBreaks: result.expectedTieBreaks,
            tieBreakProbabilityDefinition: result.tieBreakProbabilityDefinition,
            markovEngineVersion: result.version,
            scoringRules: result.scoringRules,
            expectedGames: result.expectedGames,
            scoreDistribution: result.scoreDistribution,
            confidenceInterval95: result.confidenceInterval95,
            standardError: result.standardError,
            posterior: result.posterior,
            confidence: {
                player1: calculateBayesianConfidence(result.probabilities.player1, Math.max(20, safeNumber(context.p1Sample ?? context.sampleSize, 40)), 12),
                player2: calculateBayesianConfidence(result.probabilities.player2, Math.max(20, safeNumber(context.p2Sample ?? context.sampleSize, 40)), 12)
            },
            diagnostics: {
                ...result.diagnostics,
                tennisSpecific: true,
                uncertaintyAtPointLevel: true,
                independentTieBreakNoise: false
            }
        };
    }

    // Compatibility fallback for callers that only provide match probability.
    // It is explicit and penalized because it is not a point/game/set model.
    const rng = createSeededRng(seed);
    let player1Wins = 0;
    let tieBreaks = 0;
    const baseP1 = extractProb(probabilities.player1 ?? probabilities.p1 ?? 0.5);
    const fallbackVariance = regime.variance * 0.018;
    for (let i = 0; i < iterations; i++) {
        const latent = clamp(baseP1 + randomNormalSeeded(rng, 0, fallbackVariance), 0.01, 0.99);
        if (rng() < latent) player1Wins += 1;
        const tbBase = clamp(safeNumber(context.tieBreakProbability, 0.22), 0.02, 0.75);
        if (rng() < tbBase) tieBreaks += 1;
    }
    const p1Final = player1Wins / iterations;
    return {
        sport_type: 'TENNIS',
        engineVersion: ENGINE_VERSION,
        seed,
        iterations,
        regime,
        modelMode: 'DEGRADED_MATCH_LEVEL_FALLBACK',
        degradedFallback: true,
        probabilities: {
            player1: Number(p1Final.toFixed(4)),
            player2: Number((1 - p1Final).toFixed(4)),
            tieBreak: Number((tieBreaks / iterations).toFixed(4))
        },
        confidence: {
            player1: calculateBayesianConfidence(p1Final, Math.min(25, safeNumber(context.sampleSize, 20)), 20),
            player2: calculateBayesianConfidence(1 - p1Final, Math.min(25, safeNumber(context.sampleSize, 20)), 20)
        },
        diagnostics: {
            tennisSpecific: false,
            uncertaintyAtPointLevel: false,
            warning: 'SERVICE_POINT_INPUTS_MISSING_MATCH_LEVEL_FALLBACK'
        }
    };
}

// ============================================================================
// 7. UNIFIED ENGINE ROUTER
// ============================================================================

function runSimulation(probabilities, context = {}) {
    const sport = String(context.sport || 'football').toLowerCase();
    
    if (sport.includes('tennis')) {
        return runTennisMonteCarlo(probabilities, context);
    }
    
    return runFootballMonteCarlo(probabilities, context);
}

// ============================================================================
// 8. CONFIDENCE SUMMARY
// ============================================================================

function summarizeConfidence(simulationResult = {}) {
    const confidence = simulationResult.confidence || {};
    const scores = [];

    for (const key of Object.keys(confidence)) {
        const item = confidence[key];
        if (key !== 'global' && item && item.confidenceScore) {
            scores.push(item.confidenceScore);
        }
    }

    const avg = average(scores, 50);
    let label = 'LOW';
    if (avg >= 80) label = 'ELITE';
    else if (avg >= 70) label = 'HIGH';
    else if (avg >= 60) label = 'MEDIUM';

    return {
        avgConfidence: Number(avg.toFixed(2)),
        label,
        variance: simulationResult.regime?.variance || 1
    };
}

// ============================================================================
// EXPORTS ⚡
// ============================================================================
module.exports = {
    runSimulation,
    runFootballMonteCarlo,
    runTennisMonteCarlo,
    calculateBayesianConfidence,
    detectSimulationRegime,
    calculateAdaptiveIterations,
    summarizeConfidence,
    
    // TDD Specific Exports
    createSeededRng,
    normalizeSeed,
    calculateEdgePp,
    calculateEvPct
};