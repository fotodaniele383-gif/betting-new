'use strict';

const certifiedOddsProvenance = require('./calcioCertifiedOddsProvenance');

const CALCIO_MARKET_CONSENSUS_VERSION = 'BETTING_PATCH_18_MARKET_CONSENSUS_CERTIFIED_ODDS_V1';
const DEFAULT_SHARP_BOOKMAKERS = Object.freeze(['pinnacle']);
const DIRECT_MARKETS = Object.freeze(['1', 'X', '2', 'O2.5', 'U2.5']);

function safeOdd(value) {
    const odd = Number(value);
    return Number.isFinite(odd) && odd > 1.001 && odd < 1000 ? odd : null;
}

function median(values = []) {
    const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!clean.length) return null;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function normalizeBookmakerKey(bookmaker = {}) {
    return String(bookmaker.key || bookmaker.title || 'unknown').trim().toLowerCase() || 'unknown';
}

function findMarket(bookmaker = {}, key) {
    return Array.isArray(bookmaker.markets)
        ? bookmaker.markets.find(market => market && market.key === key)
        : null;
}

function getOutcomePrice(market, predicate) {
    if (!market || !Array.isArray(market.outcomes)) return null;
    const outcome = market.outcomes.find(predicate);
    return outcome ? safeOdd(outcome.price) : null;
}

function extractBookmakerSnapshot(event = {}, bookmaker = {}, index = 0) {
    const home = String(event.home_team || '');
    const away = String(event.away_team || '');
    const h2h = findMarket(bookmaker, 'h2h');
    const totals = findMarket(bookmaker, 'totals');

    const odds = {
        '1': getOutcomePrice(h2h, outcome => outcome?.name === home),
        X: getOutcomePrice(h2h, outcome => outcome?.name === 'Draw'),
        '2': getOutcomePrice(h2h, outcome => outcome?.name === away),
        'O2.5': getOutcomePrice(totals, outcome => outcome?.name === 'Over' && Number(outcome?.point) === 2.5),
        'U2.5': getOutcomePrice(totals, outcome => outcome?.name === 'Under' && Number(outcome?.point) === 2.5)
    };

    return {
        index,
        key: normalizeBookmakerKey(bookmaker),
        title: String(bookmaker.title || bookmaker.key || 'Unknown'),
        lastUpdate: bookmaker.last_update || null,
        odds,
        completeH2H: Boolean(odds['1'] && odds.X && odds['2']),
        completeTotals: Boolean(odds['O2.5'] && odds['U2.5'])
    };
}

function calculateNoVigH2H(odds = {}) {
    const one = safeOdd(odds['1']);
    const draw = safeOdd(odds.X);
    const two = safeOdd(odds['2']);
    if (!one || !draw || !two) return null;
    const margin = (1 / one) + (1 / draw) + (1 / two);
    if (!Number.isFinite(margin) || margin <= 0) return null;
    return {
        probabilities: {
            '1': (1 / one) / margin,
            X: (1 / draw) / margin,
            '2': (1 / two) / margin
        },
        odds: {
            '1': 1 / ((1 / one) / margin),
            X: 1 / ((1 / draw) / margin),
            '2': 1 / ((1 / two) / margin)
        },
        margin
    };
}

function calculateNoVigTotals(odds = {}) {
    const over = safeOdd(odds['O2.5']);
    const under = safeOdd(odds['U2.5']);
    if (!over || !under) return null;
    const margin = (1 / over) + (1 / under);
    if (!Number.isFinite(margin) || margin <= 0) return null;
    return {
        probabilities: {
            'O2.5': (1 / over) / margin,
            'U2.5': (1 / under) / margin
        },
        odds: {
            'O2.5': 1 / ((1 / over) / margin),
            'U2.5': 1 / ((1 / under) / margin)
        },
        margin
    };
}

function deriveDoubleChance(odds = {}) {
    const result = { ...odds };
    if (safeOdd(result['1']) && safeOdd(result.X)) result['1X'] = 1 / ((1 / result['1']) + (1 / result.X));
    if (safeOdd(result.X) && safeOdd(result['2'])) result.X2 = 1 / ((1 / result.X) + (1 / result['2']));
    if (safeOdd(result['1']) && safeOdd(result['2'])) result['12'] = 1 / ((1 / result['1']) + (1 / result['2']));
    return result;
}

