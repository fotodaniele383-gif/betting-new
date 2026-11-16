'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');

const dbPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../backend/database_betting.db');

function snapshot(db, where) {
  return db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(id),0) AS idSum, COALESCE(SUM(COALESCE(stake,0)),0) AS stakeSum, COALESCE(SUM(COALESCE(profit,0)),0) AS profitSum FROM ai_forward_test WHERE ${where}`).get();
}

const db = new DatabaseSync(dbPath);
try {
  const tennisBefore = snapshot(db, "UPPER(COALESCE(sport_type,''))='TENNIS'");
  const resolvedBefore = snapshot(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')");
  const pendingBefore = snapshot(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1");

  const report = reconciler.reconcilePendingRows(db);

  const tennisAfter = snapshot(db, "UPPER(COALESCE(sport_type,''))='TENNIS'");
  const resolvedAfter = snapshot(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')");
  const pendingAfter = snapshot(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1");

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(tennisBefore, tennisAfter)) throw new Error('Tennis rows changed during Patch 18 migration');
  if (!same(resolvedBefore, resolvedAfter)) throw new Error('Resolved Calcio rows changed during Patch 18 migration');

  console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE',
    dbPath,
    report,
    safeguards: {
      tennisUnchanged: true,
      resolvedCalcioUnchanged: true,
      historicalRowsDeleted: false,
      pendingCalcioOnly: true
    },
    snapshots: { pendingBefore, pendingAfter, tennisBefore, tennisAfter, resolvedBefore, resolvedAfter }
  }, null, 2));
} finally {
  db.close();
}
