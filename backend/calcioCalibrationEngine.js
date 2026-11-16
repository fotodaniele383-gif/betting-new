'use strict';
// ============================================================================
// AI BETTING QUANT PRO - CALCIO CALIBRATION ENGINE
// Step 67B: motore calibrazione Calcio separato da Tennis.
// ============================================================================

const valueEvaluator = require('./value_evaluator');
const calcioScope = require('./calcioOperationalScope');

const CALCIO_CALIBRATION_ENGINE_VERSION = 'STEP67B_CALCIO_CALIBRATION_ENGINE_V1';

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getRowsForCalcioCalibration(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .filter(calcioScope.isCalcioRow)
        .filter(calcioScope.isCurrentClean)
        .filter(calcioScope.isResolvedWonLost);
}

function buildCalcioCalibrationReport(rows = [], options = {}) {
    const bucketSize = Math.max(1, Number(options.bucketSize || 5));
    const minSample = Math.max(1, Number(options.minSample || 30));
    const calibrationRows = getRowsForCalcioCalibration(rows);
    const operationalRows = calibrationRows.filter(row => calcioScope.classifyCalcioTradingScope(row).paperOperational);
    const reportRows = options.operationalOnly === true ? operationalRows : calibrationRows;

    const calibration = valueEvaluator.calculateCalibrationBuckets(reportRows, {
        bucketSize,
        minSample,
        sportFilter: 'football',
        cleanOnly: true
    });
    const brier = valueEvaluator.calculateBrierAnalytics(reportRows, { cleanOnly: true, sportFilter: 'football' });
    const clv = valueEvaluator.calculateCLVAnalytics(reportRows, { cleanOnly: true, sportFilter: 'football' });
    const roi = valueEvaluator.calculatePortfolioROI(operationalRows, { cleanOnly: true, sportFilter: 'football' });

    return {
        sport: 'CALCIO',
        version: CALCIO_CALIBRATION_ENGINE_VERSION,
        dataMode: options.operationalOnly === true ? 'CALCIO_OPERATIONAL_ONLY' : 'CALCIO_STRICT_CURRENT_WITH_AUDIT_FOR_CALIBRATION',
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

function calibrateCalcioProbability(probabilityPct, rows = [], options = {}) {
    const report = options.report || buildCalcioCalibrationReport(rows, options);
    const marketProbability = options.marketProbabilityPct ?? options.market_implied_prob ?? null;
    const result = valueEvaluator.calibrateProbabilityByBuckets(probabilityPct, report.calibration, {
        maxAdjustment: options.maxAdjustment ?? 7,
        minReliableSample: options.minReliableSample ?? Math.max(15, Number(report.minSample || 30)),
        shrinkToMarket: marketProbability
    });

    const clvAvg = safeNumber(report.clv?.avgCLV, 0);
    let clvAdjustment = 0;
    if (report.clv?.sampleSize >= 30) {
        if (clvAvg >= 1.25) clvAdjustment = 1.25;
        else if (clvAvg >= 0.5) clvAdjustment = 0.6;
        else if (clvAvg < -1) clvAdjustment = -1.75;
        else if (clvAvg < 0) clvAdjustment = -0.85;
    }

    const calibrated = clamp(safeNumber(result.probability, probabilityPct) + clvAdjustment, 1, 99);

    return {
        ...result,
        probability: Number(calibrated.toFixed(2)),
        clvAdjustment: Number(clvAdjustment.toFixed(2)),
        finalAdjustment: Number((calibrated - safeNumber(probabilityPct, 50)).toFixed(2)),
        reportVersion: CALCIO_CALIBRATION_ENGINE_VERSION,
        sport: 'CALCIO',
        reason: `${result.reason}; CLV adjustment ${clvAdjustment >= 0 ? '+' : ''}${clvAdjustment.toFixed(2)}pp.`
    };
}

module.exports = {
    CALCIO_CALIBRATION_ENGINE_VERSION,
    getRowsForCalcioCalibration,
    buildCalcioCalibrationReport,
    calibrateCalcioProbability
};
