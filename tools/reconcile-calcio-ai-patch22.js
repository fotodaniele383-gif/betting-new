'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');
const PATCH_ID = 'BETTING_PATCH_22_CALCIO_AI_FINALIZATION_CONSENSUS_RISK_GUARDS';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbArg = args.find(arg => arg !== '--dry-run');
const dbPath = dbArg ? path.resolve(dbArg) : path.resolve(__dirname, '../backend/database_betting.db');
function snapshot(db, where) { return db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum, COALESCE(SUM(COALESCE(stake,0)),0) stakeSum, COALESCE(SUM(COALESCE(profit,0)),0) profitSum FROM ai_forward_test WHERE ${where}`).get(); }
function stable(v) { return JSON.stringify(Object.fromEntries(Object.entries(v).map(([k,x])=>[k,Number(x)]))); }
const db = new DatabaseSync(dbPath);
try {
  const tennisWhere="UPPER(COALESCE(sport_type,''))='TENNIS'";
  const resolvedWhere="UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')";
  const before={tennis:snapshot(db,tennisWhere),resolved:snapshot(db,resolvedWhere)};
  const report=reconciler.reconcilePendingRows(db,{dryRun});
  const after={tennis:snapshot(db,tennisWhere),resolved:snapshot(db,resolvedWhere)};
  if(stable(before.tennis)!==stable(after.tennis)) throw new Error('Tennis modificato');
  if(stable(before.resolved)!==stable(after.resolved)) throw new Error('Calcio risolto modificato');
  if(!dryRun) db.exec("UPDATE ai_forward_test SET calcio_profit_display_mode='POTENTIAL_UNTIL_SETTLED' WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING'");
  console.log(JSON.stringify({success:true,patch:PATCH_ID,dryRun,dbPath,report,safeguards:{tennisUnchanged:true,resolvedCalcioUnchanged:true}},null,2));
} finally { db.close(); }
