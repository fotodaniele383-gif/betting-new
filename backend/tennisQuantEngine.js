// ============================================================================
//  AI BETTING QUANT PRO - TENNIS QUANT ENGINE
//  Hedge Fund Production-Grade Library (Versione 5.1 - Final Export Fix)
// ============================================================================

// ⚡ IMPORTAZIONI GLOBALI
const sackmann = require('./sackmann'); 
const surfaceEngine = require('./tennisSurfaceEngine'); 
const tournamentEngine = require('./tennisTournamentEngine'); 

// ============================================================================
// 🛠️ 0) HELPERS & MATEMATICA DI BASE
// ============================================================================
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, decimals = 3) { return Number(value.toFixed(decimals)); }

function createRng(seed) {
    let s = seed >>> 0;
    return function () {
        s += 0x6D2B79F5;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function normalCdf(z) {
    if (z > 8) return 1; if (z < -8) return 0;
    const sign = z < 0 ? -1 : 1; const x = Math.abs(z) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * x);
    const a1 = 0.254829592; const a2 = -0.284496736; const a3 = 1.421413741; const a4 = -1.453152027; const a5 = 1.061405429;
    const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * erf);
}

function normalize(value, maxValue) { return clamp(value / maxValue, 0, 1); }

// ============================================================================
// 🎾 1) SERVE / RETURN WEIGHTED MODEL
// ============================================================================
const SERVE_RETURN_CONFIG = {
    WEIGHTS: { serve: 0.56, return: 0.44 },
    SURFACE_MULTIPLIERS: { clay: { serve: 0.92, return: 1.10 }, hard: { serve: 1.00, return: 1.00 }, indoor_hard: { serve: 1.12, return: 0.92 }, grass: { serve: 1.18, return: 0.86 } }
};

function calculateServeStrength(playerStats, surface = "hard") {
    if (!playerStats) return 0.5;
    const { firstServeIn = 0.60, firstServeWon = 0.70, secondServeWon = 0.50, aceRate = 0.05, doubleFaultRate = 0.03, holdPercentage = 0.75 } = playerStats;
    const surfaceBoost = SERVE_RETURN_CONFIG.SURFACE_MULTIPLIERS[surface]?.serve || 1;
    const serveScore = ((firstServeIn * 100 * 0.12) + (firstServeWon * 100 * 0.30) + (secondServeWon * 100 * 0.22) + ((aceRate * 100) * 0.18) + (holdPercentage * 100 * 0.25) - ((doubleFaultRate * 100) * 0.07)) / 100;
    return clamp(serveScore * surfaceBoost, 0, 1);
}

function calculateReturnStrength(playerStats, surface = "hard") {
    if (!playerStats) return 0.5;
    const { returnPointsWon = 0.38, breakPointsWon = 0.40, returnGamesWon = 0.22, tieBreakWinRate = 0.50, rallyTolerance = 0.50 } = playerStats;
    const surfaceBoost = SERVE_RETURN_CONFIG.SURFACE_MULTIPLIERS[surface]?.return || 1;
    const returnScore = ((returnPointsWon * 100 * 0.34) + (breakPointsWon * 100 * 0.28) + (returnGamesWon * 100 * 0.24) + (tieBreakWinRate * 100 * 0.08) + ((rallyTolerance * 100) * 0.06)) / 100;
    return clamp(returnScore * surfaceBoost, 0, 1);
}

function calculateHoldProbability(serveStrength, opponentReturnStrength) {
    return clamp(0.50 + ((serveStrength - opponentReturnStrength) * 0.72), 0.35, 0.95);
}

function calculateTieBreakStrength(playerStats, surface = "hard") {
    const { aceRate = 0.05, firstServeWon = 0.70, tieBreakWinRate = 0.50, pressurePointsWon = 0.50 } = playerStats;
    let score = (((aceRate * 100) * 0.26) + (firstServeWon * 100 * 0.28) + (tieBreakWinRate * 100 * 0.28) + (pressurePointsWon * 100 * 0.18)) / 100;
    if (surface === "grass" || surface === "indoor_hard") score *= 1.08;
    return clamp(score, 0, 1);
}

