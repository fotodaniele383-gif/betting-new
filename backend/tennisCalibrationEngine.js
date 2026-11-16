'use strict';
// ============================================================================
// AI BETTING QUANT PRO - TENNIS CALIBRATION ENGINE
// Step 67B: motore calibrazione Tennis separato da Calcio.
// ============================================================================

const valueEvaluator = require('./value_evaluator');
const tennisScope = require('./tennisOperationalScope');

const TENNIS_CALIBRATION_ENGINE_VERSION = 'STEP67B_TENNIS_CALIBRATION_ENGINE_V1';

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getRowsForTennisCalibration(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .filter(tennisScope.isTennisRow)
        .filter(tennisScope.isCurrentClean)
        .filter(tennisScope.isResolvedWonLost);
}

function buildTennisCalibrationReport(rows = [], options = {}) {
    const bucketSize = Math.max(1, Number(options.bucketSize || 5));
    const minSample = Math.max(1, Number(options.minSample || 20));
    const calibrationRows = getRowsForTennisCalibration(rows);
    const operationalRows = calibrationRows.filter(row => tennisScope.classifyTennisTradingScope(row).paperOperational);
    const reportRows = options.operationalOnly === true ? operationalRows : calibrationRows;

    const calibration = valueEvaluator.calculateCalibrationBuckets(reportRows, {
        bucketSize,
        minSample,
        sportFilter: 'tennis',
        cleanOnly: true
    });
    const brier = valueEvaluator.calculateBrierAnalytics(reportRows, { cleanOnly: true, sportFilter: 'tennis' });
    const clv = valueEvaluator.calculateCLVAnalytics(reportRows, { cleanOnly: true, sportFilter: 'tennis' });
    const roi = valueEvaluator.calculatePortfolioROI(operationalRows, { cleanOnly: true, sportFilter: 'tennis' });

    return {
        sport: 'TENNIS',
        version: TENNIS_CALIBRATION_ENGINE_VERSION,
        dataMode: options.operationalOnly === true ? 'TENNIS_OPERATIONAL_ONLY' : 'TENNIS_STRICT_CURRENT_WITH_AUDIT_FOR_CALIBRATION',
        sample: reportRows.length,
        operationalSample: operationalRows.length,
        auditOnlySample: calibrationRows.length - operationalRows.length,
        bucketSize,
        minSample,
        calibration,
        brier,
        clv,
        roi,
        decision: valueEvaluator.getReliabilityDecision({
            brier: brier.avgBrier,
            calibrationError: calibration.summary?.weightedCalibrationError,
            sampleSize: calibration.sampleSize,
            clv: clv.avgCLV
        })
    };
}

function calibrateTennisProbability(probabilityPct, rows = [], options = {}) {
    const report = options.report || buildTennisCalibrationReport(rows, options);
    const marketProbability = options.marketProbabilityPct ?? options.market_implied_prob ?? null;
    const result = valueEvaluator.calibrateProbabilityByBuckets(probabilityPct, report.calibration, {
        maxAdjustment: options.maxAdjustment ?? 8,
        minReliableSample: options.minReliableSample ?? Math.max(10, Number(report.minSample || 20)),
        shrinkToMarket: marketProbability
    });

    const clvAvg = safeNumber(report.clv?.avgCLV, 0);
    let clvAdjustment = 0;
    if (report.clv?.sampleSize >= 20) {
        if (clvAvg >= 1.25) clvAdjustment = 1.5;
        else if (clvAvg >= 0.5) clvAdjustment = 0.75;
        else if (clvAvg < -1) clvAdjustment = -2;
        else if (clvAvg < 0) clvAdjustment = -1;
    }

    const calibrated = clamp(safeNumber(result.probability, probabilityPct) + clvAdjustment, 1, 99);

    return {
        ...result,
        probability: Number(calibrated.toFixed(2)),
        clvAdjustment: Number(clvAdjustment.toFixed(2)),
        finalAdjustment: Number((calibrated - safeNumber(probabilityPct, 50)).toFixed(2)),
        reportVersion: TENNIS_CALIBRATION_ENGINE_VERSION,
        sport: 'TENNIS',
        reason: `${result.reason}; CLV adjustment ${clvAdjustment >= 0 ? '+' : ''}${clvAdjustment.toFixed(2)}pp.`
    };
}

module.exports = {
    TENNIS_CALIBRATION_ENGINE_VERSION,
    getRowsForTennisCalibration,
    buildTennisCalibrationReport,
    calibrateTennisProbability
};
