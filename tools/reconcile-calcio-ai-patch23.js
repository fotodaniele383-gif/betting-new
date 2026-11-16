'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');

const PATCH_ID = 'BETTING_PATCH_23_CALCIO_AI_DETERMINISTIC_FINALIZATION_CERTIFICATION';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbArg = args.find(arg => arg !== '--dry-run');
const dbPath = dbArg ? path.resolve(dbArg) : path.resolve(__dirname, '../backend/database_betting.db');

function snapshot(db, where) {
  return db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum, COALESCE(SUM(COALESCE(stake,0)),0) stakeSum, COALESCE(SUM(COALESCE(profit,0)),0) profitSum FROM ai_forward_test WHERE ${where}`).get();
}
function stable(v) { return JSON.stringify(Object.fromEntries(Object.entries(v).map(([k,x]) => [k, Number(x)]))); }

const db = new DatabaseSync(dbPath);
try {
  reconciler.ensurePredictionIndexColumns(db);
  const tennisWhere = "UPPER(COALESCE(sport_type,''))='TENNIS'";
  const resolvedWhere = "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')";
  const pendingWhere = "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR') AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0";
  const before = { tennis: snapshot(db, tennisWhere), resolved: snapshot(db, resolvedWhere), pending: snapshot(db, pendingWhere) };
  const rows = db.prepare(`SELECT id, stake, calcio_operational_stake, calcio_ipm_certification_status FROM ai_forward_test WHERE ${pendingWhere}`).all();
  let updated = 0;
  let suspendedPositive = 0;
  if (!dryRun) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const stmt = db.prepare(`UPDATE ai_forward_test SET
        stake=0,
        calcio_operational_stake=0,
        calcio_gate_max_stake=0,
        calcio_gate_allow_bet=0,
        calcio_prediction_index_eligible=0,
        calcio_stake_lifecycle_status='PATCH23_REQUIRES_FRESH_FINALIZATION',
        calcio_operational_action='ANALYSIS_ONLY_PATCH23_REFRESH',
        calcio_analysis_only=1,
        prediction_visibility='ANALYSIS_ONLY',
        exposure_role='ANALYSIS_ONLY',
        calcio_ipm_certification_status='PATCH23_REQUIRES_FRESH_FINALIZATION',
        calcio_output_coherence_status='PENDING_FRESH_FINALIZATION',
        calcio_pt_certification_status=CASE WHEN COALESCE(historical_combo_resolved,0)>0 THEN 'PT_REQUIRES_REVALIDATION' ELSE 'PT_ABSENT_NEUTRAL' END,
        calcio_structural_certification_label='ANALISI · FINALIZZAZIONE PATCH 23 RICHIESTA',
        calcio_portfolio_cap_post_finalization=0,
        calcio_finalization_transaction_status='REQUIRES_FRESH_FINALIZATION',
        calcio_profit_display_mode='POTENTIAL_UNTIL_SETTLED'
        WHERE id=?`);
      for (const row of rows) {
        const positive = Number(row.stake || row.calcio_operational_stake || 0) > 0;
        const already = String(row.calcio_ipm_certification_status || '') === 'PATCH23_REQUIRES_FRESH_FINALIZATION' && !positive;
        if (already) continue;
        if (positive) suspendedPositive += 1;
        stmt.run(row.id);
        updated += 1;
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }
  const after = { tennis: snapshot(db, tennisWhere), resolved: snapshot(db, resolvedWhere), pending: snapshot(db, pendingWhere) };
  if (stable(before.tennis) !== stable(after.tennis)) throw new Error('Tennis modificato');
  if (stable(before.resolved) !== stable(after.resolved)) throw new Error('Calcio risolto modificato');
  const positiveAfter = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${pendingWhere} AND COALESCE(stake,0)>0`).get().n);
  console.log(JSON.stringify({
    success: true,
    patch: PATCH_ID,
    dryRun,
    dbPath,
    scanned: rows.length,
    updated,
    suspendedPositive,
    positiveAfter,
    before,
    after,
    safeguards: { tennisUnchanged: true, resolvedCalcioUnchanged: true, legacyRowsNotFalselyCertified: positiveAfter === 0 }
  }, null, 2));
} finally { db.close(); }