function analyzeServeReturnMatchup(playerAStats, playerBStats, surface = "hard") {
    const serveA = calculateServeStrength(playerAStats, surface); const serveB = calculateServeStrength(playerBStats, surface);
    const returnA = calculateReturnStrength(playerAStats, surface); const returnB = calculateReturnStrength(playerBStats, surface);
    const holdA = calculateHoldProbability(serveA, returnB); const holdB = calculateHoldProbability(serveB, returnA);
    const tieBreakA = calculateTieBreakStrength(playerAStats, surface); const tieBreakB = calculateTieBreakStrength(playerBStats, surface);
    const weightedEdge = ((serveA - serveB) * SERVE_RETURN_CONFIG.WEIGHTS.serve) + ((returnA - returnB) * SERVE_RETURN_CONFIG.WEIGHTS.return);
    return { surface, serveA: round(serveA), serveB: round(serveB), returnA: round(returnA), returnB: round(returnB), holdA: round(holdA), holdB: round(holdB), tieBreakA: round(tieBreakA), tieBreakB: round(tieBreakB), weightedEdge: round(weightedEdge) };
}

function applyServeReturnAdjustment(baseProbability, weightedEdge) {
    const MAX_SHIFT = 13; const adjustment = weightedEdge * MAX_SHIFT * 100;
    return clamp(baseProbability + adjustment, 5, 95);
}

function calculateSetVolatility(holdA, holdB, surface = "hard") {
    let volatility = 1;
    const avgHold = (holdA + holdB) / 2;
    if (avgHold > 0.84) volatility *= 1.12;
    if (surface === "grass" || surface === "indoor_hard") volatility *= 1.08;
    return round(volatility);
}

function calculateTieBreakLikelihood(holdA, holdB) {
    const avgHold = (holdA + holdB) / 2;
    const tbProbability = (avgHold - 0.55) * 2.2;
    return clamp(round(tbProbability), 0, 1);
}

// ============================================================================
// 📊 2) PLAYER & SURFACE METRICS (Logistic Base)
// ============================================================================
function buildPlayerMetrics(raw) {
    if (!raw || typeof raw.servePointsWon !== 'number' || typeof raw.returnPointsWon !== 'number') throw new Error('buildPlayerMetrics: invalid raw data');
    const spw = clamp(raw.servePointsWon, 0.30, 0.85); const rpw = clamp(raw.returnPointsWon, 0.15, 0.60);
    let holdPct = 100 / (1 + Math.exp(-12 * (spw - 0.62)));
    let breakPct = 100 / (1 + Math.exp(-10 * (rpw - 0.36)));
    const denom = Math.max(0.1, 100 - holdPct);
    let rawDr = breakPct / denom;
    let dr = clamp(rawDr, 0.4, 2.5);
    if (typeof raw.realDR === 'number' && isFinite(raw.realDR) && raw.realDR > 0) dr = 0.6 * clamp(raw.realDR, 0.4, 2.5) + 0.4 * dr;
    const spi = 0.7 * holdPct + 0.3 * (100 - breakPct); const rai = breakPct + 100 * rpw;
    return { holdPct, breakPct, dominanceRatio: dr, servicePressureIndex: spi, returnAggressionIndex: rai };
}

function buildSurfaceAdjustedMetrics(raw, surfaceElo) {
    const base = buildPlayerMetrics(raw);
    if (typeof surfaceElo !== 'number' || !isFinite(surfaceElo)) return { ...base, surfaceElo: null };

    const elo = surfaceElo;
    const delta = elo - 1800;
    const adj = clamp(delta / 100 * 1.5, -5, 5);

    const holdAdj = clamp(base.holdPct + adj, 0, 100);
    const breakAdj = clamp(base.breakPct + adj * 0.7, 0, 100); 

    const denom = Math.max(0.1, 100 - holdAdj);
    const drAdj = clamp(breakAdj / denom, 0.4, 2.5);

    const spiAdj = 0.7 * holdAdj + 0.3 * (100 - breakAdj);
    const raiAdj = breakAdj + (base.returnAggressionIndex - base.breakPct);

    return { holdPct: holdAdj, breakPct: breakAdj, dominanceRatio: drAdj, servicePressureIndex: spiAdj, returnAggressionIndex: raiAdj, surfaceElo: elo };
}

