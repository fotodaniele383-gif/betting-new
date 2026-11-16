// ============================================================================
// AI BETTING QUANT PRO - TENNIS MARKOV & MATCHUP ENGINE
// Versione: 4.1
// ============================================================================
//
// CHANGELOG 4.0
// - Compatibile con server.tennis.js v15+.
// - Rimosso uso diretto non controllato di Math.random().
// - Aggiunto RNG seedato e riproducibile.
// - Aggiunti export top-level:
//      probGame
//      probTieBreak
//      probSet
//      probMatch
//      simulateTotals
//      simulateMatchTotals
//      getTotalsProbability
// - Simulazioni Tennis riproducibili tramite seed.
// - Input robusti: accetta probabilità in formato decimale 0-1 o percentuale 0-100.
// - Output standardizzato:
//      probOver
//      probUnder
//      expectedGames
//      pushRate
//      iterations
//      seed
// - Nessun uso di storico DB.
// - Nessuna reliability fittizia.
// - Questo file è solo motore matematico/statistico.
//
// CHANGELOG 4.1
// - Continuità del turno di servizio tra set: ora usa nextServerIsA dal set precedente.
// - Aggiunti diagnostics e self-check deterministici non invasivi.
// - Aggiunti helper validateMarkovInputs e buildMarkovMeta.
// - Migliorata gestione safety guard su set molto lunghi.
// - Output totals arricchito con input normalizzati e diagnostics.
// - Compatibilità server.tennis.js mantenuta: probOver/probUnder invariati.
// ============================================================================


// ============================================================================
// 1. CONFIGURAZIONE GLOBALE
// ============================================================================

const MARKOV_ENGINE_VERSION = '5.0-PATCH19-AUDIT02';
const {modelRules}=require('./tennisScoringRulesAudit02');

const DEFAULT_ITERATIONS = 5000;
const DEFAULT_TOTALS_ITERATIONS = 6000;
const DEFAULT_MAX_ITERATIONS = 50000;
const DEFAULT_MIN_ITERATIONS = 1000;

const DEFAULT_SEED = 123456789;

const DEFAULT_BEST_OF = 3;

const VALID_SURFACES = [
    'hard',
    'clay',
    'grass',
    'indoor_hard'
];


// ============================================================================
// 2. HELPERS NUMERICI
// ============================================================================

function toNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function round(value, decimals = 4) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function normalizeProbability(value, fallback = 0.5) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
        return clamp(fallback, 0.01, 0.99);
    }

    // Accetta 55 come 55%, oppure 0.55 come probabilità decimale.
    if (n > 1) {
        return clamp(n / 100, 0.01, 0.99);
    }

    return clamp(n, 0.01, 0.99);
}

function normalizeBestOf(bestOf) {
    const n = Number(bestOf);
    return n === 5 ? 5 : 3;
}

function normalizeIterations(iterations, fallback = DEFAULT_ITERATIONS) {
    const n = Number(iterations);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(clamp(n, DEFAULT_MIN_ITERATIONS, DEFAULT_MAX_ITERATIONS));
}

function normalizeSurface(surface) {
    const s = String(surface || 'hard').toLowerCase().trim();

    if (VALID_SURFACES.includes(s)) return s;

    if (s.includes('clay') || s.includes('terra')) return 'clay';
    if (s.includes('grass') || s.includes('erba')) return 'grass';
    if (s.includes('indoor')) return 'indoor_hard';

    return 'hard';
}

function buildMarkovMeta(extra = {}) {
    return {
        version: MARKOV_ENGINE_VERSION,
        engine: 'TENNIS_MARKOV_ENGINE',
        reliabilityMode: 'MATHEMATICAL_SIMULATION_ONLY_NO_DB_RELIABILITY',
        ...extra
    };
}

function validateMarkovInputs({ pA, pB, bestOf = DEFAULT_BEST_OF, targetLine = null, iterations = DEFAULT_ITERATIONS } = {}) {
    const normalizedPA = normalizeProbability(pA);
    const normalizedPB = normalizeProbability(pB);
    const normalizedBestOf = normalizeBestOf(bestOf);
    const normalizedIterations = normalizeIterations(iterations);

    const diagnostics = {
        pA: normalizedPA,
        pB: normalizedPB,
        bestOf: normalizedBestOf,
        iterations: normalizedIterations,
        warnings: []
    };

    if (Math.abs(normalizedPA - normalizedPB) > 0.30) {
        diagnostics.warnings.push('Differenza pA/pB molto ampia: verificare che siano probabilità di punto al servizio, non probabilità match.');
    }

    if (targetLine !== null && targetLine !== undefined) {
        const line = Number(targetLine);
        diagnostics.targetLine = line;
        if (!Number.isFinite(line) || line <= 0) {
            diagnostics.warnings.push('targetLine non valida.');
        }
    }

    return diagnostics;
}

function normalizeSeed(seed = DEFAULT_SEED) {
    if (seed === undefined || seed === null || seed === '') return DEFAULT_SEED;

    if (typeof seed === 'number' && Number.isFinite(seed)) {
        return Math.abs(Math.floor(seed)) || DEFAULT_SEED;
    }

    const str = String(seed);
    let hash = 2166136261;

    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return Math.abs(hash >>> 0) || DEFAULT_SEED;
}


// ============================================================================
// 3. RNG SEEDATO RIPRODUCIBILE
// ============================================================================
//
// Mulberry32:
// - semplice;
// - veloce;
// - deterministico;
// - sufficiente per simulazioni Monte Carlo applicative.
// ============================================================================

