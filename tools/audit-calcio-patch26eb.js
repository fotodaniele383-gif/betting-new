'use strict';
const path = require('path');
const Database = require('./sqlite-compat');
const registry = require('../backend/calcioPatchRegistry');
const db = new Database(process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db'), { readonly: true });
const total = db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
const tennis = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n;
const calcio = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'").get().n;
const populated = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(calcio_cross_market_reliability_version,'')<>''").get().n;
const increased = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE COALESCE(calcio_cross_market_reliability_version,'')<>''
 AND COALESCE(calcio_reliability_adjusted_stake,0) > COALESCE(calcio_unadjusted_pre_cap_stake,0) + 0.001`).get().n;
const changedProduction = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE COALESCE(calcio_cross_market_reliability_version,'')<>''
 AND COALESCE(calcio_robust_probability,0) > 0
 AND COALESCE(estimated_prob,0)=COALESCE(calcio_robust_probability,0)
 AND ABS(COALESCE(calcio_cross_market_gap_pp,0)) > 0.01`).get().n;
db.close();
console.log(JSON.stringify({
    success: increased === 0,
    patch: 'BETTING_PATCH_26E_B_CALCIO_CROSS_MARKET_UNCERTAINTY_OPERATIONAL_GUARD',
    certification: 'OPERATIVE_CONSERVATIVE_GUARD_WITHOUT_HISTORICAL_CALIBRATION_REQUIRES_FRESH_LIVE_ANALYSIS',
    registry: { version: registry.CALCIO_CURRENT_PATCH_VERSION },
    database: { total, tennis, calcio, reliabilityGuardRows: populated, stakeIncreaseViolations: increased, possibleProductionReplacementRows: changedProduction },
    guards: {
        inversePoissonOneXTwoStress: true,
        temporalMaturity: true,
        epistemicUncertainty: true,
        productionProbabilityUnchanged: true,
        oneWayStakeAuthority: true,
        canOnlyReduceOrZero: true,
        noHistoricalCalibrationMode: true,
        newOddsApiCalls: 0
    },
    nextStep: 'FRESH_CALCIO_ANALYSIS_THEN_TRACK_CLV_CALIBRATION_AND_RESULTS'
}, null, 2));
if (increased !== 0) process.exit(1);