// ============================================================================
// 🧮 3) DYNAMICS E MONTE CARLO
// ============================================================================
function estimateSetDynamics(p1Metrics, p2Metrics) {
    if (!p1Metrics || !p2Metrics) throw new Error('estimateSetDynamics: missing metrics');
    const h1 = clamp(p1Metrics.holdPct, 0, 100); const h2 = clamp(p2Metrics.holdPct, 0, 100);
    const avgHold = (h1 + h2) / 2;
    const tieBreakProb = 1 / (1 + Math.exp(-0.25 * (avgHold - 82)));
    return { tieBreakProb, avgGamesPerSet: 8.5 + (4.0 * tieBreakProb), varianceGamesPerSet: 2.0 + 3 * tieBreakProb };
}

function estimateTotalsProbabilities(p1Metrics, p2Metrics, line) {
    if (typeof line !== 'number' || !isFinite(line)) throw new Error('estimateTotalsProbabilities: invalid line');
    const setDyn = estimateSetDynamics(p1Metrics, p2Metrics);
    const diffHold = Math.abs(p1Metrics.holdPct - p2Metrics.holdPct) / 100;
    const prob3rdSet = Math.max(0, 0.375 - (diffHold * 0.8));
    const mean = (2 * setDyn.avgGamesPerSet) + (prob3rdSet * setDyn.avgGamesPerSet);
    const variance = (2 * setDyn.varianceGamesPerSet) + (prob3rdSet * setDyn.varianceGamesPerSet);
    const stdDev = Math.sqrt(Math.max(0, variance));
    if (stdDev <= 0) return { probOver: 1 - (line >= mean ? 1 : 0), probUnder: line >= mean ? 1 : 0 };
    const z = (line + 0.5 - mean) / stdDev;
    const probUnder = normalCdf(z);
    return { probOver: 1 - probUnder, probUnder };
}

function simulateSetGames(rng, hold1, hold2) {
    let g1 = 0, g2 = 0, server = 1;
    while (true) {
        const r = rng();
        if (server === 1) { if (r < hold1) g1++; else g2++; } else { if (r < hold2) g2++; else g1++; }
        server = 3 - server;
        if (g1 >= 6 || g2 >= 6) {
            if (Math.abs(g1 - g2) >= 2) return { games: g1 + g2, winner: g1 > g2 ? 1 : 2 };
            if (g1 === 6 && g2 === 6) return { games: 13, winner: rng() < (hold1 / (hold1 + hold2)) ? 1 : 2 };
        }
    }
}

function simulateMatchTotalGames(rng, hold1, hold2) {
    let sets1 = 0, sets2 = 0, totalGames = 0;
    while (sets1 < 2 && sets2 < 2) {
        const setResult = simulateSetGames(rng, hold1, hold2);
        totalGames += setResult.games;
        if (setResult.winner === 1) sets1++; else sets2++;
    }
    return totalGames;
}

function estimateTotalsProbabilitiesMonteCarlo(p1Metrics, p2Metrics, line, options) {
    if (typeof line !== 'number' || !isFinite(line)) throw new Error('Invalid line MC');
    const surfaceStr = (options && options.surface) ? options.surface : "hard";
    const iters = surfaceEngine.getSimulationIterations(surfaceStr);
    const seed = (options && typeof options.seed === 'number') ? options.seed : Date.now();
    const h1 = clamp(p1Metrics.holdPct, 0, 100) / 100; const h2 = clamp(p2Metrics.holdPct, 0, 100) / 100;
    const rng = createRng(seed);
    let overCount = 0, underCount = 0, pushCount = 0, sum = 0, sumSq = 0;
    
    for (let i = 0; i < iters; i++) {
        const totalGames = simulateMatchTotalGames(rng, h1, h2);
        sum += totalGames; sumSq += totalGames * totalGames;
        if (totalGames > line) overCount++; else if (totalGames < line) underCount++; else pushCount++;
    }
    
    const validIters = iters - pushCount;
    const probOver = validIters > 0 ? overCount / validIters : 0;
    const probUnder = validIters > 0 ? underCount / validIters : 0;
    const meanTotalGames = sum / iters;
    const variance = sumSq / iters - meanTotalGames * meanTotalGames;

    return { probOver, probUnder, meanTotalGames, stdTotalGames: Math.sqrt(Math.max(variance, 0)) };
}

