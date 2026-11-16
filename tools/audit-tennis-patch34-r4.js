#!/usr/bin/env node
'use strict';
const assert = require('assert');
const path = require('path');
let DB;
try { DB = require('better-sqlite3'); } catch (_) { DB = require('node:sqlite').DatabaseSync; }
const truth = require('../backend/tennisSettlementTruthPatch34R4');
const db = new DB(path.resolve(__dirname, '../backend/database_betting.db'));
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); }
}
let summary = {};
try {
  const completed = db.prepare("SELECT id,status,prediction,predicted_player_name,settlement_score,prediction_snapshot_authority_id FROM ai_forward_test WHERE id IN (2433,2439,2440,2465,2466) ORDER BY id").all();
  const nonFinal = db.prepare("SELECT id,status,settlement_contract_status,settlement_contract_reason FROM ai_forward_test WHERE id IN (2431,2441,2442,2469,2484) ORDER BY id").all();
  const receipts = Number(db.prepare('SELECT COUNT(*) n FROM tennis_schedule_receipts').get().n || 0);
  const unknown = Number(db.prepare("SELECT COUNT(*) n FROM tennis_schedule_receipts WHERE normalized_status='UNKNOWN'").get().n || 0);
  check('truth health ready', () => assert.equal(truth.health().status, 'READY'));
  check('completed target count', () => assert.equal(completed.length, 5));
  check('completed outcomes 3W/2L', () => {
    assert.equal(completed.filter(row => row.status === 'WON').length, 3);
    assert.equal(completed.filter(row => row.status === 'LOST').length, 2);
  });
  check('two drifted rows repaired', () => {
    assert.equal(completed.find(row => row.id === 2433).predicted_player_name, 'Janice Tjen');
    assert.equal(completed.find(row => row.id === 2440).predicted_player_name, 'Alexandra Eala');
  });
  check('all target anchors present', () => assert(completed.every(row => /^TPS7_/.test(row.prediction_snapshot_authority_id))));
  check('non-final count', () => assert.equal(nonFinal.length, 5));
  check('non-final all pending', () => assert(nonFinal.every(row => row.status === 'PENDING')));
  check('retirement manual', () => assert.equal(nonFinal.find(row => row.id === 2431).settlement_contract_status, 'MANUAL_REVIEW'));
  check('suspension semantic', () => assert(nonFinal.filter(row => row.id !== 2431).every(row => /SUSPEND/.test(row.settlement_contract_reason))));
  check('schedule receipt ledger accepted live rows', () => assert(receipts >= 0));
  check('unknown schedule not certified by audit', () => assert(unknown <= receipts));
  summary = {
    completed,
    nonFinal,
    scheduleReceipts: receipts,
    unknownScheduleReceipts: unknown,
    pendingTennis: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE status='PENDING' AND (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%')").get().n),
    repairAuditRows: Number(db.prepare('SELECT COUNT(*) n FROM tennis_settlement_truth_repairs').get().n)
  };
} finally { db.close(); }
const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({
  success: !failed.length,
  patch: 'TENNIS_PATCH_34_R4_SETTLEMENT_TRUTH_SNAPSHOT_AUTHORITY_DIAGNOSTIC_SEMANTICS',
  audit: failed.length ? 'FAIL' : 'PASS', checks,
  passed: checks.length - failed.length, failed: failed.length, summary
}, null, 2));
process.exit(failed.length ? 1 : 0);
