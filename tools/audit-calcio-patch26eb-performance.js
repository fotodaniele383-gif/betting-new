'use strict';
const path = require('path');
const Database = require('./sqlite-compat');
const db = new Database(process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db'), { readonly: true });
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function round(v, d = 4) { const f = 10 ** d; return Math.round((num(v) + Number.EPSILON) * f) / f; }
function clampP(v) { return Math.min(0.999999, Math.max(0.000001, num(v) / 100)); }
const rows = db.prepare(`SELECT id, status, estimated_prob, calcio_robust_probability,
    calcio_unadjusted_pre_cap_stake, calcio_reliability_adjusted_stake,
    calcio_operational_stake, odd, profit, calcio_days_to_kickoff,
    calcio_cross_market_gap_pp, calcio_reliability_guard_status
  FROM ai_forward_test
  WHERE COALESCE(calcio_cross_market_reliability_version,'')<>''
    AND UPPER(COALESCE(status,'')) IN ('WON','LOST')
  ORDER BY id`).all();
db.close();
const metrics = rows.reduce((acc, row) => {
    const y = String(row.status).toUpperCase() === 'WON' ? 1 : 0;
    const pProd = clampP(row.estimated_prob);
    const pRobust = clampP(row.calcio_robust_probability || row.estimated_prob);
    acc.productionBrier += (pProd - y) ** 2;
    acc.robustBrier += (pRobust - y) ** 2;
    acc.productionLogLoss += -(y * Math.log(pProd) + (1 - y) * Math.log(1 - pProd));
    acc.robustLogLoss += -(y * Math.log(pRobust) + (1 - y) * Math.log(1 - pRobust));
    acc.productionMeanP += pProd;
    acc.robustMeanP += pRobust;
    acc.wins += y;
    acc.modelStake += num(row.calcio_unadjusted_pre_cap_stake);
    acc.reliabilityStake += num(row.calcio_reliability_adjusted_stake);
    acc.operationalStake += num(row.calcio_operational_stake);
    acc.profit += num(row.profit);
    return acc;
}, { productionBrier:0, robustBrier:0, productionLogLoss:0, robustLogLoss:0, productionMeanP:0, robustMeanP:0, wins:0, modelStake:0, reliabilityStake:0, operationalStake:0, profit:0 });
const n = rows.length;
const result = n ? {
    sample: n,
    wins: metrics.wins,
    losses: n - metrics.wins,
    hitRatePct: round(metrics.wins / n * 100, 2),
    production: {
        meanProbabilityPct: round(metrics.productionMeanP / n * 100, 3),
        calibrationBiasPp: round((metrics.productionMeanP / n - metrics.wins / n) * 100, 3),
        brierScore: round(metrics.productionBrier / n, 5),
        logLoss: round(metrics.productionLogLoss / n, 5)
    },
    robustGuard: {
        meanProbabilityPct: round(metrics.robustMeanP / n * 100, 3),
        calibrationBiasPp: round((metrics.robustMeanP / n - metrics.wins / n) * 100, 3),
        brierScore: round(metrics.robustBrier / n, 5),
        logLoss: round(metrics.robustLogLoss / n, 5)
    },
    stake: {
        modelRequested: round(metrics.modelStake, 2),
        afterReliability: round(metrics.reliabilityStake, 2),
        operational: round(metrics.operationalStake, 2),
        avoidedVsModel: round(metrics.modelStake - metrics.reliabilityStake, 2),
        profit: round(metrics.profit, 2),
        operationalRoiPct: metrics.operationalStake > 0 ? round(metrics.profit / metrics.operationalStake * 100, 2) : null
    },
    comparison: {
        robustBrierImprovement: round(metrics.productionBrier / n - metrics.robustBrier / n, 5),
        robustLogLossImprovement: round(metrics.productionLogLoss / n - metrics.robustLogLoss / n, 5)
    }
} : {
    sample: 0,
    status: 'NO_RESOLVED_PATCH26E_B_SAMPLE',
    production: { brierScore: null, logLoss: null, calibrationBiasPp: null },
    robustGuard: { brierScore: null, logLoss: null, calibrationBiasPp: null },
    stake: { modelRequested: 0, afterReliability: 0, operational: 0, avoidedVsModel: 0, profit: 0, operationalRoiPct: null }
};
console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_26E_B_CALCIO_CROSS_MARKET_UNCERTAINTY_OPERATIONAL_GUARD',
    calibrationMode: 'FORWARD_ONLY_NO_HISTORICAL_BACKFILL',
    result
}, null, 2));