// ============================================================================
// 🧠 4) MATCHUP CLASSIFICATION & ADVANCED METRICS
// ============================================================================
function classifyMatchup(p1Metrics, p2Metrics) {
    const profiles = {};
    function classifySingle(m) {
        const h = m.holdPct, b = m.breakPct;
        if (h >= 85 && b <= 20) return 'serveBot';
        if (h <= 70 && b >= 25) return 'clayGrinder';
        if (h >= 80 && b >= 22) return 'aggressiveAllCourt';
        return 'balanced';
    }
    profiles.p1Profile = classifySingle(p1Metrics);
    profiles.p2Profile = classifySingle(p2Metrics);

    if (profiles.p1Profile === 'serveBot' && profiles.p2Profile === 'serveBot') profiles.matchupType = 'serveBotDuel';
    else if (profiles.p1Profile === 'clayGrinder' && profiles.p2Profile === 'clayGrinder') profiles.matchupType = 'clayWar';
    else if ((profiles.p1Profile === 'serveBot' && profiles.p2Profile === 'clayGrinder') || (profiles.p2Profile === 'serveBot' && profiles.p1Profile === 'clayGrinder')) profiles.matchupType = 'contrastServeVsReturn';
    else profiles.matchupType = 'mixedBalanced';

    return profiles;
}

function calculateAdvancedMetrics(p1Name, p2Name, surface, date) {
    const rawData = sackmann.getAdvancedMatchup(p1Name, p2Name, surface, date);
    if (!rawData || !rawData.hasData) return { hasAdvancedData: false };

    let p1_spw = rawData.p1_point; let p1_rpw = 1 - rawData.p2_point;
    let p2_spw = rawData.p2_point; let p2_rpw = 1 - rawData.p1_point;

    const volatilityIndex = surfaceEngine.getSurfaceVolatility(surface);
    const isWTA = p1_spw < 0.63 && p2_spw < 0.63; 
    if (isWTA) {
        let wtaPenalty = 0.02 + (volatilityIndex * 0.015);
        p1_spw -= wtaPenalty; p1_rpw += wtaPenalty;
        p2_spw -= wtaPenalty; p2_rpw += wtaPenalty;
    }

    const p1Raw = { servePointsWon: p1_spw, returnPointsWon: p1_rpw };
    const p2Raw = { servePointsWon: p2_spw, returnPointsWon: p2_rpw };
    const p1Metrics = buildPlayerMetrics(p1Raw); const p2Metrics = buildPlayerMetrics(p2Raw);
    const setDyn = estimateSetDynamics(p1Metrics, p2Metrics);
    
    const diffHold = Math.abs(p1Metrics.holdPct - p2Metrics.holdPct) / 100;
    const prob3rdSet = Math.max(0, 0.375 - (diffHold * 0.8));
    const expectedGamesMatch = (2 * setDyn.avgGamesPerSet) + (prob3rdSet * setDyn.avgGamesPerSet);
    const srAnalysis = analyzeServeReturnMatchup({ firstServeWon: p1_spw, returnPointsWon: p1_rpw }, { firstServeWon: p2_spw, returnPointsWon: p2_rpw }, surface);

    let tieBreakRisk = "Basso";
    const tbMultiplier = surfaceEngine.getSurfaceProfile(surface).tiebreakMultiplier;
    const finalTbRisk = setDyn.tieBreakProb * tbMultiplier;

    if (finalTbRisk > 0.40) tieBreakRisk = "Molto Alto 🚨";
    else if (finalTbRisk > 0.25) tieBreakRisk = "Moderato ⚠️";

    return {
        hasAdvancedData: true,
        p1: p1Metrics, p2: p2Metrics,
        serveReturnEdge: srAnalysis.weightedEdge,
        rawRanks: { r1: rawData.p1_rank, r2: rawData.p2_rank },
        matchDynamics: { avgGamesPerSet: setDyn.avgGamesPerSet, expectedGames2Sets: expectedGamesMatch, tieBreakRisk: tieBreakRisk, profile: "Logistic Regression Output" }
    };
}

