'use strict';

const CALCIO_PROBABILITY_INTEGRITY_VERSION = 'BETTING_PATCH_13_R1_PROBABILITY_INTEGRITY_DERIVED_MARKETS_V3';

const MARKET_GROUPS = Object.freeze([
    Object.freeze(['1', 'X', '2']),
    Object.freeze(['O2.5', 'U2.5']),
    Object.freeze(['GG', 'NG'])
]);

function finite(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    const n = finite(value, min);
    return Math.max(min, Math.min(max, n));
}

function round(value, decimals = 2) {
    const n = finite(value, 0);
    const factor = 10 ** decimals;
    return Math.round((n + Number.EPSILON) * factor) / factor;
}

function normalizeGroup(probabilities = {}, keys = []) {
    const values = keys.map(key => Math.max(0, finite(probabilities[key], 0)));
    const sum = values.reduce((acc, value) => acc + value, 0);
    if (sum <= 0) {
        const base = 100 / Math.max(keys.length, 1);
        const out = {};
        keys.forEach((key, index) => {
            out[key] = index === keys.length - 1
                ? round(100 - (base * (keys.length - 1)), 4)
                : round(base, 4);
        });
        return out;
    }

    const out = {};
    let allocated = 0;
    keys.forEach((key, index) => {
        if (index === keys.length - 1) {
            out[key] = round(100 - allocated, 4);
        } else {
            const value = round((values[index] / sum) * 100, 4);
            out[key] = value;
            allocated += value;
        }
    });
    return out;
}

function normalizeProbabilityMap(probabilities = {}) {
    const out = { ...probabilities };
    MARKET_GROUPS.forEach(keys => Object.assign(out, normalizeGroup(probabilities, keys)));
    out['1X'] = round(out['1'] + out.X, 4);
    out.X2 = round(out.X + out['2'], 4);
    out['12'] = round(out['1'] + out['2'], 4);
    return out;
}

function monteCarloToMap(mcResult = {}) {
    // R5: a missing Monte Carlo result is not a 0% event or a fabricated 33/33/33.
    // Preserve the original mapping for complete, well-formed simulations.
    const out = {};
    const p = key => finite(mcResult?.[key], null);
    const valid = value => value !== null && value >= 0 && value <= 1;
    const h = p('homeWinProb'), d = p('drawProb'), a = p('awayWinProb');
    if ([h,d,a].every(valid) && (h+d+a) > 0.98 && (h+d+a) < 1.02) {
        Object.assign(out, normalizeGroup({'1': h*100, X: d*100, '2': a*100}, ['1','X','2']));
        out['1X'] = round(out['1']+out.X,4);
        out.X2 = round(out.X+out['2'],4);
        out['12'] = round(out['1']+out['2'],4);
    }
    const over = p('over2_5Prob');
    if (valid(over)) Object.assign(out, normalizeGroup({'O2.5':over*100,'U2.5':(1-over)*100},['O2.5','U2.5']));
    const gg = p('golProb');
    if (valid(gg)) Object.assign(out, normalizeGroup({GG:gg*100,NG:(1-gg)*100},['GG','NG']));
    return out;
}

function fairOddsToProbabilities(fairOdds = {}) {
    const map = {};
    for (const key of ['1', 'X', '2', 'O2.5', 'U2.5', 'GG', 'NG']) {
        const odd = finite(fairOdds[key], null);
        if (odd !== null && odd > 1) map[key] = 100 / odd;
    }

    const out = {};
    for (const group of MARKET_GROUPS) {
        const available = group.filter(key => finite(map[key], null) !== null);
        if (available.length === group.length) Object.assign(out, normalizeGroup(map, group));
    }
    // R5: do not invent 0% double-chance fair values when only totals/BTTS are quoted.
    if (['1','X','2'].every(key => finite(out[key], null) !== null)) {
        out['1X'] = round(out['1'] + out.X, 4);
        out.X2 = round(out.X + out['2'], 4);
        out['12'] = round(out['1'] + out['2'], 4);
    }
    return out;
}