function selectBestDirectPrices(snapshots = []) {
    const odds = {};
    const sources = {};

    for (const market of DIRECT_MARKETS) {
        const eligibleSnapshots = ['1', 'X', '2'].includes(market)
            ? snapshots.filter(snapshot => snapshot.completeH2H)
            : snapshots.filter(snapshot => snapshot.completeTotals);
        const candidates = eligibleSnapshots
            .map(snapshot => ({ snapshot, odd: safeOdd(snapshot.odds[market]) }))
            .filter(candidate => candidate.odd)
            .sort((a, b) => {
                if (b.odd !== a.odd) return b.odd - a.odd;
                const aTime = Date.parse(a.snapshot.lastUpdate || '') || 0;
                const bTime = Date.parse(b.snapshot.lastUpdate || '') || 0;
                if (bTime !== aTime) return bTime - aTime;
                return a.snapshot.key.localeCompare(b.snapshot.key);
            });

        const best = candidates[0];
        if (best) {
            odds[market] = best.odd;
            sources[market] = {
                bookmakerKey: best.snapshot.key,
                bookmakerTitle: best.snapshot.title,
                lastUpdate: best.snapshot.lastUpdate,
                price: best.odd
            };
        }
    }

    return { odds, sources };
}

function selectCoherentDerivativeSnapshot(snapshots = []) {
    return snapshots
        .filter(snapshot => snapshot.completeH2H)
        .map(snapshot => ({ snapshot, fair: calculateNoVigH2H(snapshot.odds) }))
        .filter(row => row.fair)
        .sort((a, b) => {
            if (a.fair.margin !== b.fair.margin) return a.fair.margin - b.fair.margin;
            const aTime = Date.parse(a.snapshot.lastUpdate || '') || 0;
            const bTime = Date.parse(b.snapshot.lastUpdate || '') || 0;
            if (bTime !== aTime) return bTime - aTime;
            return a.snapshot.key.localeCompare(b.snapshot.key);
        })[0]?.snapshot || null;
}

function buildCoherentDerivativePrices(snapshot) {
    if (!snapshot?.completeH2H) return { odds: {}, sources: {} };
    const derived = deriveDoubleChance({
        '1': snapshot.odds['1'],
        X: snapshot.odds.X,
        '2': snapshot.odds['2']
    });
    const odds = {
        '1X': derived['1X'],
        X2: derived.X2,
        '12': derived['12']
    };
    const sources = Object.keys(odds).reduce((acc, market) => {
        if (safeOdd(odds[market])) {
            acc[market] = {
                bookmakerKey: snapshot.key,
                bookmakerTitle: snapshot.title,
                lastUpdate: snapshot.lastUpdate,
                price: odds[market],
                derivedFromCompleteH2H: true
            };
        }
        return acc;
    }, {});
    return { odds, sources };
}

function buildMedianNoVigH2H(snapshots = []) {
    const rows = snapshots.map(snapshot => ({ snapshot, fair: calculateNoVigH2H(snapshot.odds) })).filter(row => row.fair);
    if (!rows.length) return null;
    const medians = {
        '1': median(rows.map(row => row.fair.probabilities['1'])),
        X: median(rows.map(row => row.fair.probabilities.X)),
        '2': median(rows.map(row => row.fair.probabilities['2']))
    };
    const total = medians['1'] + medians.X + medians['2'];
    if (!Number.isFinite(total) || total <= 0) return null;
    const odds = {
        '1': 1 / (medians['1'] / total),
        X: 1 / (medians.X / total),
        '2': 1 / (medians['2'] / total)
    };
    return { odds: deriveDoubleChance(odds), sampleSize: rows.length };
}

function buildMedianNoVigTotals(snapshots = []) {
    const rows = snapshots.map(snapshot => ({ snapshot, fair: calculateNoVigTotals(snapshot.odds) })).filter(row => row.fair);
    if (!rows.length) return null;
    const over = median(rows.map(row => row.fair.probabilities['O2.5']));
    const under = median(rows.map(row => row.fair.probabilities['U2.5']));
    const total = over + under;
    if (!Number.isFinite(total) || total <= 0) return null;
    return {
        odds: {
            'O2.5': 1 / (over / total),
            'U2.5': 1 / (under / total)
        },
        sampleSize: rows.length
    };
}

