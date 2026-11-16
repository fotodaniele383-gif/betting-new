// ============================================================================
// TOURNAMENT CONTEXT MODEL
// AI BETTING QUANT PRO - Tournament Importance Adaptive Engine
// tennisTournamentEngine.js
// ============================================================================

// --------------------------------------------------------------------------
// 🏆 TOURNAMENT CONFIG
// --------------------------------------------------------------------------
const TOURNAMENT_CONTEXT = {
    grand_slam: {
        pressureMultiplier: 1.18,
        fatigueMultiplier: 1.12,
        upsetMultiplier: 0.92, // Difficile vedere sorprese clamorose al meglio dei 5 set
        eliteBoost: 1.15,
        experienceWeight: 1.20,
        motivationWeight: 1.18,
        volatility: 0.90
    },
    masters_1000: {
        pressureMultiplier: 1.10,
        fatigueMultiplier: 1.08,
        upsetMultiplier: 0.95,
        eliteBoost: 1.10,
        experienceWeight: 1.12,
        motivationWeight: 1.08,
        volatility: 0.95
    },
    atp_500: {
        pressureMultiplier: 1.00,
        fatigueMultiplier: 1.00,
        upsetMultiplier: 1.00,
        eliteBoost: 1.00,
        experienceWeight: 1.00,
        motivationWeight: 1.00,
        volatility: 1.00
    },
    atp_250: {
        pressureMultiplier: 0.92,
        fatigueMultiplier: 0.96,
        upsetMultiplier: 1.12, // Rischio tanking alto per i big
        eliteBoost: 0.94,
        experienceWeight: 0.90,
        motivationWeight: 0.88,
        volatility: 1.10
    },
    challenger: {
        pressureMultiplier: 0.86,
        fatigueMultiplier: 1.05,
        upsetMultiplier: 1.22, // Elevatissima instabilità
        eliteBoost: 0.82,
        experienceWeight: 0.84,
        motivationWeight: 0.92,
        volatility: 1.20
    },
    itf: {
        pressureMultiplier: 0.78,
        fatigueMultiplier: 1.12,
        upsetMultiplier: 1.34,
        eliteBoost: 0.72,
        experienceWeight: 0.74,
        motivationWeight: 0.84,
        volatility: 1.32
    }
};

// --------------------------------------------------------------------------
// 🛠️ HELPERS
// --------------------------------------------------------------------------
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 3) {
    return Number(value.toFixed(decimals));
}

function getTournamentProfile(tournamentType = "atp_500") {
    return TOURNAMENT_CONTEXT[tournamentType] || TOURNAMENT_CONTEXT.atp_500;
}

// --------------------------------------------------------------------------
// 🧠 SCORES & MULTIPLIERS
// --------------------------------------------------------------------------
function calculateBigMatchExperience(playerStats, tournamentType) {
    const { grandSlamsPlayed = 0, mastersPlayed = 0, finalsPlayed = 0, careerMatches = 0 } = playerStats;
    const profile = getTournamentProfile(tournamentType);

    let score = 0.5;
    score += (grandSlamsPlayed * 0.015);
    score += (mastersPlayed * 0.008);
    score += (finalsPlayed * 0.012);
    score += (careerMatches * 0.00015);
    score *= profile.experienceWeight;

    return clamp(score, 0.4, 1.4);
}

function calculateMotivationScore(playerStats, tournamentType) {
    const { ranking = 999, age = 25, recentForm = 0.5, defendingPoints = false, homeCountry = false } = playerStats;
    let motivation = 1;

    // Giovani più motivati nei tornei minori per fare punti
    if (ranking > 40 && age < 24 && (tournamentType === "challenger" || tournamentType === "itf")) {
        motivation += 0.12;
    }

    // Top players estremamente motivati negli Slam/Masters
    if (ranking <= 15 && (tournamentType === "grand_slam" || tournamentType === "masters_1000")) {
        motivation += 0.10;
    }

    if (defendingPoints) motivation += 0.08;
    if (homeCountry) motivation += 0.05;

    motivation += ((recentForm - 0.5) * 0.25);
    
    const profile = getTournamentProfile(tournamentType);
    motivation *= profile.motivationWeight;

    return clamp(motivation, 0.75, 1.35);
}

