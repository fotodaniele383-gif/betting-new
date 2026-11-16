'use strict';
// ============================================================================
// AI BETTING QUANT PRO - TENNIS CLV LEARNING ENGINE
// Step 67C + Step68: feedback loop da CLV/Brier separato per Tennis.
// ============================================================================

const tennisScope = require('./tennisOperationalScope');
const valueEvaluator = require('./value_evaluator');

const TENNIS_CLV_LEARNING_VERSION = 'STEP68B_TENNIS_CLV_BRIER_LEARNING_V2_1';

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function safeUpper(value) {
    return String(value || '').trim().toUpperCase();
}

function round(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function getClv(row = {}) {
    const clvPct = safeNumber(row.clv_pct, NaN);
    if (Number.isFinite(clvPct)) return clvPct;
    const clvEdge = safeNumber(row.clv_edge, NaN);
    if (Number.isFinite(clvEdge)) return clvEdge;
    return valueEvaluator.extractClvPct(row);
}

function getStake(row = {}) {
    return Math.max(0, safeNumber(row.stake ?? row.operational_stake ?? row.real_stake ?? row.stake_amount ?? row.invested, 0));
}

function getProfit(row = {}) {
    return safeNumber(row.profit ?? row.net_profit ?? row.pnl, 0);
}

function isMoneyline(row = {}) {
    const prediction = safeUpper(row.prediction);
    const market = safeUpper(row.market_type);
    return !prediction.includes('OVER') && !prediction.includes('UNDER') && !market.includes('TOTAL');
}

function isTotals(row = {}) {
    return !isMoneyline(row);
}

function isWta(row = {}) {
    const text = [row.tour_type, row.league, row.tournament, row.strategy_tag, row.bet_type].map(safeUpper).join(' ');
    return text.includes('WTA') || text.includes('WOMEN');
}

function isAtp(row = {}) {
    const text = [row.tour_type, row.league, row.tournament, row.strategy_tag, row.bet_type].map(safeUpper).join(' ');
    return text.includes('ATP') || text.includes('MEN') || (!isWta(row) && text.includes('GRAND SLAM'));
}

function isValueConfirmedMicro(row = {}) {
    const text = [
        row.trading_scope,
        row.paper_trading_scope,
        row.portfolio_scope,
        row.professional_gate_status,
        row.tennis_operational_status,
        row.tennis_operational_action,
        row.tennis_operational_summary,
        row.deepscan_gate_status,
        row.deepscan_gate_reason,
        row.ds_action,
        row.ds_suggestion,
        row.strategy_tag
    ].map(safeUpper).join(' ');

    return text.includes('VALUE CONFERMATO')
        || text.includes('VALUE_CONFIRMED')
        || text.includes('WATCHLIST MICRO')
        || text.includes('WATCHLIST_MICRO')
        || text.includes('CONSENSUS_MICRO')
        || text.includes('MICRO_STAKE');
}

function isTechnicalEdge(row = {}) {
    const text = [
        row.professional_gate_status,
        row.tennis_operational_status,
        row.tennis_operational_summary,
        row.deepscan_gate_status,
        row.deepscan_gate_reason,
        row.ds_action,
        row.ds_suggestion,
        row.strategy_tag
    ].map(safeUpper).join(' ');

    return text.includes('EDGE TECNICO')
        || text.includes('TECHNICAL_EDGE')
        || text.includes('EDGE_TECHNICAL')
        || text.includes('EDGE TECHNICAL');
}

function summarizeSegment(segment = [], options = {}) {
    const minSample = Math.max(1, Number(options.minSample || 20));
    const rows = Array.isArray(segment) ? segment : [];
    const values = rows.map(getClv).filter(v => v !== null && Number.isFinite(v));
    const clvSample = values.length;
    const avgClv = clvSample ? values.reduce((a, b) => a + b, 0) / clvSample : 0;
    const positive = values.filter(v => v > 0).length;
    const operationalRows = rows.filter(row => tennisScope.classifyTennisTradingScope(row).paperOperational);
    const stake = operationalRows.reduce((sum, row) => sum + getStake(row), 0);
    const profit = operationalRows.reduce((sum, row) => sum + getProfit(row), 0);
    const roi = stake > 0 ? (profit / stake) * 100 : 0;
    const brier = valueEvaluator.calculateBrierAnalytics(rows);

    let multiplier = 1;
    let signal = 'INSUFFICIENT_SAMPLE';
    if (rows.length >= minSample || clvSample >= minSample) {
        if (avgClv >= 1.5 && clvSample > 0 && positive / clvSample >= 0.58 && brier.avgBrier > 0 && brier.avgBrier <= 0.23) {
            multiplier = 1.12;
            signal = 'CLV_BRIER_STRONG_POSITIVE';
        } else if (avgClv >= 0.5 && clvSample > 0 && positive / clvSample >= 0.52) {
            multiplier = 1.05;
            signal = 'CLV_POSITIVE';
        } else if ((brier.avgBrier >= 0.27 && brier.sampleSize > 0) || avgClv <= -1.0 || (clvSample > 0 && positive / clvSample < 0.45) || roi <= -10) {
            multiplier = 0.65;
            signal = 'CLV_BRIER_NEGATIVE_REDUCE_OR_BLOCK';
        } else if (avgClv < 0 || roi < 0) {
            multiplier = 0.85;
            signal = 'CLV_OR_ROI_WEAK_REDUCE';
        } else {
            multiplier = 1;
            signal = 'CLV_BRIER_NEUTRAL';
        }
    }

    return {
        sample: rows.length,
        clvSample,
        operationalSample: operationalRows.length,
        stake: round(stake, 2),
        profit: round(profit, 2),
        roi: round(roi, 2),
        avgClvPct: round(avgClv, 2),
        positiveRatePct: clvSample ? round((positive / clvSample) * 100, 2) : 0,
        brier: brier.avgBrier || 0,
        brierSample: brier.sampleSize || 0,
        stakeMultiplier: round(multiplier, 2),
        signal
    };
}

function decideAction(name, summary = {}) {
    const n = safeUpper(name);
    const roi = safeNumber(summary.roi, 0);
    const avgClv = safeNumber(summary.avgClvPct, 0);
    const brier = safeNumber(summary.brier, 0);
    const sample = safeNumber(summary.sample, 0);
    const clvSample = safeNumber(summary.clvSample, 0);

    if (sample === 0) return 'NO_DATA';

    // STEP68B_MICRO_PATCH:
    // I segmenti strategici devono restituire un'azione audit leggibile anche
    // quando il campione e' ancora insufficiente. Il messaggio generico
    // OBSERVE_INSUFFICIENT_SAMPLE nascondeva se l'osservazione riguardava
    // VALUE, EDGE, ATP o WTA e faceva fallire il test Step68.
    if (sample < 10 && clvSample < 10) {
        if (n === 'VALUECONFIRMEDMICRO') return 'VALUE_CONFIRMED_MICRO_OBSERVE_INSUFFICIENT_SAMPLE';
        if (n === 'TECHNICALEDGE') return 'EDGE_TECNICO_OBSERVE_INSUFFICIENT_SAMPLE';
        if (n === 'WTAMONEYLINE') return 'WTA_MONEYLINE_OBSERVE_INSUFFICIENT_SAMPLE';
        if (n === 'ATPMONEYLINE') return 'ATP_MONEYLINE_OBSERVE_INSUFFICIENT_SAMPLE';
        return 'OBSERVE_INSUFFICIENT_SAMPLE';
    }

    if (n === 'WTAMONEYLINE') {
        if (brier >= 0.27 || avgClv < 0 || roi <= -10) return 'REDUCE_OR_BLOCK_WTA_MONEYLINE';
        return 'WTA_MONEYLINE_WATCHLIST_ONLY';
    }

    if (n === 'ATPMONEYLINE') {
        if (brier > 0 && brier <= 0.23 && avgClv >= 0 && roi >= -3) return 'ATP_MONEYLINE_NEUTRAL_MICRO_ONLY';
        if (avgClv < 0 || roi < -8) return 'ATP_MONEYLINE_REDUCE';
        return 'ATP_MONEYLINE_NEUTRAL';
    }

    if (n === 'VALUECONFIRMEDMICRO') {
        if (roi > 0 && avgClv >= 0) return 'PRIORITIZE_VALUE_CONFIRMED_MICRO';
        return 'VALUE_CONFIRMED_MICRO_WATCHLIST';
    }

    if (n === 'TECHNICALEDGE') {
        if (roi < -8 || avgClv < 0 || brier >= 0.27) return 'REDUCE_EDGE_TECNICO';
        return 'EDGE_TECNICO_WATCHLIST';
    }

    if (summary.signal === 'CLV_BRIER_NEGATIVE_REDUCE_OR_BLOCK') return 'REDUCE_OR_BLOCK_SEGMENT';
    if (summary.signal === 'CLV_BRIER_STRONG_POSITIVE') return 'ALLOW_CONTROLLED_INCREASE';
    if (summary.signal === 'CLV_POSITIVE') return 'KEEP_OR_MICRO_INCREASE';
    return 'KEEP_NEUTRAL';
}

function buildTennisClvLearningReport(rows = [], options = {}) {
    const minSample = Math.max(1, Number(options.minSample || 20));
    const strictRows = (Array.isArray(rows) ? rows : [])
        .filter(tennisScope.isTennisRow)
        .filter(tennisScope.isCurrentClean);

    const groups = {
        all: strictRows,
        moneyline: strictRows.filter(isMoneyline),
        totals: strictRows.filter(isTotals),
        operational: strictRows.filter(row => tennisScope.classifyTennisTradingScope(row).paperOperational),
        auditOnly: strictRows.filter(row => tennisScope.classifyTennisTradingScope(row).auditOnly),
        atpMoneyline: strictRows.filter(row => isAtp(row) && isMoneyline(row)),
        wtaMoneyline: strictRows.filter(row => isWta(row) && isMoneyline(row)),
        valueConfirmedMicro: strictRows.filter(isValueConfirmedMicro),
        technicalEdge: strictRows.filter(isTechnicalEdge)
    };

    const segments = Object.fromEntries(Object.entries(groups).map(([key, segment]) => {
        const summary = summarizeSegment(segment, { minSample });
        return [key, { ...summary, action: decideAction(key, summary) }];
    }));

    return {
        sport: 'TENNIS',
        version: TENNIS_CLV_LEARNING_VERSION,
        calibrationVersion: TENNIS_CLV_LEARNING_VERSION,
        minSample,
        dataMode: 'TENNIS_STRICT_CURRENT_CLV_BRIER_LEARNING',
        segments,
        recommendedActions: {
            wtaMoneyline: segments.wtaMoneyline.action,
            atpMoneyline: segments.atpMoneyline.action,
            valueConfirmedMicro: segments.valueConfirmedMicro.action,
            technicalEdge: segments.technicalEdge.action
        }
    };
}

function applyTennisClvLearning(baseStake, context = {}, report = null) {
    const effectiveReport = report || buildTennisClvLearningReport(context.rows || []);
    const prediction = String(context.prediction || '').toUpperCase();
    const isWtaContext = isWta(context);
    const segmentKey = isWtaContext && !prediction.includes('OVER') && !prediction.includes('UNDER')
        ? 'wtaMoneyline'
        : (prediction.includes('OVER') || prediction.includes('UNDER') ? 'totals' : 'moneyline');
    const segment = effectiveReport.segments?.[segmentKey] || effectiveReport.segments?.all || { stakeMultiplier: 1, signal: 'NO_REPORT', action: 'NO_REPORT' };
    const stake = Math.max(0, safeNumber(baseStake, 0));
    const multiplier = safeNumber(segment.stakeMultiplier, 1);
    return {
        baseStake: round(stake, 2),
        adjustedStake: round(stake * multiplier, 2),
        multiplier,
        signal: segment.signal,
        action: segment.action,
        segment: segmentKey,
        version: TENNIS_CLV_LEARNING_VERSION
    };
}

module.exports = {
    TENNIS_CLV_LEARNING_VERSION,
    buildTennisClvLearningReport,
    applyTennisClvLearning,
    getClv,
    summarizeSegment,
    decideAction
};