function buildReferenceFairOdds(snapshots = [], sharpKeys = DEFAULT_SHARP_BOOKMAKERS) {
    const normalizedSharp = sharpKeys.map(key => String(key).toLowerCase());
    const sharp = snapshots.find(snapshot => normalizedSharp.includes(snapshot.key) && snapshot.completeH2H) || null;
    const sharpTotals = snapshots.find(snapshot => normalizedSharp.includes(snapshot.key) && snapshot.completeTotals) || null;

    const reference = {};
    let h2hSource = 'UNAVAILABLE';
    let totalsSource = 'UNAVAILABLE';
    let h2hSampleSize = 0;
    let totalsSampleSize = 0;

    if (sharp) {
        const fair = calculateNoVigH2H(sharp.odds);
        if (fair) {
            Object.assign(reference, deriveDoubleChance(fair.odds));
            h2hSource = `${sharp.key.toUpperCase()}_NO_VIG`;
            h2hSampleSize = 1;
        }
    } else {
        const medianFair = buildMedianNoVigH2H(snapshots.filter(snapshot => snapshot.completeH2H));
        if (medianFair) {
            Object.assign(reference, medianFair.odds);
            h2hSource = 'CONSENSUS_MEDIAN_NO_VIG';
            h2hSampleSize = medianFair.sampleSize;
        }
    }

    if (sharpTotals) {
        const fair = calculateNoVigTotals(sharpTotals.odds);
        if (fair) {
            Object.assign(reference, fair.odds);
            totalsSource = `${sharpTotals.key.toUpperCase()}_NO_VIG`;
            totalsSampleSize = 1;
        }
    } else {
        const medianFair = buildMedianNoVigTotals(snapshots.filter(snapshot => snapshot.completeTotals));
        if (medianFair) {
            Object.assign(reference, medianFair.odds);
            totalsSource = 'CONSENSUS_MEDIAN_NO_VIG';
            totalsSampleSize = medianFair.sampleSize;
        }
    }

    return {
        odds: reference,
        source: { h2h: h2hSource, totals: totalsSource },
        sampleSize: { h2h: h2hSampleSize, totals: totalsSampleSize }
    };
}

function calculateDispersion(snapshots = []) {
    return DIRECT_MARKETS.reduce((acc, market) => {
        const prices = snapshots.map(snapshot => safeOdd(snapshot.odds[market])).filter(Boolean);
        const center = median(prices);
        if (!center || prices.length < 2) {
            acc[market] = { sampleSize: prices.length, median: center, spreadPct: 0 };
            return acc;
        }
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        acc[market] = {
            sampleSize: prices.length,
            median: center,
            min,
            max,
            spreadPct: ((max - min) / center) * 100
        };
        return acc;
    }, {});
}

function buildCalcioMarketConsensus(event = {}, options = {}) {
    const bookmakers = Array.isArray(event.bookmakers) ? event.bookmakers : [];
    const snapshots = bookmakers.map((bookmaker, index) => extractBookmakerSnapshot(event, bookmaker, index));
    const completeH2H = snapshots.filter(snapshot => snapshot.completeH2H);
    const completeTotals = snapshots.filter(snapshot => snapshot.completeTotals);
    // Patch 18: executionOdds resta esposto solo per compatibilità diagnostica con Patch 2.
    // Il runtime operativo usa esclusivamente analysisOdds/operationalOdds, costruite da quote
    // dirette bookmaker con provenienza e timestamp verificabili. Le doppie chance derivate non
    // vengono mai considerate quote giocabili.
    const execution = selectBestDirectPrices(snapshots);
    const derivativeSnapshot = selectCoherentDerivativeSnapshot(snapshots);
    const coherentDerivatives = buildCoherentDerivativePrices(derivativeSnapshot);
    const executionOdds = { ...execution.odds, ...coherentDerivatives.odds };
    const executionSources = { ...execution.sources, ...coherentDerivatives.sources };
    const certifiedProvenance = certifiedOddsProvenance.buildCertifiedOddsProvenance(event, options.certification || {});
    const analysisOdds = { ...certifiedProvenance.analysisOdds };
    const operationalOdds = { ...certifiedProvenance.operationalOdds };
    const certifiedSources = { ...certifiedProvenance.sources };
    const marketCertifications = certifiedProvenance.markets;
    const reference = buildReferenceFairOdds(snapshots, options.sharpBookmakers || DEFAULT_SHARP_BOOKMAKERS);
    const dispersion = calculateDispersion(snapshots);
    const highDispersionMarkets = Object.entries(dispersion)
        .filter(([, detail]) => detail.sampleSize >= 2 && detail.spreadPct > 10)
        .map(([market]) => market);

    const warnings = [];
    if (!completeH2H.length) warnings.push('NO_COMPLETE_H2H_BOOKMAKER');
    if (completeH2H.length === 1) warnings.push('SINGLE_BOOKMAKER_H2H');
    if (certifiedProvenance.summary.singleSourceMarkets > 0) warnings.push('SINGLE_SOURCE_MARKETS_ANALYSIS_ONLY');
    if (certifiedProvenance.summary.multiSourceMarkets === 0) warnings.push('NO_MULTI_SOURCE_OPERATIONAL_MARKET');
    warnings.push('DERIVED_EXECUTION_ODDS_DISABLED_BY_PATCH18');
    if (highDispersionMarkets.length) warnings.push(`HIGH_MARKET_DISPERSION:${highDispersionMarkets.join(',')}`);

    return {
        version: CALCIO_MARKET_CONSENSUS_VERSION,
        hasCompleteH2H: completeH2H.length > 0,
        // Legacy diagnostic fields. Never use these as Patch 18 operational odds.
        executionOdds,
        executionSources,
        // Patch 18 authoritative fields.
        analysisOdds,
        operationalOdds,
        certifiedSources,
        marketCertifications,
        certifiedProvenance,
        referenceFairOdds: reference.odds,
        referenceSource: reference.source,
        referenceSampleSize: reference.sampleSize,
        dispersion,
        warnings,
        summary: {
            bookmakerCount: snapshots.length,
            completeH2HBookmakers: completeH2H.length,
            completeTotalsBookmakers: completeTotals.length,
            firstCompleteH2HBookmaker: completeH2H[0]?.key || null,
            coherentDerivativeBookmaker: derivativeSnapshot?.key || null,
            bestPriceMarkets: Object.keys(execution.sources).length,
            directAnalysisMarkets: Object.keys(analysisOdds).length,
            multiSourceOperationalMarkets: Object.keys(operationalOdds).length,
            singleSourceAnalysisOnlyMarkets: certifiedProvenance.summary.singleSourceMarkets,
            derivedOperationalMarkets: 0,
            highDispersionMarkets
        },
        snapshots
    };
}