function calculateUpsetRisk(playerAStats, playerBStats, tournamentType) {
    const { ranking: rankA = 999 } = playerAStats;
    const { ranking: rankB = 999 } = playerBStats;

    const rankingGap = Math.abs(rankA - rankB);
    const profile = getTournamentProfile(tournamentType);

    let upsetRisk = 1;
    upsetRisk *= profile.upsetMultiplier;

    // Ranking simili = partita più tirata = più varianza
    if (rankingGap < 20) upsetRisk *= 1.12;

    if (tournamentType === "challenger" || tournamentType === "itf") {
        upsetRisk *= 1.10;
    }

    return clamp(upsetRisk, 0.85, 1.45);
}

function calculateEliteBoost(playerStats, tournamentType) {
    const { ranking = 999, grandSlamsWon = 0, careerWinRate = 50 } = playerStats;
    const profile = getTournamentProfile(tournamentType);

    let boost = 1;
    if (ranking <= 10) boost += 0.08;
    if (grandSlamsWon > 0) boost += 0.06;
    if (careerWinRate > 68) boost += 0.04;

    boost *= profile.eliteBoost;
    return clamp(boost, 0.9, 1.35);
}

// --------------------------------------------------------------------------
// 🎯 MAIN TOURNAMENT ANALYSIS
// --------------------------------------------------------------------------
function analyzeTournamentContext(playerAStats, playerBStats, tournamentType = "atp_500") {
    const profile = getTournamentProfile(tournamentType);

    const experienceA = calculateBigMatchExperience(playerAStats, tournamentType);
    const experienceB = calculateBigMatchExperience(playerBStats, tournamentType);

    const motivationA = calculateMotivationScore(playerAStats, tournamentType);
    const motivationB = calculateMotivationScore(playerBStats, tournamentType);

    const eliteBoostA = calculateEliteBoost(playerAStats, tournamentType);
    const eliteBoostB = calculateEliteBoost(playerBStats, tournamentType);

    const upsetRisk = calculateUpsetRisk(playerAStats, playerBStats, tournamentType);

    return {
        tournamentType,
        experienceA: round(experienceA),
        experienceB: round(experienceB),
        motivationA: round(motivationA),
        motivationB: round(motivationB),
        eliteBoostA: round(eliteBoostA),
        eliteBoostB: round(eliteBoostB),
        upsetRisk: round(upsetRisk),
        volatility: round(profile.volatility)
    };
}

// --------------------------------------------------------------------------
// 📉 ADJUSTMENTS
// --------------------------------------------------------------------------
function applyTournamentAdjustment(baseProbability, tournamentAnalysis) {
    const { experienceA, experienceB, motivationA, motivationB, eliteBoostA, eliteBoostB, upsetRisk, volatility } = tournamentAnalysis;

    const experienceEdge = (experienceA - experienceB) * 5.5;
    const motivationEdge = (motivationA - motivationB) * 4.5;
    const eliteEdge = (eliteBoostA - eliteBoostB) * 5.0;

    const rawAdjustment = experienceEdge + motivationEdge + eliteEdge;

    // L'Upset Risk funge da smorzatore: più c'è rischio sorprese, più l'adjustment viene ridotto
    const adjustedShift = rawAdjustment / upsetRisk;

    // Volatility penalty schiaccia le probabilità verso il 50%
    const volatilityPenalty = volatility > 1.0 ? 0.96 : 1.0;

    const finalProbability = (baseProbability + adjustedShift) * volatilityPenalty;
    return clamp(finalProbability, 5, 95);
}

function getTournamentBetConfidence(tournamentAnalysis) {
    const { upsetRisk, volatility } = tournamentAnalysis;
    let confidence = 1;
    
    // Riduciamo la confidenza matematica del modello se il torneo è molto volatile
    confidence /= upsetRisk;
    confidence /= volatility;

    return clamp(round(confidence), 0.72, 1.12);
}

// --------------------------------------------------------------------------
// 📦 EXPORTS
// --------------------------------------------------------------------------
module.exports = {
    getTournamentProfile,
    analyzeTournamentContext,
    applyTournamentAdjustment,
    getTournamentBetConfidence
};