// ============================================================================
// ⚖️ 5) DECISION ENGINE (Verdetto con Anti-Toxic Trap & Tournament Context)
// ============================================================================
function generateVerdict(cleanPred, realEdge, finalConfidence, SR, p1Data, p2Data, totalsLine, rankDelta, underdogClay, isWTA, sackmannSample) {
    const p1StatsMock = { ranking: rankDelta > 0 ? 50 - (rankDelta/2) : 50, age: 26, careerMatches: 150 };
    const p2StatsMock = { ranking: rankDelta > 0 ? 50 + (rankDelta/2) : 50, age: 26, careerMatches: 150 };
    
    const tContext = tournamentEngine.analyzeTournamentContext(p1StatsMock, p2StatsMock, "atp_250");
    const tournamentConfAdj = tournamentEngine.getTournamentBetConfidence(tContext);
    
    finalConfidence = finalConfidence * tournamentConfAdj;

    if (SR > 0.65 && (p1Data.nlpConfidence < 0.35 || p2Data.nlpConfidence < 0.35) && sackmannSample < 10) {
        return { action: '🔴 ALTO RISCHIO', isHighRisk: true, reason: '⚠️ ATTENZIONE – Match troppo rumoroso. Dati storici insufficienti o segnali contrastanti. Skip Assoluto.' };
    }

    const highEdge = realEdge >= 7.5; const midEdge = realEdge >= 3.0; const lowEdge = realEdge <= 0.5;
    const highConf = finalConfidence >= 70; const midConf = finalConfidence >= 55;
    const highRisk = SR >= 0.7; 

    const isO = cleanPred.includes('O') || cleanPred.includes('OVER');
    const isU = cleanPred.includes('U') || cleanPred.includes('UNDER');
    const isML = cleanPred === '1' || cleanPred === '2';
    
    const hardVeto = p1Data.tactics.injuryOut || p2Data.tactics.injuryOut;
    if (hardVeto && (isO || isU)) {
        return { action: '🔴 ALTO RISCHIO', isHighRisk: true, reason: 'Rischio ritiro confermato. EDGE invalidato per gli OVER/UNDER. Rischio Void altissimo.' };
    }

    if (isML && realEdge < 5.0) {
        return { action: '🔴 ALTO RISCHIO', isHighRisk: true, reason: 'Veto Matematico: Moneyline vietata con Edge inferiore al 5.0%. Evitare trappole underdog.' };
    }

    if (lowEdge || finalConfidence < 40 || highRisk || (tContext.upsetRisk > 1.20 && realEdge < 6.0)) {
        return { action: '🔴 ALTO RISCHIO', isHighRisk: true, reason: 'Veto Matematico/Torneo: Edge basso, bassa Conviction o Torneo altamente instabile (Rischio Sorpresa). Skip.' };
    }

    if (isO) {
        if (isWTA && SR > 0.5 && totalsLine > 18.5 && realEdge < 5.0) return { action: '🔴 ALTO RISCHIO', isHighRisk: true, reason: 'Scommessa Altamente Tossica: Piccolo vantaggio matematico annullato da altissimo rischio Blowout.' };
        if (isWTA && totalsLine <= 20.5 && rankDelta > 60 && underdogClay >= 55) return { action: highEdge ? '🔥 SUPER VALUE' : '📊 EDGE TECNICO', isHighRisk: false, reason: `WTA Low Line Over: Divario ELO ingannevole, match lottato.` };
        if (highEdge && highConf && !highRisk) return { action: '🔥 SUPER VALUE', isHighRisk: false, reason: 'Edge elevato e modello confidente. Ideale per Over.' };
        return { action: midEdge && midConf ? '📊 EDGE TECNICO' : '⚠️ ATTENZIONE', isHighRisk: false, reason: 'Verdetto quantitativo calcolato con Modello Logistico.' };
    }

    if (isU) {
        if (highEdge && highConf && !highRisk) return { action: '🔥 SUPER VALUE', isHighRisk: false, reason: 'Dinamiche Set allineate per Under veloci.' };
        return { action: midEdge && midConf ? '📊 EDGE TECNICO' : '⚠️ ATTENZIONE', isHighRisk: false, reason: 'Verdetto quantitativo calcolato con Modello Logistico.' };
    }

    if (isML) {
        if (hardVeto) return { action: '🔴 ALTO RISCHIO', isHighRisk: true, reason: 'Il match presenta gravi allerte mediche. Scommettere su ML è gambling puro.' };
        if (highEdge && highConf && !highRisk) return { action: '🔥 SUPER VALUE', isHighRisk: false, reason: 'Edge elevato, dominanza DR confermata.' };
        if (midEdge && midConf && !highRisk) return { action: '🟢 VIA LIBERA', isHighRisk: false, reason: 'Edge positivo e rischio accettabile. Bet coerente con mandato quantitativo.' };
        return { action: '⚠️ ATTENZIONE', isHighRisk: false, reason: 'Edge positivo ma Model Conviction o Contest Torneo sotto soglia di sicurezza. Stake ridotto.' };
    }
    return { action: '⚠️ ATTENZIONE', isHighRisk: false, reason: 'Edge limitato.' };
}

