// ==========================================
// aiModel.js - Motore Statistico Dixon-Coles
// ==========================================

function factorial(n) { 
    if (n === 0 || n === 1) return 1; 
    let r = 1; for (let i = 2; i <= n; i++) r *= i; 
    return r; 
}

function poisson(k, lambda) { 
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k); 
}

// Modello Dixon-Coles con parametro Rho (default -0.13 per il calcio)
function getDixonColesProbabilities(expHomeGoals, expAwayGoals, rho = -0.13) {
    let prob1 = 0, probX = 0, prob2 = 0, probU25 = 0; 
    let totalProb = 0;
    const matrix = {};

    // Calcolo matrice base 7x7 (da 0 a 6 gol per evitare troncamenti aggressivi)
    for (let i = 0; i <= 6; i++) {
        for (let j = 0; j <= 6; j++) {
            let p = poisson(i, expHomeGoals) * poisson(j, expAwayGoals);
            
            // Correzione Dixon-Coles per la dipendenza dei gol
            if (i === 0 && j === 0) p *= (1 - expHomeGoals * expAwayGoals * rho);
            else if (i === 0 && j === 1) p *= (1 + expHomeGoals * rho);
            else if (i === 1 && j === 0) p *= (1 + expAwayGoals * rho);
            else if (i === 1 && j === 1) p *= (1 - rho);

            p = Math.max(0, p); // Previene rarissime probabilità negative
            matrix[`${i}-${j}`] = p;
            totalProb += p;
        }
    }

    // Normalizzazione (troncamento risolto) e Aggregazione Mercati
    let probNG = 0;
    for (let i = 0; i <= 6; i++) {
        for (let j = 0; j <= 6; j++) {
            const normalizedP = matrix[`${i}-${j}`] / totalProb;
            if (i > j) prob1 += normalizedP;
            else if (i === j) probX += normalizedP;
            else prob2 += normalizedP;
            
            if (i + j <= 2) probU25 += normalizedP;
            
            // Calcolo esatto No Goal (almeno una squadra a 0)
            if (i === 0 || j === 0) probNG += normalizedP;
        }
    }

    const probO25 = 1 - probU25;
    const probGG = 1 - probNG;

    return { 
        "1": prob1 * 100, "X": probX * 100, "2": prob2 * 100, 
        "1X": (prob1 + probX) * 100, "X2": (probX + prob2) * 100, "12": (prob1 + prob2) * 100, 
        "U2.5": probU25 * 100, "O2.5": probO25 * 100, 
        "GG": probGG * 100, "NG": probNG * 100 
    };
}

function calculateKelly(prob, odd) {
    const p = prob / 100, b = odd - 1, edge = (p * odd) - 1;
    if (edge <= 0) return 0;
    let stakePercent = (edge / b) * 0.15 * 100; // 15% Fractional Kelly
    if (stakePercent > 4.00) stakePercent = 4.00; // Cap al 4% per sicurezza
    return stakePercent;
}

module.exports = { getDixonColesProbabilities, calculateKelly };