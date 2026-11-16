// ==========================================
// statsService.js - Elaborazione Dati e Nomi
// ==========================================

// Algoritmo di similarità stringhe (Levenshtein)
function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
        }
    }
    return matrix[b.length][a.length];
}

// Mappatura dinamica delle squadre
function findBestMatch(target, candidates, threshold = 6) {
    let bestMatch = target;
    let minDistance = Infinity;
    
    for (const candidate of candidates) {
        const distance = levenshtein(target.toLowerCase(), candidate.toLowerCase());
        if (distance < minDistance) {
            minDistance = distance;
            bestMatch = candidate;
        }
    }
    return minDistance <= threshold ? bestMatch : target; 
}

// Bayesian Smoothing per il Proxy xG (Evita conversioni irreali al 100% o 0%)
function getSmoothedConversion(goals, shotsTarget) {
    // Aggiungiamo dati "fantasma" medi (es. 10 gol su 30 tiri) per spingere verso la media la statistica
    const leagueAverageGoals = 10;
    const leagueAverageShots = 30;
    return (goals + leagueAverageGoals) / (shotsTarget + leagueAverageShots);
}

module.exports = { findBestMatch, getSmoothedConversion };