function inferCoverageMode({
    homeMatched = true,
    awayMatched = true,
    homeSample = 0,
    awaySample = 0,
    xgEvidenceMode = ''
} = {}) {
    const minSample = Math.min(
        Math.max(0, finite(homeSample, 0)),
        Math.max(0, finite(awaySample, 0))
    );
    const mode = String(xgEvidenceMode || '').toUpperCase();

    if (!homeMatched || !awayMatched || minSample <= 0 || mode.includes('LEAGUE_PRIOR')) {
        return 'PRIOR_ONLY';
    }
    if (mode.includes('REAL_XG') && minSample >= 10) return 'STRONG_REAL_XG';
    if (minSample >= 10) return 'HISTORY_PROXY_STRONG';
    if (minSample >= 5) return 'HISTORY_PROXY';
    return 'HISTORY_THIN';
}

function getSourceWeights(coverageMode, hasMarket) {
    const mode = String(coverageMode || '').toUpperCase();
    let weights;
    if (mode === 'STRONG_REAL_XG') {
        weights = { model: 0.46, monteCarlo: 0.44, market: 0.10 };
    } else if (mode === 'HISTORY_PROXY_STRONG') {
        weights = { model: 0.40, monteCarlo: 0.40, market: 0.20 };
    } else if (mode === 'HISTORY_PROXY') {
        weights = { model: 0.35, monteCarlo: 0.38, market: 0.27 };
    } else if (mode === 'HISTORY_THIN') {
        weights = { model: 0.30, monteCarlo: 0.32, market: 0.38 };
    } else {
        weights = { model: 0.24, monteCarlo: 0.26, market: 0.50 };
    }

    if (!hasMarket) {
        const noMarket = weights.model + weights.monteCarlo;
        return {
            model: weights.model / noMarket,
            monteCarlo: weights.monteCarlo / noMarket,
            market: 0
        };
    }
    return weights;
}

function sourceDisagreement(values = []) {
    const clean = values.map(value => finite(value, null)).filter(value => value !== null);
    if (clean.length < 2) return 0;
    return Math.max(...clean) - Math.min(...clean);
}

function monteCarloStandardErrorPct(probabilityPct, iterations) {
    const p = clamp(finite(probabilityPct, 50) / 100, 0.0001, 0.9999);
    const n = Math.max(100, finite(iterations, 5000));
    return Math.sqrt((p * (1 - p)) / n) * 100;
}

function reliabilityFromEvidence(coverageMode, maxDisagreementPp, mcStdErrorPp) {
    const mode = String(coverageMode || '').toUpperCase();
    const disagreement = finite(maxDisagreementPp, 99);
    const se = finite(mcStdErrorPp, 99);

    if (mode === 'PRIOR_ONLY') return 'PRIOR';
    if (mode === 'HISTORY_THIN') return disagreement <= 8 && se <= 1.2 ? 'LOW' : 'VERY_LOW';
    if (mode === 'STRONG_REAL_XG' && disagreement <= 5 && se <= 1.0) return 'HIGH';
    if (['STRONG_REAL_XG', 'HISTORY_PROXY_STRONG'].includes(mode) && disagreement <= 9 && se <= 1.2) return 'MEDIUM';
    if (disagreement <= 14 && se <= 1.5) return 'LOW';
    return 'VERY_LOW';
}

