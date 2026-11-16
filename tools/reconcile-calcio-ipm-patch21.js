'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');

const PATCH_ID = 'BETTING_PATCH_21_UNIFIED_IPM_STAKE_MARKET_SELECTION_RESTORE';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbArg = args.find(arg => arg !== '--dry-run');
const dbPath = dbArg ? path.resolve(dbArg) : path.resolve(__dirname, '../backend/database_betting.db');

function snapshot(db, where) {
  return db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(id),0) AS idSum, COALESCE(SUM(COALESCE(stake,0)),0) AS stakeSum, COALESCE(SUM(COALESCE(profit,0)),0) AS profitSum FROM ai_forward_test WHERE ${where}`).get();
}
function comparable(value) {
  return JSON.stringify({ n: Number(value.n), idSum: Number(value.idSum), stakeSum: Number(value.stakeSum), profitSum: Number(value.profitSum) });
}

const db = new DatabaseSync(dbPath);
try {
  const tennisWhere = "UPPER(COALESCE(sport_type,''))='TENNIS'";
  const resolvedWhere = "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')";
  const pendingWhere = "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1";
  const tennisBefore = snapshot(db, tennisWhere);
  const resolvedBefore = snapshot(db, resolvedWhere);
  const pendingBefore = snapshot(db, pendingWhere);

  const report = reconciler.reconcilePendingRows(db, { dryRun });

  const tennisAfter = snapshot(db, tennisWhere);
  const resolvedAfter = snapshot(db, resolvedWhere);
  const pendingAfter = snapshot(db, pendingWhere);
  if (comparable(tennisBefore) !== comparable(tennisAfter)) throw new Error('Tennis modificato dalla riconciliazione Patch 21');
  if (comparable(resolvedBefore) !== comparable(resolvedAfter)) throw new Error('Risultati Calcio risolti modificati dalla riconciliazione Patch 21');

  const invalidPositive = db.prepare(`
    SELECT COUNT(*) AS n
    FROM ai_forward_test
    WHERE ${pendingWhere}
      AND COALESCE(stake,0) > 0
      AND (
        COALESCE(calcio_identity_certified,0) <> 1 OR
        COALESCE(calcio_market_identity_certified,0) <> 1 OR
        COALESCE(calcio_odds_operational_eligible,0) <> 1 OR
        UPPER(COALESCE(calcio_decision_certification_status,'')) = 'PATCH19_REQUIRES_PROVIDER_REFRESH'
      )
  `).get();
  if (Number(invalidPositive.n) > 0) throw new Error(`Stake positivi privi di certificazione strutturale: ${invalidPositive.n}`);

  console.log(JSON.stringify({
    success: true,
    patch: PATCH_ID,
    dryRun,
    dbPath,
    scanned: report.scanned,
    selectedLatestEvents: report.selectedLatestEvents,
    updated: report.updated,
    unchanged: report.unchanged,
    operationalPositive: report.operationalPositive,
    refreshRequiredSkipped: report.refreshRequiredSkipped,
    invalidPositive: Number(invalidPositive.n),
    policy: {
      singleStakeAuthority: 'UNIFIED_PREDICTION_INDEX_ONLY',
      minimumPredictionIndex: 60,
      minimumReliability: 55,
      paperTradingNoSampleScore: 50,
      edgeEvWeight: 0.25,
      deepScanGateTimingDirectVeto: false,
      legacyThresholdsDirectVeto: false,
      minimumPositiveStakeEur: 2,
      baseFractionalKelly: 0.15,
      certifiedOddsIdentityMarketGuardsPreserved: true
    },
    snapshots: { pendingBefore, pendingAfter, tennisBefore, tennisAfter, resolvedBefore, resolvedAfter }
  }, null, 2));
} finally {
  db.close();
}