function createSeededRng(seed = DEFAULT_SEED) {
    let t = normalizeSeed(seed);

    return function rng() {
        t += 0x6D2B79F5;

        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);

        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function randomBool(rng, probability) {
    return rng() < normalizeProbability(probability);
}


// ============================================================================
// 4. MARKOV GAME MODEL
// ============================================================================
//
// probGame:
// Calcola la probabilità che il server vinca il game.
// pServe   = probabilità server di vincere un punto normale.
// pServeBP = probabilità server di vincere un punto su palla break / punto critico.
// ============================================================================

function probGame(pServe, pServeBP = null) {
    const p = normalizeProbability(pServe);
    const pBP = pServeBP === null || pServeBP === undefined
        ? p
        : normalizeProbability(pServeBP);

    const dp = Array.from({ length: 5 }, () => Array(5).fill(0));

    dp[0][0] = 1.0;

    for (let serverPoints = 0; serverPoints <= 3; serverPoints++) {
        for (let returnerPoints = 0; returnerPoints <= 3; returnerPoints++) {
            if (serverPoints === 3 && returnerPoints === 3) continue;
            if (dp[serverPoints][returnerPoints] === 0) continue;

            const isBreakPoint =
                returnerPoints === 3 &&
                serverPoints < 3;

            const probWinPoint = isBreakPoint ? pBP : p;

            dp[serverPoints + 1][returnerPoints] +=
                dp[serverPoints][returnerPoints] * probWinPoint;

            dp[serverPoints][returnerPoints + 1] +=
                dp[serverPoints][returnerPoints] * (1 - probWinPoint);
        }
    }

    const probWinGameStandard =
        dp[4][0] +
        dp[4][1] +
        dp[4][2];

    const probDeuce = dp[3][3];

    // Da deuce:
    // - Il server vince due punti consecutivi: p * p.
    // - Ritorno a deuce:
    //      server vince poi perde: p * (1 - p)
    //      server perde poi salva break: (1 - p) * pBP
    const probReturnToDeuce = (p * (1 - p)) + ((1 - p) * pBP);
    const denominator = 1 - probReturnToDeuce;

    if (denominator <= 0) {
        return clamp(probWinGameStandard, 0.01, 0.99);
    }

    const probWinFromDeuce = (p * p) / denominator;

    return clamp(probWinGameStandard + (probDeuce * probWinFromDeuce), 0.01, 0.99);
}


// ============================================================================
// 5. TIEBREAK SIMULATION
// ============================================================================
//
// Nota:
// Il tiebreak è simulato con RNG seedato.
// La sequenza di servizio è:
// - primo punto server A;
// - poi due servizi B;
// - poi due servizi A;
// - alternanza ogni due punti.
// ============================================================================

function getTieBreakServerIsA(pointIndex) {
    if (pointIndex === 0) return true;

    const block = Math.floor((pointIndex - 1) / 2);

    return block % 2 === 1;
}

function simulateTieBreakOnce({
    pA,
    pB,
    rng,
    startServerIsA = true,
    maxPoints = 200,
    targetPoints = 7
}) {
    if (![7,10].includes(targetPoints)) throw new Error("AUDIT02_INVALID_TIEBREAK_TARGET");
    let scoreA = 0;
    let scoreB = 0;

    const probAOnServe = normalizeProbability(pA);
    const probBOnServe = normalizeProbability(pB);

    for (let pointIndex = 0; pointIndex < maxPoints; pointIndex++) {
        let serverIsA = getTieBreakServerIsA(pointIndex);

        if (!startServerIsA) {
            serverIsA = !serverIsA;
        }

        if (serverIsA) {
            if (randomBool(rng, probAOnServe)) scoreA++;
            else scoreB++;
        } else {
            if (randomBool(rng, probBOnServe)) scoreB++;
            else scoreA++;
        }

        if (
            (scoreA >= targetPoints || scoreB >= targetPoints) &&
            Math.abs(scoreA - scoreB) >= 2
        ) {
            return {
                winner: scoreA > scoreB ? 'A' : 'B',
                scoreA,
                scoreB,
                totalPoints: scoreA + scoreB
            };
        }
    }

    return {
        winner: scoreA >= scoreB ? 'A' : 'B',
        scoreA,
        scoreB,
        totalPoints: scoreA + scoreB,
        truncated: true
    };
}

function probTieBreak(pA, pB, options = {}) {
    const iterations = normalizeIterations(options.iterations, DEFAULT_ITERATIONS);
    const seed = normalizeSeed(options.seed ?? DEFAULT_SEED);
    const rng = options.rng || createSeededRng(seed);

    let aWins = 0;
    let totalPoints = 0;

    for (let i = 0; i < iterations; i++) {
        const result = simulateTieBreakOnce({
            pA,
            pB,
            rng,
            startServerIsA: options.startServerIsA !== false,
            targetPoints: options.targetPoints ?? 7,
            tieBreakTarget: options.tieBreakTarget ?? 7,
            scoringRules: modelRules({...options,bestOf: options.bestOf ?? (typeof bestOf === "undefined" ? 3 : bestOf)})
        });

        if (result.winner === 'A') aWins++;
        totalPoints += result.totalPoints;
    }

    return aWins / iterations;
}


// ============================================================================
// 6. SET SIMULATION
// ============================================================================

function simulateSetOnce({
    pA,
    pB,
    bpA = null,
    bpB = null,
    rng,
    startServerIsA = true,
    tieBreakAtSixAll = true,
    tieBreakTarget = 7
}) {
    if (!tieBreakAtSixAll || ![7,10].includes(tieBreakTarget)) throw new Error("AUDIT02_UNSUPPORTED_SET_FORMAT");
    const gameProbA = probGame(pA, bpA);
    const gameProbB = probGame(pB, bpB);

    let gamesA = 0;
    let gamesB = 0;
    let serverIsA = Boolean(startServerIsA);
    let totalGames = 0;
    let tieBreakPlayed = false;

    while (true) {
        if (tieBreakAtSixAll && gamesA === 6 && gamesB === 6) {
            tieBreakPlayed = true;
            totalGames++;

            const tb = simulateTieBreakOnce({
                pA,
                pB,
                rng,
                startServerIsA: serverIsA,
                targetPoints: tieBreakTarget
            });

            if (tb.truncated) throw new Error('AUDIT02_TIEBREAK_SIMULATION_TRUNCATED');
            if (tb.winner === 'A') gamesA++;
            else gamesB++;

            // AUDIT01 F01: first tie-break server receives in the next set.
            serverIsA = !serverIsA;
            break;
        }

        const serverWinsGame = serverIsA
            ? randomBool(rng, gameProbA)
            : randomBool(rng, gameProbB);

        totalGames++;

        if (serverIsA) {
            if (serverWinsGame) gamesA++;
            else gamesB++;
        } else {
            if (serverWinsGame) gamesB++;
            else gamesA++;
        }

        serverIsA = !serverIsA;

        if (
            (gamesA >= 6 || gamesB >= 6) &&
            Math.abs(gamesA - gamesB) >= 2
        ) {
            break;
        }

        // Safety guard. Non dovrebbe mai attivarsi; protegge da loop in input estremi.
        if (gamesA + gamesB > 30) {
            return {
                winner: gamesA >= gamesB ? 'A' : 'B',
                gamesA,
                gamesB,
                totalGames,
                nextServerIsA: serverIsA,
                tieBreakPlayed,
                safetyTruncated: true
            };
        }
    }

    return {
        winner: gamesA > gamesB ? 'A' : 'B',
        gamesA,
        gamesB,
        totalGames,
        nextServerIsA: serverIsA,
        tieBreakPlayed,
        safetyTruncated: false
    };
}

function probSet(pA, pB, bpA = null, bpB = null, options = {}) {
    const iterations = normalizeIterations(options.iterations, DEFAULT_ITERATIONS);
    const seed = normalizeSeed(options.seed ?? DEFAULT_SEED);
    const rng = options.rng || createSeededRng(seed);

    let aWins = 0;
    let totalGames = 0;
    let tieBreaks = 0;

    for (let i = 0; i < iterations; i++) {
        const result = simulateSetOnce({
            pA,
            pB,
            bpA,
            bpB,
            rng,
            startServerIsA: options.startServerIsA !== false,
            targetPoints: options.targetPoints ?? 7,
            tieBreakTarget: options.tieBreakTarget ?? 7,
            scoringRules: modelRules({...options,bestOf: options.bestOf ?? (typeof bestOf === "undefined" ? 3 : bestOf)})
        });

        if (result.winner === 'A') aWins++;
        totalGames += result.totalGames;
        if (result.tieBreakPlayed) tieBreaks++;
    }

    return aWins / iterations;
}


// ============================================================================
// 7. MATCH SIMULATION
// ============================================================================

function setsNeededToWin(bestOf) {
    return normalizeBestOf(bestOf) === 5 ? 3 : 2;
}

function simulateMatchOnce({
    pA,
    pB,
    bestOf = DEFAULT_BEST_OF,
    bpA = null,
    bpB = null,
    rng,
    startServerIsA = true,
    finalSetTieBreakTarget = 7,
    scoringRules = null
}) {
    const rules = modelRules({bestOf,finalSetTieBreakTarget,scoringRules});
    const targetSets = setsNeededToWin(bestOf);

    let setsA = 0;
    let setsB = 0;
    let totalGames = 0;
    let totalTieBreaks = 0;
    let serverIsA = Boolean(startServerIsA);
    const setScores = [];

    while (setsA < targetSets && setsB < targetSets) {
        const setResult = simulateSetOnce({
            pA,
            pB,
            bpA,
            bpB,
            rng,
            startServerIsA: serverIsA,
            tieBreakTarget: setsA === targetSets-1 && setsB === targetSets-1 ? rules.finalSetTieBreakTarget : 7
        });

        if (setResult.winner === 'A') setsA++;
        else setsB++;

        totalGames += setResult.totalGames;

        if (setResult.tieBreakPlayed) {
            totalTieBreaks++;
        }

        setScores.push({
            gamesA: setResult.gamesA,
            gamesB: setResult.gamesB,
            winner: setResult.winner,
            tieBreakPlayed: setResult.tieBreakPlayed,
            safetyTruncated: Boolean(setResult.safetyTruncated)
        });

        // Continuità reale del turno di servizio tra set.
        // Se il set termina con numero pari di game, serve lo stesso giocatore che ha iniziato il set;
        // se termina con numero dispari, serve l'altro. nextServerIsA è già calcolato game-by-game.
        serverIsA = setResult.nextServerIsA;

        if (setScores.length > 5) break;
    }

    return {
        winner: setsA > setsB ? 'A' : 'B',
        setsA,
        setsB,
        totalGames,
        totalTieBreaks,
        setScores
    };
}

function probMatch(pA, pB, bestOf = DEFAULT_BEST_OF, bpA = null, bpB = null, options = {}) {
    const iterations = normalizeIterations(options.iterations, DEFAULT_ITERATIONS);
    const seed = normalizeSeed(options.seed ?? DEFAULT_SEED);
    const rng = options.rng || createSeededRng(seed);

    let aWins = 0;
    let totalGames = 0;
    let totalTieBreaks = 0;

    for (let i = 0; i < iterations; i++) {
        const result = simulateMatchOnce({
            pA,
            pB,
            bestOf,
            bpA,
            bpB,
            rng,
            startServerIsA: options.startServerIsA !== false,
            targetPoints: options.targetPoints ?? 7,
            tieBreakTarget: options.tieBreakTarget ?? 7,
            scoringRules: modelRules({...options,bestOf: options.bestOf ?? (typeof bestOf === "undefined" ? 3 : bestOf)})
        });

        if (result.winner === 'A') aWins++;
        totalGames += result.totalGames;
        totalTieBreaks += result.totalTieBreaks;
    }

    return aWins / iterations;
}


// ============================================================================
// 8. SET BETTING
// ============================================================================

function getSetBetting(pA, pB, bestOf = DEFAULT_BEST_OF, bpA = null, bpB = null, options = {}) {
    const iterations = normalizeIterations(options.iterations, DEFAULT_ITERATIONS);
    const seed = normalizeSeed(options.seed ?? DEFAULT_SEED);
    const rng = options.rng || createSeededRng(seed);

    const scoreCounts = {};

    for (let i = 0; i < iterations; i++) {
        const result = simulateMatchOnce({
            pA,
            pB,
            bestOf,
            bpA,
            bpB,
            rng,
            startServerIsA: options.startServerIsA !== false,
            targetPoints: options.targetPoints ?? 7,
            tieBreakTarget: options.tieBreakTarget ?? 7,
            scoringRules: modelRules({...options,bestOf: options.bestOf ?? (typeof bestOf === "undefined" ? 3 : bestOf)})
        });

        const score = `${result.setsA}-${result.setsB}`;

        scoreCounts[score] = (scoreCounts[score] || 0) + 1;
    }

    const entries = Object.entries(scoreCounts)
        .map(([score, count]) => ({
            score,
            probability: count / iterations
        }))
        .sort((a, b) => b.probability - a.probability);

    const bestScore = entries[0] || {
        score: normalizeBestOf(bestOf) === 5 ? '3-1' : '2-1',
        probability: 0
    };

    const winnerScores = entries.filter(e => {
        const [a, b] = e.score.split('-').map(Number);
        return a > b;
    });

    const loserScores = entries.filter(e => {
        const [a, b] = e.score.split('-').map(Number);
        return b > a;
    });

    const expectedW = winnerScores[0]?.score || (normalizeBestOf(bestOf) === 5 ? '3-1' : '2-1');
    const expectedL = loserScores[0]?.score || (normalizeBestOf(bestOf) === 5 ? '1-3' : '1-2');

    return {
        expectedW,
        expectedL,
        mostLikelyScore: bestScore.score,
        mostLikelyScoreProbability: round(bestScore.probability, 4),
        distribution: entries.map(e => ({
            score: e.score,
            probability: round(e.probability, 4)
        })),
        iterations,
        seed
    };
}


// ============================================================================
// 9. TOTALS SIMULATION
// ============================================================================

function simulateTotals(pA, pB, targetLine, bestOf = DEFAULT_BEST_OF, bpA = null, bpB = null, options = {}) {
    let args = null;

    // Supporta chiamata object-style:
    // simulateTotals({ pA, pB, targetLine, bestOf, bpA, bpB, iterations, seed })
    if (
        typeof pA === 'object' &&
        pA !== null
    ) {
        args = pA;
    } else {
        args = {
            pA,
            pB,
            targetLine,
            bestOf,
            bpA,
            bpB,
            ...options
        };
    }

    const normalizedPA = normalizeProbability(args.pA);
    const normalizedPB = normalizeProbability(args.pB);
    const normalizedBPA = args.bpA === null || args.bpA === undefined
        ? normalizedPA
        : normalizeProbability(args.bpA);
    const normalizedBPB = args.bpB === null || args.bpB === undefined
        ? normalizedPB
        : normalizeProbability(args.bpB);

    const line = Number(args.targetLine);

    const diagnostics = validateMarkovInputs({
        pA: args.pA,
        pB: args.pB,
        bestOf: args.bestOf ?? DEFAULT_BEST_OF,
        targetLine: args.targetLine,
        iterations: args.iterations ?? DEFAULT_TOTALS_ITERATIONS
    });

    if (!Number.isFinite(line) || line <= 0) {
        return {
            probOver: 0,
            probUnder: 0,
            expectedGames: 0,
            pushRate: 0,
            iterations: 0,
            error: 'targetLine non valida',
            diagnostics,
            ...buildMarkovMeta()
        };
    }

    const iterations = normalizeIterations(args.iterations, DEFAULT_TOTALS_ITERATIONS);
    const seed = normalizeSeed(args.seed ?? DEFAULT_SEED);
    const rng = args.rng || createSeededRng(seed);

    const normalizedBestOf = normalizeBestOf(modelRules(args).bestOf);

    let overCount = 0;
    let underCount = 0;
    let pushCount = 0;
    let totalGamesSum = 0;
    let tieBreakCount = 0;
    let playerAWins = 0;

    for (let i = 0; i < iterations; i++) {
        const matchResult = simulateMatchOnce({
            pA: normalizedPA,
            pB: normalizedPB,
            bestOf: normalizedBestOf,
            bpA: normalizedBPA,
            bpB: normalizedBPB,
            rng,
            startServerIsA: args.startServerIsA !== false,
            scoringRules: modelRules(args)
        });

        totalGamesSum += matchResult.totalGames;
        tieBreakCount += matchResult.totalTieBreaks;

        if (matchResult.winner === 'A') {
            playerAWins++;
        }

        if (matchResult.totalGames > line) {
            overCount++;
        } else if (matchResult.totalGames < line) {
            underCount++;
        } else {
            pushCount++;
        }
    }

    const validIterations = iterations - pushCount;

    const probOver = validIterations > 0 ? overCount / validIterations : 0;
    const probUnder = validIterations > 0 ? underCount / validIterations : 0;

    return {
        probOver: round(probOver, 4),
        probUnder: round(probUnder, 4),
        overProbability: round(probOver, 4),
        underProbability: round(probUnder, 4),
        expectedGames: round(totalGamesSum / iterations, 2),
        avgGames: round(totalGamesSum / iterations, 2),
        pushRate: round(pushCount / iterations, 4),
        tieBreakRate: round(tieBreakCount / iterations, 4),
        playerAWinProbability: round(playerAWins / iterations, 4),
        playerBWinProbability: round(1 - (playerAWins / iterations), 4),
        overCount,
        underCount,
        pushCount,
        iterations,
        validIterations,
        targetLine: line,
        bestOf: normalizedBestOf,
        seed,
        diagnostics,
        inputs: {
            pA: round(normalizedPA, 4),
            pB: round(normalizedPB, 4),
            bpA: round(normalizedBPA, 4),
            bpB: round(normalizedBPB, 4),
            startServerIsA: args.startServerIsA !== false,
            scoringRules: modelRules(args)
        },
        ...buildMarkovMeta()
    };
}

function simulateMatchTotals(args = {}) {
    return simulateTotals(args);
}

function getTotalsProbability(pA, pB, targetLine, bestOf = DEFAULT_BEST_OF, bpA = null, bpB = null, options = {}) {
    return simulateTotals(pA, pB, targetLine, bestOf, bpA, bpB, options);
}


// ============================================================================
// 10. MATCHUP STYLE CLUSTERING ENGINE
// ============================================================================

const PLAYSTYLE_PROFILES = {
    BIG_SERVER: 'BIG_SERVER',
    AGGRESSIVE_BASELINER: 'AGGRESSIVE_BASELINER',
    COUNTER_PUNCHER: 'COUNTER_PUNCHER',
    DEFENSIVE: 'DEFENSIVE',
    ALL_COURT: 'ALL_COURT',
    SERVE_VOLLEY: 'SERVE_VOLLEY',
    CLAY_GRINDER: 'CLAY_GRINDER',
    FLAT_HITTER: 'FLAT_HITTER'
};

function detectPlaystyle(playerStats) {
    if (!playerStats) {
        return PLAYSTYLE_PROFILES.ALL_COURT;
    }

    const {
        aceRate = 0,
        firstServeWon = 0,
        secondServeWon = 0,
        returnPointsWon = 0,
        breakPointsWon = 0,
        netPointsWon = 0,
        rallyLengthAvg = 0,
        winnerUnforcedRatio = 1,
        surface = 'hard'
    } = playerStats;

    const normalizedAceRate = aceRate > 1 ? aceRate / 100 : aceRate;
    const normalizedSurface = normalizeSurface(surface);

    if (normalizedAceRate > 0.12 && firstServeWon > 74) {
        return PLAYSTYLE_PROFILES.BIG_SERVER;
    }

    if (netPointsWon > 68 && normalizedAceRate > 0.08) {
        return PLAYSTYLE_PROFILES.SERVE_VOLLEY;
    }

    if (winnerUnforcedRatio > 1.35 && rallyLengthAvg < 4.5) {
        return PLAYSTYLE_PROFILES.AGGRESSIVE_BASELINER;
    }

    if (returnPointsWon > 39 && rallyLengthAvg > 5.5) {
        return PLAYSTYLE_PROFILES.COUNTER_PUNCHER;
    }

    if (breakPointsWon > 44 && rallyLengthAvg > 6) {
        return PLAYSTYLE_PROFILES.DEFENSIVE;
    }

    if (normalizedSurface === 'clay' && rallyLengthAvg > 5.8) {
        return PLAYSTYLE_PROFILES.CLAY_GRINDER;
    }

    if (rallyLengthAvg < 4 && winnerUnforcedRatio > 1.15) {
        return PLAYSTYLE_PROFILES.FLAT_HITTER;
    }

    return PLAYSTYLE_PROFILES.ALL_COURT;
}

const MATCHUP_EDGES = {
    BIG_SERVER: {
        COUNTER_PUNCHER: -0.06,
        DEFENSIVE: -0.05,
        CLAY_GRINDER: -0.07,
        FLAT_HITTER: 0.04
    },
    AGGRESSIVE_BASELINER: {
        DEFENSIVE: -0.05,
        COUNTER_PUNCHER: -0.04,
        BIG_SERVER: 0.03
    },
    COUNTER_PUNCHER: {
        BIG_SERVER: 0.06,
        AGGRESSIVE_BASELINER: 0.05,
        FLAT_HITTER: 0.04
    },
    DEFENSIVE: {
        AGGRESSIVE_BASELINER: 0.05,
        BIG_SERVER: 0.03
    },
    SERVE_VOLLEY: {
        CLAY_GRINDER: -0.08,
        COUNTER_PUNCHER: -0.04
    },
    CLAY_GRINDER: {
        BIG_SERVER: 0.07,
        SERVE_VOLLEY: 0.08,
        FLAT_HITTER: 0.05
    },
    FLAT_HITTER: {
        DEFENSIVE: -0.05,
        COUNTER_PUNCHER: -0.04
    },
    ALL_COURT: {}
};

function calculateMatchupEdge(styleA, styleB) {
    if (!MATCHUP_EDGES[styleA]) return 0;

    const edge = MATCHUP_EDGES[styleA][styleB];

    if (edge === undefined || edge === null) return 0;

    return Number(edge);
}

function getSurfaceMultiplier(surface) {
    const normalizedSurface = normalizeSurface(surface);

    switch (normalizedSurface) {
        case 'grass':
            return 1.25;
        case 'clay':
            return 1.15;
        case 'indoor_hard':
            return 1.12;
        case 'hard':
        default:
            return 1;
    }
}

function analyzeStyleMatchup(playerAStats, playerBStats, surface = 'hard') {
    const normalizedSurface = normalizeSurface(surface);

    const statsA = {
        ...(playerAStats || {}),
        surface: normalizedSurface
    };

    const statsB = {
        ...(playerBStats || {}),
        surface: normalizedSurface
    };

    const styleA = detectPlaystyle(statsA);
    const styleB = detectPlaystyle(statsB);

    const rawEdge = calculateMatchupEdge(styleA, styleB);
    const reverseRawEdge = calculateMatchupEdge(styleB, styleA);

    // Edge netto di A contro B.
    const netRawEdge = rawEdge - reverseRawEdge;

    const surfaceMultiplier = getSurfaceMultiplier(normalizedSurface);
    const adjustedEdge = netRawEdge * surfaceMultiplier;

    return {
        styleA,
        styleB,
        rawEdge: round(rawEdge, 3),
        reverseRawEdge: round(reverseRawEdge, 3),
        netRawEdge: round(netRawEdge, 3),
        adjustedEdge: round(adjustedEdge, 3),
        adjustedEdgePct: round(adjustedEdge * 100, 2),
        surface: normalizedSurface
    };
}

function applyMatchupAdjustment(baseProbability, matchupEdge, options = {}) {
    const probability = normalizeProbability(baseProbability) * 100;
    const maxShift = toNumber(options.maxShiftPct, 8);

    const shiftPct = clamp(matchupEdge * 100, -maxShift, maxShift);
    const adjusted = probability + shiftPct;

    return clamp(round(adjusted, 2), 5, 95);
}

function getStyleVolatility(styleA, styleB) {
    const volatileCombos = [
        ['BIG_SERVER', 'BIG_SERVER'],
        ['FLAT_HITTER', 'AGGRESSIVE_BASELINER'],
        ['SERVE_VOLLEY', 'BIG_SERVER'],
        ['AGGRESSIVE_BASELINER', 'AGGRESSIVE_BASELINER']
    ];

    for (const combo of volatileCombos) {
        if (combo.includes(styleA) && combo.includes(styleB)) {
            return 0.92;
        }
    }

    return 1;
}


// ============================================================================
// 11. BAYESIAN CONFIDENCE HELPERS
// ============================================================================
//
// Questi helper sono locali e non usano storico.
// Servono per descrivere l'incertezza della simulazione, non la performance.
// ============================================================================

function betaMean(alpha, beta) {
    const a = Math.max(0.0001, Number(alpha));
    const b = Math.max(0.0001, Number(beta));

    return a / (a + b);
}

function betaVariance(alpha, beta) {
    const a = Math.max(0.0001, Number(alpha));
    const b = Math.max(0.0001, Number(beta));
    const total = a + b;

    return (a * b) / (Math.pow(total, 2) * (total + 1));
}

function calculateBayesianConfidence(probability, sampleSize = 100, priorStrength = 20) {
    const p = normalizeProbability(probability);
    const n = Math.max(1, Number(sampleSize) || 1);
    const prior = Math.max(0, Number(priorStrength) || 0);

    const alpha = 1 + (p * n) + (0.5 * prior);
    const beta = 1 + ((1 - p) * n) + (0.5 * prior);

    const mean = betaMean(alpha, beta);
    const variance = betaVariance(alpha, beta);
    const std = Math.sqrt(variance);

    return {
        mean: round(mean, 4),
        lowerBound: round(clamp(mean - (1.96 * std), 0, 1), 4),
        upperBound: round(clamp(mean + (1.96 * std), 0, 1), 4),
        uncertainty: round(clamp(std * 100, 0, 50), 2),
        confidenceScore: round(clamp(100 - (std * 220), 0, 100), 2)
    };
}


// ============================================================================
// 12. HIGH LEVEL TENNIS SIMULATION
// ============================================================================

function runTennisMarkovSimulation(probabilities = {}, context = {}) {
    const pA = normalizeProbability(
        probabilities.player1 ??
        probabilities.p1 ??
        probabilities.pA ??
        probabilities.playerA ??
        0.5
    );

    const pB = normalizeProbability(
        probabilities.player2 ??
        probabilities.p2 ??
        probabilities.pB ??
        probabilities.playerB ??
        0.5
    );

    const bpA = probabilities.bpA !== undefined
        ? normalizeProbability(probabilities.bpA)
        : pA;

    const bpB = probabilities.bpB !== undefined
        ? normalizeProbability(probabilities.bpB)
        : pB;

    const bestOf = normalizeBestOf(modelRules({...context,bestOf:context.bestOf ?? probabilities.bestOf}).bestOf);
    const iterations = normalizeIterations(context.iterations, DEFAULT_ITERATIONS);
    const seed = normalizeSeed(context.seed ?? DEFAULT_SEED);

    const rng = createSeededRng(seed);

    let player1Wins = 0;
    let player2Wins = 0;
    let totalGames = 0;
    let totalTieBreaks = 0;

    const scoreDistribution = {};

    for (let i = 0; i < iterations; i++) {
        const result = simulateMatchOnce({
            pA,
            pB,
            bestOf,
            bpA,
            bpB,
            rng,
            startServerIsA: context.startServerIsA !== false,
            scoringRules: modelRules(context)
        });

        if (result.winner === 'A') player1Wins++;
        else player2Wins++;

        totalGames += result.totalGames;
        totalTieBreaks += result.totalTieBreaks;

        const score = `${result.setsA}-${result.setsB}`;
        scoreDistribution[score] = (scoreDistribution[score] || 0) + 1;
    }

    const player1Probability = player1Wins / iterations;
    const player2Probability = player2Wins / iterations;
    const tieBreakRate = totalTieBreaks / iterations;
    const avgGames = totalGames / iterations;

    const distribution = Object.entries(scoreDistribution)
        .map(([score, count]) => ({
            score,
            probability: round(count / iterations, 4)
        }))
        .sort((a, b) => b.probability - a.probability);

    return {
        probabilities: {
            player1: round(player1Probability, 4),
            player2: round(player2Probability, 4),
            tieBreak: round(tieBreakRate, 4)
        },
        expectedGames: round(avgGames, 2),
        scoreDistribution: distribution,
        confidence: {
            player1: calculateBayesianConfidence(player1Probability, iterations, 10),
            player2: calculateBayesianConfidence(player2Probability, iterations, 10)
        },
        iterations,
        seed,
        bestOf,
        diagnostics: validateMarkovInputs({ pA, pB, bestOf, iterations }),
        ...buildMarkovMeta()
    };
}



// ============================================================================
// 12.1 PROFESSIONAL HIERARCHICAL POINT-LEVEL MODEL - PATCH 19
// ============================================================================
// Samples latent service-point ability from Beta posteriors and then executes
// the existing point/game/set/match Markov chain. This keeps uncertainty at
// the tennis point level instead of adding arbitrary noise to match odds.
// ============================================================================

function sampleStandardNormal(rng) {
    let u = 0;
    let v = 0;
    while (u <= Number.EPSILON) u = rng();
    while (v <= Number.EPSILON) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleGamma(rng, shape) {
    const k = Math.max(0.0001, Number(shape) || 0.0001);
    if (k < 1) {
        const u = Math.max(Number.EPSILON, rng());
        return sampleGamma(rng, k + 1) * Math.pow(u, 1 / k);
    }
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let i = 0; i < 1000; i++) {
        const x = sampleStandardNormal(rng);
        let v = 1 + c * x;
        if (v <= 0) continue;
        v = v * v * v;
        const u = rng();
        if (u < 1 - 0.0331 * x * x * x * x) return d * v;
        if (Math.log(Math.max(Number.EPSILON, u)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
    return k;
}

function sampleBeta(rng, alpha, beta) {
    const a = sampleGamma(rng, Math.max(0.01, Number(alpha) || 0.01));
    const b = sampleGamma(rng, Math.max(0.01, Number(beta) || 0.01));
    const total = a + b;
    return total > 0 ? a / total : 0.5;
}

function betaPosteriorFromMean(mean, sampleSize = 40, priorStrength = 16) {
    const p = normalizeProbability(mean);
    const n = clamp(Number(sampleSize) || 0, 0, 5000);
    const prior = clamp(Number(priorStrength) || 0, 2, 100);
    return {
        alpha: 1 + p * n + 0.5 * prior,
        beta: 1 + (1 - p) * n + 0.5 * prior,
        mean: p,
        effectiveSample: n + prior + 2
    };
}

function wilsonInterval(successes, trials, z = 1.96) {
    const n = Math.max(1, Number(trials) || 1);
    const p = clamp(Number(successes) / n, 0, 1);
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denominator;
    const half = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n) / denominator;
    return {
        lower: round(clamp(center - half, 0, 1), 4),
        upper: round(clamp(center + half, 0, 1), 4)
    };
}

function runProfessionalMarkovMatchModel(input = {}) {
    const pA = normalizeProbability(input.pA ?? input.p1ServePoint ?? input.player1ServePoint ?? 0.62);
    const pB = normalizeProbability(input.pB ?? input.p2ServePoint ?? input.player2ServePoint ?? 0.62);
    const bpA = normalizeProbability(input.bpA ?? input.p1BreakPointServe ?? pA);
    const bpB = normalizeProbability(input.bpB ?? input.p2BreakPointServe ?? pB);
    const sampleA = clamp(Number(input.sampleA ?? input.p1Sample ?? 40), 1, 5000);
    const sampleB = clamp(Number(input.sampleB ?? input.p2Sample ?? 40), 1, 5000);
    const priorStrength = clamp(Number(input.priorStrength ?? 16), 4, 80);
    const scoringRules = modelRules(input);
    const bestOf = normalizeBestOf(scoringRules.bestOf);
    const iterations = normalizeIterations(input.iterations, 2500);
    const seed = normalizeSeed(input.seed ?? DEFAULT_SEED);
    const rng = createSeededRng(seed);
    const posteriorA = betaPosteriorFromMean(pA, sampleA, priorStrength);
    const posteriorB = betaPosteriorFromMean(pB, sampleB, priorStrength);
    const bpPosteriorA = betaPosteriorFromMean(bpA, Math.max(8, sampleA * 0.35), priorStrength);
    const bpPosteriorB = betaPosteriorFromMean(bpB, Math.max(8, sampleB * 0.35), priorStrength);

    let winsA = 0;
    let totalGames = 0;
    let totalTieBreaks = 0;
    let matchesWithTieBreak = 0;
    let truncated = 0;
    const scoreCounts = {};

    for (let i = 0; i < iterations; i++) {
        const latentA = clamp(sampleBeta(rng, posteriorA.alpha, posteriorA.beta), 0.45, 0.90);
        const latentB = clamp(sampleBeta(rng, posteriorB.alpha, posteriorB.beta), 0.45, 0.90);
        const latentBPA = clamp(sampleBeta(rng, bpPosteriorA.alpha, bpPosteriorA.beta), 0.35, 0.90);
        const latentBPB = clamp(sampleBeta(rng, bpPosteriorB.alpha, bpPosteriorB.beta), 0.35, 0.90);
        const result = simulateMatchOnce({
            pA: latentA,
            pB: latentB,
            bpA: latentBPA,
            bpB: latentBPB,
            bestOf,
            rng,
            startServerIsA: input.startServerIsA !== false,
            scoringRules: modelRules(input)
        });
        if (result.winner === 'A') winsA += 1;
        totalGames += result.totalGames;
        totalTieBreaks += result.totalTieBreaks;
        if (result.totalTieBreaks > 0) matchesWithTieBreak += 1;
        if (result.setScores.some(set => set.safetyTruncated)) truncated += 1;
        const score = `${result.setsA}-${result.setsB}`;
        scoreCounts[score] = (scoreCounts[score] || 0) + 1;
    }

    const probabilityA = winsA / iterations;
    const interval = wilsonInterval(winsA, iterations);
    const scoreDistribution = Object.entries(scoreCounts)
        .map(([score, count]) => ({ score, probability: round(count / iterations, 4) }))
        .sort((a, b) => b.probability - a.probability);

    return {
        version: MARKOV_ENGINE_VERSION,
        modelMode: 'HIERARCHICAL_BETA_POINT_GAME_SET_MATCH_MARKOV',
        scoringRules,
        probabilities: {
            player1: round(probabilityA, 4),
            player2: round(1 - probabilityA, 4),
            // AUDIT01 F04: probability of at least one tie-break in the match.
            tieBreak: round(matchesWithTieBreak / iterations, 4)
        },
        expectedTieBreaks: round(totalTieBreaks / iterations, 4),
        tieBreakProbabilityDefinition: 'AT_LEAST_ONE_TIE_BREAK_IN_MATCH',
        confidenceInterval95: interval,
        standardError: round(Math.sqrt(probabilityA * (1 - probabilityA) / iterations), 6),
        expectedGames: round(totalGames / iterations, 2),
        scoreDistribution,
        iterations,
        seed,
        bestOf,
        posterior: {
            player1ServePoint: { alpha: round(posteriorA.alpha, 3), beta: round(posteriorA.beta, 3), effectiveSample: round(posteriorA.effectiveSample, 1) },
            player2ServePoint: { alpha: round(posteriorB.alpha, 3), beta: round(posteriorB.beta, 3), effectiveSample: round(posteriorB.effectiveSample, 1) }
        },
        diagnostics: {
            truncatedRate: round(truncated / iterations, 6),
            uncertaintyAtPointLevel: true,
            deterministicSeed: true,
            warnings: validateMarkovInputs({ pA, pB, bestOf, iterations }).warnings
        },
        ...buildMarkovMeta({ reliabilityMode: 'POINT_LEVEL_BAYESIAN_UNCERTAINTY_NO_DB_PERFORMANCE_CLAIM' })
    };
}

// ============================================================================
// 13. SELF CHECK / DIAGNOSTICA
// ============================================================================

function runMarkovSelfCheck() {
    const seed = 987654321;

    const a = simulateTotals({
        pA: 0.64,
        pB: 0.61,
        targetLine: 22.5,
        bestOf: 3,
        iterations: 2000,
        seed
    });

    const b = simulateTotals({
        pA: 0.64,
        pB: 0.61,
        targetLine: 22.5,
        bestOf: 3,
        iterations: 2000,
        seed
    });

    const deterministic =
        a.probOver === b.probOver &&
        a.probUnder === b.probUnder &&
        a.expectedGames === b.expectedGames &&
        a.pushRate === b.pushRate;

    const probabilitiesOk =
        a.probOver >= 0 && a.probOver <= 1 &&
        a.probUnder >= 0 && a.probUnder <= 1 &&
        Math.abs((a.probOver + a.probUnder) - 1) < 0.0001;

    const professionalA = runProfessionalMarkovMatchModel({ pA: 0.64, pB: 0.61, sampleA: 80, sampleB: 70, iterations: 1200, seed });
    const professionalB = runProfessionalMarkovMatchModel({ pA: 0.64, pB: 0.61, sampleA: 80, sampleB: 70, iterations: 1200, seed });
    const professionalDeterministic = JSON.stringify(professionalA) === JSON.stringify(professionalB);
    const professionalProbabilitiesOk = Math.abs((professionalA.probabilities.player1 + professionalA.probabilities.player2) - 1) < 0.0001;

    return {
        ok: deterministic && probabilitiesOk && professionalDeterministic && professionalProbabilitiesOk,
        deterministic,
        probabilitiesOk,
        professionalDeterministic,
        professionalProbabilitiesOk,
        sample: a,
        professionalSample: professionalA,
        version: MARKOV_ENGINE_VERSION
    };
}


// ============================================================================
// 14. CLASSE COMPATIBILE LEGACY
// ============================================================================

class MarkovTennis {
    static probGame(pServe, pServeBP = null) {
        return probGame(pServe, pServeBP);
    }

    static probTieBreak(pA, pB, options = {}) {
        return probTieBreak(pA, pB, options);
    }

    static probSet(pA, pB, bpA = null, bpB = null, options = {}) {
        return probSet(pA, pB, bpA, bpB, options);
    }

    static probMatch(pA, pB, bestOf = DEFAULT_BEST_OF, bpA = null, bpB = null, options = {}) {
        return probMatch(pA, pB, bestOf, bpA, bpB, options);
    }

    static getSetBetting(pA, pB, bestOf = DEFAULT_BEST_OF, bpA = null, bpB = null, options = {}) {
        return getSetBetting(pA, pB, bestOf, bpA, bpB, options);
    }

    static simulateTotals(pA, pB, targetLine, bestOf = DEFAULT_BEST_OF, bpA = null, bpB = null, options = {}) {
        return simulateTotals(pA, pB, targetLine, bestOf, bpA, bpB, options);
    }

    static simulateMatchTotals(args = {}) {
        return simulateMatchTotals(args);
    }

    static getTotalsProbability(pA, pB, targetLine, bestOf = DEFAULT_BEST_OF, bpA = null, bpB = null, options = {}) {
        return getTotalsProbability(pA, pB, targetLine, bestOf, bpA, bpB, options);
    }

    static runSimulation(probabilities = {}, context = {}) {
        return runTennisMarkovSimulation(probabilities, context);
    }

    static runProfessionalMatchModel(input = {}) {
        return runProfessionalMarkovMatchModel(input);
    }

    static runSelfCheck() {
        return runMarkovSelfCheck();
    }
}


// ============================================================================
// 15. EXPORTS
// ============================================================================

module.exports = {
    // Metadata
    MARKOV_ENGINE_VERSION,

    // Classe legacy
    MarkovTennis,

    // RNG
    createSeededRng,
    normalizeSeed,
    buildMarkovMeta,
    validateMarkovInputs,
    runMarkovSelfCheck,

    // Helpers
    clamp,
    round,
    normalizeProbability,
    normalizeBestOf,
    normalizeIterations,
    normalizeSurface,

    // Markov base
    probGame,
    probTieBreak,
    probSet,
    probMatch,
    getSetBetting,

    // Simulazioni match/totals
    simulateTieBreakOnce,
    simulateSetOnce,
    simulateMatchOnce,
    simulateTotals,
    simulateMatchTotals,
    getTotalsProbability,
    runTennisMarkovSimulation,
    runProfessionalMarkovMatchModel,
    betaPosteriorFromMean,
    sampleBeta,
    wilsonInterval,

    // Matchup style engine
    PLAYSTYLE_PROFILES,
    detectPlaystyle,
    calculateMatchupEdge,
    getSurfaceMultiplier,
    analyzeStyleMatchup,
    applyMatchupAdjustment,
    getStyleVolatility,

    // Confidence locale
    calculateBayesianConfidence
};