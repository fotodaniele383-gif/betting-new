// ============================================================================
//  AI BETTING QUANT PRO - TENNIS SURFACE REGIME ENGINE
//  Versione: 1.2 (Clean Slate)
// ============================================================================

const SURFACE_REGIMES = {
    clay: { aceMultiplier: 0.82, holdMultiplier: 0.91, breakMultiplier: 1.14, tiebreakMultiplier: 0.78, volatility: 0.88, comebackFactor: 1.12, rallyMultiplier: 1.25 },
    hard: { aceMultiplier: 1.00, holdMultiplier: 1.00, breakMultiplier: 1.00, tiebreakMultiplier: 1.00, volatility: 1.00, comebackFactor: 1.00, rallyMultiplier: 1.00 },
    indoor_hard: { aceMultiplier: 1.18, holdMultiplier: 1.14, breakMultiplier: 0.87, tiebreakMultiplier: 1.22, volatility: 1.12, comebackFactor: 0.92, rallyMultiplier: 0.84 },
    grass: { aceMultiplier: 1.26, holdMultiplier: 1.18, breakMultiplier: 0.80, tiebreakMultiplier: 1.28, volatility: 1.20, comebackFactor: 0.86, rallyMultiplier: 0.74 }
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function getSurfaceProfile(surface = "hard") {
    return SURFACE_REGIMES[surface.toLowerCase()] || SURFACE_REGIMES.hard;
}

function applySurfaceAdjustments(playerStats, surface = "hard") {
    const profile = getSurfaceProfile(surface);
    const adjusted = { ...playerStats };
    adjusted.aceRate = (playerStats.aceRate || 0) * profile.aceMultiplier;
    adjusted.firstServeWon = (playerStats.firstServeWon || 0) * profile.holdMultiplier;
    adjusted.secondServeWon = (playerStats.secondServeWon || 0) * profile.holdMultiplier;
    adjusted.returnPointsWon = (playerStats.returnPointsWon || 0) * profile.breakMultiplier;
    adjusted.breakPointsWon = (playerStats.breakPointsWon || 0) * profile.breakMultiplier;
    adjusted.tieBreakStrength = (playerStats.tieBreakStrength || 1) * profile.tiebreakMultiplier;
    adjusted.rallyTolerance = (playerStats.rallyTolerance || 1) * profile.rallyMultiplier;
    return adjusted;
}

function getSurfaceConfidence(playerStats, surface = "hard") {
    const { matchesOnSurface = 0, winRateOnSurface = 50, last12MonthsMatches = 0 } = playerStats;
    let confidence = 1.0;
    if (matchesOnSurface < 5) confidence *= 0.82; else if (matchesOnSurface < 15) confidence *= 0.92;
    if (winRateOnSurface > 68) confidence *= 1.08; else if (winRateOnSurface < 42) confidence *= 0.88;
    if (last12MonthsMatches < 10) confidence *= 0.85;
    if (surface.toLowerCase() === "grass" && matchesOnSurface < 8) confidence *= 0.80;
    return clamp(confidence, 0.65, 1.20);
}

function getSurfaceVolatility(surface = "hard") {
    return getSurfaceProfile(surface).volatility;
}

function analyzeSurfaceMatchup(playerAStats, playerBStats, surface = "hard") {
    const adjustedA = applySurfaceAdjustments(playerAStats, surface);
    const adjustedB = applySurfaceAdjustments(playerBStats, surface);
    const confidenceA = getSurfaceConfidence(playerAStats, surface);
    const confidenceB = getSurfaceConfidence(playerBStats, surface);
    const confidenceDiff = confidenceA - confidenceB;

    return {
        surface: surface.toLowerCase(), adjustedA, adjustedB,
        confidenceA: Number(confidenceA.toFixed(3)), confidenceB: Number(confidenceB.toFixed(3)),
        confidenceDiff: Number(confidenceDiff.toFixed(3)), volatility: getSurfaceVolatility(surface)
    };
}

function applySurfaceProbabilityAdjustment(baseProbability, confidenceDiff, surface) {
    const profile = getSurfaceProfile(surface);
    const shift = confidenceDiff * 7;
    const volatilityPenalty = profile.volatility > 1.1 ? 0.96 : 1.0;
    return clamp((baseProbability + shift) * volatilityPenalty, 5, 95);
}

function getSimulationIterations(surface) {
    switch(surface.toLowerCase()) {
        case "grass": return 18000;
        case "indoor_hard": return 16000;
        case "clay": return 12000;
        case "hard": default: return 14000;
    }
}

module.exports = {
    SURFACE_REGIMES, getSurfaceProfile, applySurfaceAdjustments, analyzeSurfaceMatchup,
    applySurfaceProbabilityAdjustment, getSimulationIterations, getSurfaceVolatility, getSurfaceConfidence
};