// ============================================================================
// 🎯 6) ALTERNATIVE EDGE FINDER (Pivot Matrix)
// ============================================================================
function generateBetSuggestion(p1Name, p2Name, dr1, dr2, p1Data, p2Data, avgGames, tbRisk, isWTA, cleanPred, realEdge, currentAction) {
    let favName = dr1 > dr2 ? p1Name.split(' ').pop() : p2Name.split(' ').pop();
    let dogName = dr1 > dr2 ? p2Name.split(' ').pop() : p1Name.split(' ').pop();
    let drDelta = Math.max(dr1, dr2) - Math.min(dr1, dr2);
    
    const isML = cleanPred === '1' || cleanPred === '2';
    const isO = cleanPred.includes('O') || cleanPred.includes('OVER');
    const isU = cleanPred.includes('U') || cleanPred.includes('UNDER');
    
    const isBetRejected = currentAction.includes('RISCHIO') || currentAction.includes('ATTENZIONE');

    if (p1Data.tactics.injuryOut) return { market: "Inversione Moneyline", selection: `${p2Name.split(' ').pop()} Vincente`, rationale: `Veto Medico su ${p1Name.split(' ').pop()}. Gioca contro il giocatore infortunato.` };
    if (p2Data.tactics.injuryOut) return { market: "Inversione Moneyline", selection: `${p1Name.split(' ').pop()} Vincente`, rationale: `Veto Medico su ${p2Name.split(' ').pop()}. Gioca contro il giocatore infortunato.` };

    if (!isBetRejected) {
        if (isML && realEdge >= 5.0) {
            let targetPlayerName = cleanPred === '1' ? p1Name.split(' ').pop() : p2Name.split(' ').pop();
            return { market: "Conferma Pronostico", selection: `${targetPlayerName} Vincente (Moneyline)`, rationale: `Pronostico validato! C'è un Edge forte (+${realEdge.toFixed(1)}%) sul tuo segno.` };
        }
        if ((isO || isU) && realEdge > 3.0) {
            return { market: "Conferma Totals", selection: "Mantieni la tua giocata", rationale: `Il mercato dei Games offre un vantaggio strutturale validato dalla Simulazione Monte Carlo.` };
        }
    }

    if (isBetRejected) {
        if (isO) {
            if (drDelta >= 0.15 || currentAction.includes('Tossica')) {
                let handicap = isWTA ? "-4.5 / -5.5" : "-3.5";
                return { market: "Handicap Dominante", selection: `${favName} ${handicap} Games`, rationale: `L'Over scartato per rischio Blowout. Gioca l'handicap pesante sul favorito (${favName}).` };
            }
            if (isWTA && avgGames < 9.0) {
                return { market: "Totals (Inversione)", selection: "UNDER Games", rationale: `Servizi troppo deboli. Rischio di set veloci chiusi 6-2 o 6-3. Fai Pivot sull'UNDER.` };
            }
        }

        if (isU) {
            if (avgGames >= 10.2 || tbRisk.includes('Alto') || tbRisk.includes('Moderato')) {
                return { market: "Totals (Inversione)", selection: "OVER Games", rationale: `L'Under bocciato per alto rischio Tie-Break (Avg: ${avgGames.toFixed(1)}). Fai Pivot sull'OVER.` };
            }
            if (drDelta >= 0.12 && Math.max(dr1, dr2) > 1.0) {
                return { market: "Moneyline / Handicap", selection: `${favName} Vincente`, rationale: `L'Under è instabile, ma c'è un forte mismatch tecnico (Delta DR: ${drDelta.toFixed(2)}). Dirotta la bet sul favorito.` };
            }
        }

        if (isML) {
            if (drDelta < 0.05 && avgGames >= 10.0) {
                return { market: "Totals (Maratona)", selection: "OVER Games", rationale: `Il match è un puro coin-flip tattico. Evita la Moneyline, i dati puntano a una lunga maratona (OVER).` };
            }
            
            let userPlayedFav = (cleanPred === '1' && dr1 > dr2) || (cleanPred === '2' && dr2 > dr1);
            let favFatigue = dr1 > dr2 ? p1Data.tactics.fatigue : p2Data.tactics.fatigue;
            
            if (userPlayedFav && favFatigue) {
                return { market: "Upset Alert", selection: `${dogName} Vincente (Underdog)`, rationale: `Il favorito mostra pesanti segnali di fatica (Let-down spot). Fai Pivot sull'Underdog.` };
            }
        }
    }

    return { market: "Live Betting", selection: "Attendi In-Play", rationale: "Nessun pronostico pre-match offre garanzie strutturali sicure. Lascia sfogare i primi 3 game." };
}

