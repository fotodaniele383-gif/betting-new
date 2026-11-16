#!/usr/bin/env node
'use strict';
const { DatabaseSync } = require('node:sqlite');
const intake = require('../backend/tennisForwardSampleIntake');
const registry = require('../backend/tennisPatchRegistry');

function schema(db) {
  db.exec(`
    CREATE TABLE ai_forward_test (id INTEGER PRIMARY KEY,sport_type TEXT,bet_type TEXT,strategy_tag TEXT,league TEXT,match_date TEXT,home_team TEXT,away_team TEXT,prediction TEXT,odd REAL,estimated_prob REAL,status TEXT);
    CREATE TABLE tennis_prediction_snapshots (id INTEGER PRIMARY KEY,snapshot_id TEXT,bet_id INTEGER,snapshot_sequence INTEGER,snapshot_status TEXT,is_calibration_anchor INTEGER,captured_at TEXT);
    CREATE TABLE tennis_calibration_eligibility (bet_id INTEGER PRIMARY KEY,eligibility_status TEXT,prediction_snapshot_id TEXT);
    CREATE TABLE tennis_forward_cohort_members (bet_id INTEGER PRIMARY KEY,cohort_id TEXT,snapshot_id TEXT);
    CREATE TABLE tennis_player_evidence_snapshots (id INTEGER PRIMARY KEY,bet_id INTEGER,player_role TEXT);
    CREATE TABLE tennis_matchup_feature_snapshots (id INTEGER PRIMARY KEY,bet_id INTEGER);
    CREATE TABLE tennis_challenger_predictions (id INTEGER PRIMARY KEY,bet_id INTEGER);
    CREATE TABLE tennis_prediction_evidence_receipts (receipt_id TEXT PRIMARY KEY,bet_id INTEGER,phase TEXT);
  `);
}
function seed(db) {
  db.exec(`
    INSERT INTO ai_forward_test VALUES (1,'TENNIS','SINGLE_TENNIS','TENNIS_ATP_MONEYLINE','ATP Test','2026-07-21T12:00:00Z','A','B','1',1.8,62,'PENDING');
    INSERT INTO tennis_prediction_snapshots VALUES (1,'S24',1,1,'VALID_PREMATCH',1,'2026-07-20T10:00:00Z');
    INSERT INTO tennis_calibration_eligibility VALUES (1,'ELIGIBLE','S24');
    INSERT INTO tennis_forward_cohort_members VALUES (1,'C24','S24');
    INSERT INTO tennis_player_evidence_snapshots VALUES (1,1,'PLAYER_1'),(2,1,'PLAYER_2');
    INSERT INTO tennis_matchup_feature_snapshots VALUES (1,1);
    INSERT INTO tennis_challenger_predictions VALUES (1,1);
    INSERT INTO tennis_prediction_evidence_receipts VALUES ('R24',1,'PREDICTION_CAPTURE');
  `);
}
const checks=[];
function check(name, ok, details=null){checks.push({name,ok:Boolean(ok),details});}
const db=new DatabaseSync(':memory:');
try {
  schema(db);
  const empty=intake.inspectForwardSampleIntake(db);
  check('Registry Patch 24', registry.TENNIS_CURRENT_PATCH_VERSION==='24' && registry.TENNIS_PATCH_REGISTRY_VERSION==='TENNIS_PATCH_REGISTRY_V24');
  check('Empty schema ready', empty.status==='READY_FOR_NEXT_PREDICTION' && empty.structuralReady===true);
  seed(db);
  const artifacts=intake.assertForwardCapturePostconditions(db,1,{throwOnFailure:true});
  const pending=intake.inspectForwardSampleIntake(db);
  check('Atomic artifacts complete', artifacts.structuralComplete===true && artifacts.artifacts.playerEvidence===2 && artifacts.artifacts.receipts===1, artifacts);
  check('Pending captured not settled', pending.forwardSample.structurallyCompleteRows===1 && pending.forwardSample.actionableRows===0, pending.forwardSample);
  db.prepare("UPDATE ai_forward_test SET status='WON' WHERE id=1").run();
  const settled=intake.inspectForwardSampleIntake(db);
  check('Settled forward progress', settled.forwardSample.actionableRows===1 && settled.forwardSample.progressPct===1, settled.forwardSample);
  db.prepare('DELETE FROM tennis_prediction_evidence_receipts WHERE bet_id=1').run();
  let failedClosed=false;
  try { intake.assertForwardCapturePostconditions(db,1,{throwOnFailure:true}); } catch(e) { failedClosed=e.code==='PATCH24_FORWARD_CAPTURE_POSTCONDITION_FAILED'; }
  check('Missing evidence fails closed', failedClosed);
  check('No authority or backfill', settled.historicalBackfill===false && Object.values(settled.authority).every(v=>v===false), {historicalBackfill:settled.historicalBackfill,authority:settled.authority});
} finally { db.close(); }
const failed=checks.filter(x=>!x.ok);
const report={success:failed.length===0,patch:'24',version:intake.TENNIS_FORWARD_SAMPLE_INTAKE_VERSION,checks};
console.log(JSON.stringify(report,null,2));
if(failed.length)process.exitCode=2;