function buildCalcioProbabilityIntegrity({
    modelProbabilities = {},
    mcResult = {},
    marketFairOdds = {},
    coverage = {},
    iterations = 5000,
    seed = null
} = {}) {
    const model = normalizeProbabilityMap(modelProbabilities);
    const monteCarlo = monteCarloToMap(mcResult);
    const market = fairOddsToProbabilities(marketFairOdds);
    const coverageMode = coverage.mode || inferCoverageMode(coverage);

    const consensus = {};
    const diagnostics = {};
    let maxDisagreementPp = 0;
    let maxMcStdErrorPp = 0;
    let missingMcGroups = 0;

    for (const group of MARKET_GROUPS) {
        const groupConsensus = {};
        const mcAvailable = group.every(key => finite(monteCarlo[key],null) !== null);
        if (!mcAvailable) missingMcGroups++;
        for (const key of group) {
            const marketValue = finite(market[key], null);
            const nominal = getSourceWeights(coverageMode, marketValue !== null);
            // Missing MC is not an independent observation; give its weight to the model.
            const weights = mcAvailable ? nominal : {
                model: nominal.model + nominal.monteCarlo, monteCarlo: 0, market: nominal.market
            };
            const modelValue = finite(model[key], 0);
            const mcValue = mcAvailable ? finite(monteCarlo[key],null) : null;
            const value =
                (modelValue * weights.model) +
                ((mcValue ?? 0) * weights.monteCarlo) +
                ((marketValue ?? 0) * weights.market);

            groupConsensus[key] = value;
            const disagreementPp = sourceDisagreement(mcAvailable ? [modelValue, mcValue, marketValue] : [modelValue, marketValue]);
            const mcStdErrorPp = mcAvailable ? monteCarloStandardErrorPct(mcValue, iterations) : null;
            maxDisagreementPp = Math.max(maxDisagreementPp, disagreementPp);
            if (mcStdErrorPp !== null) maxMcStdErrorPp = Math.max(maxMcStdErrorPp, mcStdErrorPp);
            diagnostics[key] = {
                modelProbabilityPct: round(modelValue, 3),
                monteCarloProbabilityPct: mcValue === null ? null : round(mcValue, 3),
                monteCarloAvailable: mcAvailable,
                marketProbabilityPct: marketValue === null ? null : round(marketValue, 3),
                sourceWeights: {
                    model: round(weights.model, 4),
                    monteCarlo: round(weights.monteCarlo, 4),
                    market: round(weights.market, 4)
                },
                disagreementPp: round(disagreementPp, 3),
                monteCarloStdErrorPp: mcStdErrorPp === null ? null : round(mcStdErrorPp, 3)
            };
        }
        Object.assign(consensus, normalizeGroup(groupConsensus, group));
    }

    consensus['1X'] = round(consensus['1'] + consensus.X, 4);
    consensus.X2 = round(consensus.X + consensus['2'], 4);
    consensus['12'] = round(consensus['1'] + consensus['2'], 4);

    // Patch 13: double-chance markets must use the probability of the covered outcomes,
    // never the no-vig probability of a single side. This keeps DeepScan, reliability
    // and market disagreement on the same market contract.
    for (const [derived, parts] of Object.entries({ '1X': ['1','X'], X2: ['X','2'], '12': ['1','2'] })) {
        const modelValue = round(parts.reduce((sum,key)=>sum + finite(model[key],0),0), 3);
        const mcAvailable = parts.every(key => finite(monteCarlo[key],null) !== null);
        const mcValue = mcAvailable ? round(parts.reduce((sum,key)=>sum + monteCarlo[key],0), 3) : null;
        const marketParts = parts.map(key => finite(market[key], null));
        const marketValue = marketParts.every(value => value !== null) ? round(marketParts.reduce((a,b)=>a+b,0),3) : null;
        const disagreementPp = sourceDisagreement(mcAvailable ? [modelValue,mcValue,marketValue] : [modelValue,marketValue]);
        const mcStdErrorPp = mcAvailable ? monteCarloStandardErrorPct(mcValue, iterations) : null;
        const nominal = getSourceWeights(coverageMode, marketValue !== null);
        diagnostics[derived] = {
            modelProbabilityPct: modelValue,
            monteCarloProbabilityPct: mcValue,
            monteCarloAvailable: mcAvailable,
            marketProbabilityPct: marketValue,
            sourceWeights: mcAvailable ? nominal : {model:nominal.model+nominal.monteCarlo,monteCarlo:0,market:nominal.market},
            disagreementPp: round(disagreementPp,3),
            monteCarloStdErrorPp: mcStdErrorPp === null ? null : round(mcStdErrorPp,3),
            derivedFrom: parts
        };
    }

    const marketReliability = {};
    Object.entries(diagnostics).forEach(([market, item]) => {
        marketReliability[market] = item.monteCarloAvailable === false
            ? (coverageMode === 'PRIOR_ONLY' ? 'PRIOR' : 'VERY_LOW')
            : reliabilityFromEvidence(coverageMode, item.disagreementPp, item.monteCarloStdErrorPp);
        item.reliability = marketReliability[market];
    });
    const reliability = missingMcGroups > 0
        ? (coverageMode === 'PRIOR_ONLY' ? 'PRIOR' : 'VERY_LOW')
        : reliabilityFromEvidence(coverageMode, maxDisagreementPp, maxMcStdErrorPp);

    return {
        success: true,
        version: CALCIO_PROBABILITY_INTEGRITY_VERSION,
        probabilities: consensus,
        sources: { model, monteCarlo, market },
        diagnostics,
        coverageMode,
        reliability,
        marketReliability,
        reliabilityScope: 'SELECTED_MARKET_AVAILABLE',
        maxDisagreementPp: round(maxDisagreementPp, 3),
        maxMonteCarloStdErrorPp: round(maxMcStdErrorPp, 3),
        monteCarloIterations: missingMcGroups === MARKET_GROUPS.length ? null : Math.max(100, finite(iterations, 5000)),
        monteCarloMissingGroups: missingMcGroups,
        seed: seed === null || seed === undefined ? null : String(seed),
        modelAuthority: true,
        stakeAuthority: false,
        marketAnchorUsed: Object.keys(market).length > 0,
        warnings: [
            'La previsione resta disponibile anche con dati incompleti, ma affidabilità e coverage devono essere letti insieme.',
            'PRIOR/VERY_LOW identifica un pronostico best-available, non una giocata operativa.',
            'Il consenso probabilistico non modifica da solo la Resa Qualità o il DeepScan.',
            ...(missingMcGroups ? ['R5: simulazione Monte Carlo incompleta: quote modello/mercato mantenute, ma nessuna probabilità MC inventata; attendibilità degradata.'] : [])
        ]
    };
}