// ============================================================================
// 🏃‍♂️ 7) FATIGUE & TRAVEL ENGINE (Context Layer)
// ============================================================================
const FATIGUE_CONFIG = { MAX_TRAVEL_KM: 12000, MAX_MATCH_MINUTES: 900, MAX_CONSECUTIVE_DAYS: 14, WEIGHTS: { travel: 0.28, minutes: 0.32, consecutive: 0.18, recovery: 0.22 } };

function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; const dLat = ((lat2 - lat1) * Math.PI) / 180; const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getRecoveryPenalty(hoursRecovery) {
    if (hoursRecovery >= 72) return 0; if (hoursRecovery >= 48) return 0.15;
    if (hoursRecovery >= 36) return 0.35; if (hoursRecovery >= 24) return 0.60;
    return 1;
}

function calculateFatigueScore(playerData) {
    if (!playerData) return 0;
    const { matchesLast7Days = [], consecutiveDaysPlayed = 0, hoursRecovery = 72, previousTournament = null, currentTournament = null } = playerData;
    const totalMinutes = matchesLast7Days.reduce((sum, m) => sum + (m.minutes || 0), 0);
    let travelKm = 0;
    if (previousTournament && currentTournament && previousTournament.lat && previousTournament.lon && currentTournament.lat && currentTournament.lon) {
        travelKm = getDistanceKm(previousTournament.lat, previousTournament.lon, currentTournament.lat, currentTournament.lon);
    }
    const fatigueScore = (normalize(travelKm, FATIGUE_CONFIG.MAX_TRAVEL_KM) * FATIGUE_CONFIG.WEIGHTS.travel) +
                         (normalize(totalMinutes, FATIGUE_CONFIG.MAX_MATCH_MINUTES) * FATIGUE_CONFIG.WEIGHTS.minutes) +
                         (normalize(consecutiveDaysPlayed, FATIGUE_CONFIG.MAX_CONSECUTIVE_DAYS) * FATIGUE_CONFIG.WEIGHTS.consecutive) +
                         (getRecoveryPenalty(hoursRecovery) * FATIGUE_CONFIG.WEIGHTS.recovery);
    return clamp(fatigueScore, 0, 1);
}

function applyFatigueAdjustment(baseProbability, fatigueScoreDiff) {
    return clamp(baseProbability - (fatigueScoreDiff * 11), 5, 95);
}

function analyzeMatchFatigue(playerA, playerB) {
    const fatigueA = calculateFatigueScore(playerA); const fatigueB = calculateFatigueScore(playerB);
    const fatigueDiff = fatigueA - fatigueB;
    let fatigueEdge = "NONE";
    if (fatigueDiff > 0.18) fatigueEdge = "PLAYER_B_ADVANTAGE"; else if (fatigueDiff < -0.18) fatigueEdge = "PLAYER_A_ADVANTAGE";
    return { fatigueA: Number(fatigueA.toFixed(3)), fatigueB: Number(fatigueB.toFixed(3)), fatigueDiff: Number(fatigueDiff.toFixed(3)), fatigueEdge };
}

// ============================================================================
// 📦 8) EXPORTS DEFINITIVI E CONTROLLATI
// ============================================================================
module.exports = {
    clamp, round, normalCdf, normalize, createRng,
    calculateServeStrength, calculateReturnStrength, calculateHoldProbability, calculateTieBreakStrength, analyzeServeReturnMatchup, applyServeReturnAdjustment,
    buildPlayerMetrics, buildSurfaceAdjustedMetrics, 
    estimateSetDynamics, estimateTotalsProbabilities, simulateSetGames, simulateMatchTotalGames, estimateTotalsProbabilitiesMonteCarlo, calculateSetVolatility, calculateTieBreakLikelihood,
    classifyMatchup, calculateAdvancedMetrics, 
    generateVerdict, generateBetSuggestion, 
    calculateFatigueScore, analyzeMatchFatigue, applyFatigueAdjustment, getDistanceKm, getRecoveryPenalty
};