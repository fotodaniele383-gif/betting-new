'use strict';
const assert = require('assert');
const path = require('path');
const Database = require('./sqlite-compat');
const db = new Database(process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db'), { readonly: true });
const cols = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r => r.name));
[
 'calcio_cross_market_reliability_version','calcio_cross_market_stress_status','calcio_cross_market_stress_probability',
 'calcio_cross_market_gap_pp','calcio_cross_market_lambda_home','calcio_cross_market_lambda_away',
 'calcio_analysis_maturity_score','calcio_days_to_kickoff','calcio_epistemic_uncertainty_score',
 'calcio_robust_probability','calcio_robust_ev_pct','calcio_reliability_stake_multiplier',
 'calcio_unadjusted_pre_cap_stake','calcio_reliability_adjusted_stake','calcio_reliability_guard_status','calcio_reliability_guard_audit'
].forEach(c => assert(cols.has(c), c));
const tennis = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n;
assert(tennis > 0);
db.close();
console.log(JSON.stringify({ success: true, checks: 17, tennis }, null, 2));