function selectBestAvailableForecast({
    probabilities = {},
    odds = {},
    allowedMarkets = null,
    integrity = null
} = {}) {
    const allowed = Array.isArray(allowedMarkets) && allowedMarkets.length
        ? new Set(allowedMarkets)
        : null;
    const candidates = [];

    for (const [market, oddRaw] of Object.entries(odds || {})) {
        if (allowed && !allowed.has(market)) continue;
        const odd = finite(oddRaw, null);
        const probability = finite(probabilities[market], null);
        if (odd === null || odd <= 1.01 || probability === null || probability <= 0 || probability >= 100) continue;
        const implied = 100 / odd;
        const edge = probability - implied;
        const disagreement = finite(integrity?.diagnostics?.[market]?.disagreementPp, integrity?.maxDisagreementPp || 0);
        const selectedReliability = integrity?.marketReliability?.[market] || integrity?.diagnostics?.[market]?.reliability || integrity?.reliability;
        const reliabilityBonus = {
            HIGH: 3,
            MEDIUM: 2,
            LOW: 1,
            VERY_LOW: 0,
            PRIOR: -1
        }[selectedReliability] ?? 0;
        const score = edge - (disagreement * 0.22) + (probability * 0.015) + reliabilityBonus;
        candidates.push({
            market,
            odd,
            probabilityPct: round(probability, 3),
            impliedProbabilityPct: round(implied, 3),
            edgePp: round(edge, 3),
            reliability: selectedReliability || 'VERY_LOW',
            score: round(score, 4)
        });
    }

    candidates.sort((a, b) =>
        b.score - a.score ||
        b.edgePp - a.edgePp ||
        b.probabilityPct - a.probabilityPct ||
        a.market.localeCompare(b.market)
    );

    return {
        success: candidates.length > 0,
        best: candidates[0] || null,
        candidates
    };
}

module.exports = {
    CALCIO_PROBABILITY_INTEGRITY_VERSION,
    MARKET_GROUPS,
    finite,
    clamp,
    round,
    normalizeGroup,
    normalizeProbabilityMap,
    monteCarloToMap,
    fairOddsToProbabilities,
    inferCoverageMode,
    getSourceWeights,
    sourceDisagreement,
    monteCarloStandardErrorPct,
    reliabilityFromEvidence,
    buildCalcioProbabilityIntegrity,
    selectBestAvailableForecast
};
