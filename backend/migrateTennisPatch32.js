#!/usr/bin/env node
'use strict';
const path = require('path');
const observability = require('./tennisRejectedCaptureObservability');
const PATCH = 'TENNIS_PATCH_32_REJECTED_CAPTURE_OBSERVABILITY_CLOCK_DRIFT_LEDGER';
function openDatabase(dbPath) {
  try { const BetterSqlite3 = require('better-sqlite3'); return { db: new BetterSqlite3(dbPath), adapter: 'better-sqlite3' }; }
  catch (_) { const { DatabaseSync } = require('node:sqlite'); return { db: new DatabaseSync(dbPath), adapter: 'node:sqlite' }; }
}
function businessCounts(db) {
  return {
    total: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0),
    tennis: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n || 0),
    snapshots: Number(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots').get().n || 0),
    anchors: Number(db.prepare('SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE is_calibration_anchor=1').get().n || 0),
    invalid: Number(db.prepare("SELECT COUNT(*) n FROM tennis_prediction_snapshots WHERE snapshot_status IN ('POST_START_INVALID','INCOMPLETE')").get().n || 0)
  };
}
function migrate(db, options = {}) {
  const apply = options.apply === true;
  const before = businessCounts(db);
  const beforeSchema = observability.schemaHealth(db);
  if (apply) observability.ensureSchema(db);
  const afterSchema = observability.schemaHealth(db);
  const after = businessCounts(db);
  const ledgerRows = afterSchema.tablePresent ? Number(db.prepare('SELECT COUNT(*) n FROM tennis_rejected_capture_ledger').get().n || 0) : 0;
  const success = JSON.stringify(before) === JSON.stringify(after) && (!apply || afterSchema.healthy);
  return {
    success, patch: PATCH, mode: apply ? 'APPLY_ADDITIVE_APPEND_ONLY_LEDGER' : 'READ_ONLY_PREVIEW',
    schemaBefore: beforeSchema, schemaAfter: afterSchema, businessCounts: { before, after }, ledgerRows,
    noHistoricalBackfill: ledgerRows === 0,
    safeguards: { businessRowsUnchanged: JSON.stringify(before) === JSON.stringify(after), predictionsBackfilled: false, modelAuthorityChanged: false, qualityGateChanged: false, stakeChanged: false, settlementChanged: false, soccerChanged: false, oddsApiCallsAdded: 0 }
  };
}
if (require.main === module) {
  const args = new Set(process.argv.slice(2)); const apply = args.has('--apply');
  const dbArg = process.argv.slice(2).find(arg => /\.db$/i.test(arg)); const dbPath = path.resolve(dbArg || path.join(__dirname,'database_betting.db'));
  const { db, adapter } = openDatabase(dbPath);
  try { const result = migrate(db,{apply}); result.database=dbPath; result.adapter=adapter; console.log(JSON.stringify(result,null,2)); process.exitCode=result.success?0:1; }
  finally { db.close(); }
}
module.exports = { PATCH, openDatabase, businessCounts, migrate };
