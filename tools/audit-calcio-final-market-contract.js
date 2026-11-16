'use strict';
const path = require('path');
const Database = require('./sqlite-compat');
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
function count(sql, ...args) { return db.prepare(sql).get(...args).n; }
function num(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function text(value) { return String(value ?? '').trim(); }
function parse(value) { try { return value && typeof value === 'object' ? value : JSON.parse(String(value || '{}')); } catch (_) { return {}; } }
function sameNumber(left, right, tolerance = 0.01) { return Math.abs(num(left, NaN) - num(right, NaN)) <= tolerance; }
const states = db.prepare(`SELECT COALESCE(NULLIF(calcio_decision_state,''),'ABSENT') AS state, COUNT(*) AS n
 FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,''))='PENDING'
 GROUP BY COALESCE(NULLIF(calcio_decision_state,''),'ABSENT') ORDER BY n DESC`).all();
const contractRows = count("SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(calcio_final_market_contract_version,'')<>''");
const coherentRows = count("SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(calcio_final_market_contract_version,'')<>'' AND COALESCE(calcio_diagnostic_coherence_status,'')='FINAL_MARKET_DIAGNOSTIC_COHERENCE_CERTIFIED'");
const mismatchRows = count(`SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(calcio_final_market_contract_version,'')<>'' AND (
 COALESCE(calcio_final_market_id,'')='' OR COALESCE(calcio_final_market_snapshot,'')='' OR
 COALESCE(calcio_diagnostic_coherence_status,'')<>'FINAL_MARKET_DIAGNOSTIC_COHERENCE_CERTIFIED')`);
const positiveNonReady = count(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
 AND COALESCE(calcio_operational_stake,0)>0 AND COALESCE(calcio_decision_state,'')<>'BET_READY'`);
const auditRows = count('SELECT COUNT(*) n FROM calcio_final_market_contract_audit_log');
const rows = db.prepare(`SELECT id, estimated_prob, calcio_final_market_id, calcio_final_market_snapshot,
 calcio_decision_state, calcio_data_quality_status, calcio_stake_authority_model_stake,
 calcio_stake_authority_reliability_stake, calcio_stake_authority_final_stake, calcio_operational_stake
 FROM ai_forward_test WHERE COALESCE(calcio_final_market_contract_version,'')<>''`).all();
const snapshotUiMismatchDetails = [];
for (const row of rows) {
  const snapshot = parse(row.calcio_final_market_snapshot);
  const mismatches = [];
  if (text(snapshot.marketId) !== text(row.calcio_final_market_id)) mismatches.push('MARKET_ID');
  if (text(snapshot.decisionState?.code) !== text(row.calcio_decision_state)) mismatches.push('DECISION_STATE');
  if (text(snapshot.dataQuality?.status) !== text(row.calcio_data_quality_status)) mismatches.push('DATA_QUALITY');
  if (!sameNumber(snapshot.stake?.modelStake, row.calcio_stake_authority_model_stake)) mismatches.push('MODEL_STAKE');
  if (!sameNumber(snapshot.stake?.reliabilityStake, row.calcio_stake_authority_reliability_stake)) mismatches.push('RELIABILITY_STAKE');
  if (!sameNumber(snapshot.stake?.finalOperationalStake, row.calcio_stake_authority_final_stake ?? row.calcio_operational_stake)) mismatches.push('OPERATIONAL_STAKE');
  if (!sameNumber(snapshot.probabilityPct, row.estimated_prob, 0.02)) mismatches.push('FINAL_PROBABILITY');
  if (mismatches.length) snapshotUiMismatchDetails.push({ id: row.id, mismatches });
}
const snapshotUiMismatches = snapshotUiMismatchDetails.length;
const success = mismatchRows === 0 && positiveNonReady === 0 && snapshotUiMismatches === 0;
const liveCertified = success && contractRows > 0 && coherentRows === contractRows && auditRows >= contractRows;
const certification = liveCertified
  ? 'LIVE_FINAL_MARKET_CONTRACT_AND_UI_POST_COMMIT_SYNC_CERTIFIED'
  : 'REQUIRES_FRESH_LIVE_ANALYSIS';
db.close();
console.log(JSON.stringify({
  success,
  readOnly: true,
  revision: 'R4_UI_POST_COMMIT_SYNC_AND_LIVE_CERTIFICATION',
  certification,
  liveCertified,
  contractVersion: 'BETTING_PATCH_26F_A_FINAL_MARKET_DIAGNOSTIC_CONTRACT_V1',
  contractRows,
  coherentRows,
  mismatchRows,
  positiveNonReady,
  snapshotUiMismatches,
  snapshotUiMismatchDetails: snapshotUiMismatchDetails.slice(0, 20),
  auditRows,
  states
}, null, 2));
if (!success) process.exit(1);
