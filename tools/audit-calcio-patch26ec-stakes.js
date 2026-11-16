'use strict';
const path = require('path');
const Database = require('./sqlite-compat');
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
const batchId = process.argv[2] || db.prepare(`SELECT calcio_analysis_batch_id batch_id FROM ai_forward_test
 WHERE COALESCE(calcio_stake_authority_version,'')<>'' AND calcio_analysis_batch_id IS NOT NULL
 ORDER BY id DESC LIMIT 1`).get()?.batch_id || null;
const rows = batchId ? db.prepare(`SELECT id, match_description, prediction, odd, estimated_prob,
 calcio_robust_probability, calcio_robust_ev_pct, calcio_prediction_index_score,
 calcio_data_quality_status, calcio_data_quality_score, calcio_stake_bankroll_snapshot,
 bankroll_snapshot, calcio_stake_authority_model_stake, calcio_stake_authority_reliability_stake,
 calcio_stake_authority_final_stake, calcio_stake_authority_status, calcio_stake_authority_reason,
 calcio_final_narrative, calcio_portfolio_batch_status, calcio_portfolio_batch_certified
 FROM ai_forward_test WHERE calcio_analysis_batch_id=? ORDER BY id`).all(batchId) : [];
const summary = {
  batchId,
  rows: rows.length,
  authorized: rows.filter(r => Number(r.calcio_stake_authority_final_stake || 0) >= 2).length,
  totalStake: Math.round(rows.reduce((s, r) => s + Number(r.calcio_stake_authority_final_stake || 0), 0) * 100) / 100,
  positiveWithNonPositiveRobustEv: rows.filter(r => Number(r.calcio_stake_authority_final_stake || 0) > 0 && Number(r.calcio_robust_ev_pct || 0) <= 0).length,
  blockedQualityWithStake: rows.filter(r => String(r.calcio_data_quality_status || '').includes('BLOCKED') && Number(r.calcio_stake_authority_final_stake || 0) > 0).length,
  bankrollMismatches: rows.filter(r => Math.abs(Number(r.calcio_stake_bankroll_snapshot || 0) - Number(r.bankroll_snapshot || 0)) > 0.01).length
};
summary.success = summary.positiveWithNonPositiveRobustEv === 0 && summary.blockedQualityWithStake === 0 && summary.bankrollMismatches === 0;
db.close();
console.log(JSON.stringify({ success: summary.success, patch: '26E-C', summary, rows }, null, 2));
if (!summary.success) process.exit(1);