function createCalcioMarketConsensusDiagnostics() {
    return {
        version: CALCIO_MARKET_CONSENSUS_VERSION,
        eventsProcessed: 0,
        eventsWithoutCompleteH2H: 0,
        bookmakersSeen: 0,
        completeH2HBookmakers: 0,
        completeTotalsBookmakers: 0,
        bestPriceMarkets: 0,
        pinnacleReferenceEvents: 0,
        consensusReferenceEvents: 0,
        highDispersionEvents: 0,
        directAnalysisMarkets: 0,
        multiSourceOperationalMarkets: 0,
        singleSourceAnalysisOnlyMarkets: 0,
        derivedOperationalMarkets: 0
    };
}

function updateCalcioMarketConsensusDiagnostics(diagnostics = {}, consensus = {}) {
    const target = diagnostics.marketConsensus || diagnostics;
    target.version = CALCIO_MARKET_CONSENSUS_VERSION;
    target.eventsProcessed = Number(target.eventsProcessed || 0) + 1;
    target.bookmakersSeen = Number(target.bookmakersSeen || 0) + Number(consensus.summary?.bookmakerCount || 0);
    target.completeH2HBookmakers = Number(target.completeH2HBookmakers || 0) + Number(consensus.summary?.completeH2HBookmakers || 0);
    target.completeTotalsBookmakers = Number(target.completeTotalsBookmakers || 0) + Number(consensus.summary?.completeTotalsBookmakers || 0);
    target.bestPriceMarkets = Number(target.bestPriceMarkets || 0) + Number(consensus.summary?.bestPriceMarkets || 0);
    target.directAnalysisMarkets = Number(target.directAnalysisMarkets || 0) + Number(consensus.summary?.directAnalysisMarkets || 0);
    target.multiSourceOperationalMarkets = Number(target.multiSourceOperationalMarkets || 0) + Number(consensus.summary?.multiSourceOperationalMarkets || 0);
    target.singleSourceAnalysisOnlyMarkets = Number(target.singleSourceAnalysisOnlyMarkets || 0) + Number(consensus.summary?.singleSourceAnalysisOnlyMarkets || 0);
    target.derivedOperationalMarkets = Number(target.derivedOperationalMarkets || 0) + Number(consensus.summary?.derivedOperationalMarkets || 0);
    if (!consensus.hasCompleteH2H) target.eventsWithoutCompleteH2H = Number(target.eventsWithoutCompleteH2H || 0) + 1;
    if (String(consensus.referenceSource?.h2h || '').includes('PINNACLE')) target.pinnacleReferenceEvents = Number(target.pinnacleReferenceEvents || 0) + 1;
    if (String(consensus.referenceSource?.h2h || '').includes('CONSENSUS')) target.consensusReferenceEvents = Number(target.consensusReferenceEvents || 0) + 1;
    if (Array.isArray(consensus.summary?.highDispersionMarkets) && consensus.summary.highDispersionMarkets.length) {
        target.highDispersionEvents = Number(target.highDispersionEvents || 0) + 1;
    }
    return target;
}

module.exports = {
    CALCIO_MARKET_CONSENSUS_VERSION,
    DEFAULT_SHARP_BOOKMAKERS,
    DIRECT_MARKETS,
    safeOdd,
    median,
    extractBookmakerSnapshot,
    calculateNoVigH2H,
    calculateNoVigTotals,
    deriveDoubleChance,
    selectBestDirectPrices,
    selectCoherentDerivativeSnapshot,
    buildCoherentDerivativePrices,
    buildMedianNoVigH2H,
    buildMedianNoVigTotals,
    buildReferenceFairOdds,
    calculateDispersion,
    buildCalcioMarketConsensus,
    createCalcioMarketConsensusDiagnostics,
    updateCalcioMarketConsensusDiagnostics
};
