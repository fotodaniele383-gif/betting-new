'use strict';
// ============================================================================
// AI BETTING QUANT PRO - CALCIO CLV LEARNING ENGINE
// Step 67C: feedback loop da Closing Line Value separato per Calcio.
// ============================================================================

const calcioScope = require('./calcioOperationalScope');
const valueEvaluator = require('./value_evaluator');

const CALCIO_CLV_LEARNING_VERSION = 'STEP67C_CALCIO_CLV_LEARNING_V1';

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function getClv(row = {}) {
    const clvPct = safeNumber(row.clv_pct, NaN);
    if (Number.isFinite(clvPct)) return clvPct;
    const clvEdge = safeNumber(row.clv_edge, NaN);
    if (Number.isFinite(clvEdge)) return clvEdge;
    return valueEvaluator.extractClvPct(row);
}

function classifyMarket(row = {}) {
    const prediction = String(row.prediction || '').toUpperCase();
    if (prediction.includes('OVER') || prediction.includes('UNDER') || prediction.includes('O2.5') || prediction.includes('U2.5')) return 'totals';
    if (prediction.includes('GG') || prediction.includes('NG') || prediction.includes('BTTS')) return 'btts';
    return 'oneXtwo';
}

function buildCalcioClvLearningReport(rows = [], options = {}) {
    const minSample = Math.max(1, Number(options.minSample || 30));
    const strictRows = (Array.isArray(rows) ? rows : [])
        .filter(calcioScope.isCalcioRow)
        .filter(calcioScope.isCurrentClean)
        .filter(row => getClv(row) !== null && Number.isFinite(getClv(row)));

    const groups = {
        all: strictRows,
        oneXtwo: strictRows.filter(row => classifyMarket(row) === 'oneXtwo'),
        totals: strictRows.filter(row => classifyMarket(row) === 'totals'),
        btts: strictRows.filter(row => classifyMarket(row) === 'btts'),
        operational: strictRows.filter(row => calcioScope.classifyCalcioTradingScope(row).paperOperational),
        auditOnly: strictRows.filter(row => calcioScope.classifyCalcioTradingScope(row).auditOnly)
    };

    const summarize = (segment = []) => {
        const values = segment.map(getClv).filter(v => v !== null && Number.isFinite(v));
        const sample = values.length;
        const avg = sample ? values.reduce((a, b) => a + b, 0) / sample : 0;
        const positive = values.filter(v => v > 0).length;
        let multiplier = 1;
        let signal = 'INSUFFICIENT_SAMPLE';
        if (sample >= minSample) {
            if (avg >= 1.25 && positive / sample >= 0.56) { multiplier = 1.1; signal = 'CLV_STRONG_POSITIVE'; }
            else if (avg >= 0.4 && positive / sample >= 0.51) { multiplier = 1.04; signal = 'CLV_POSITIVE'; }
            else if (avg <= -1.0 || positive / sample < 0.44) { multiplier = 0.72; signal = 'CLV_NEGATIVE_REDUCE'; }
            else if (avg < 0) { multiplier = 0.88; signal = 'CLV_WEAK_REDUCE'; }
            else { multiplier = 1; signal = 'CLV_NEUTRAL'; }
        }
        return {
            sample,
            avgClvPct: Number(avg.toFixed(2)),
            positiveRatePct: sample ? Number(((positive / sample) * 100).toFixed(2)) : 0,
            stakeMultiplier: Number(multiplier.toFixed(2)),
            signal
        };
    };

    return {
        sport: 'CALCIO',
        version: CALCIO_CLV_LEARNING_VERSION,
        minSample,
        dataMode: 'CALCIO_STRICT_CURRENT_CLV_ONLY',
        segments: Object.fromEntries(Object.entries(groups).map(([key, segment]) => [key, summarize(segment)]))
    };
}

function applyCalcioClvLearning(baseStake, context = {}, report = null) {
    const effectiveReport = report || buildCalcioClvLearningReport(context.rows || []);
    const segmentKey = classifyMarket(context);
    const segment = effectiveReport.segments?.[segmentKey] || effectiveReport.segments?.all || { stakeMultiplier: 1, signal: 'NO_REPORT' };
    const stake = Math.max(0, safeNumber(baseStake, 0));
    const multiplier = safeNumber(segment.stakeMultiplier, 1);
    return {
        baseStake: Number(stake.toFixed(2)),
        adjustedStake: Number((stake * multiplier).toFixed(2)),
        multiplier,
        signal: segment.signal,
        segment: segmentKey,
        version: CALCIO_CLV_LEARNING_VERSION
    };
}

module.exports = {
    CALCIO_CLV_LEARNING_VERSION,
    buildCalcioClvLearningReport,
    applyCalcioClvLearning,
    getClv,
    classifyMarket
};
