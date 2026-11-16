#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const truth = require('./tennisSettlementTruthPatch34R4');
const snapshots = require('./tennisPredictionSnapshots');
const calibration = require('./tennisCalibrationEligibility');

const PATCH = 'TENNIS_PATCH_34_R4_SETTLEMENT_TRUTH_SNAPSHOT_AUTHORITY_DIAGNOSTIC_SEMANTICS';
const REVISION = 'R4_WINDOWS_NODE_SETTLEMENT_TRUTH_SNAPSHOT_AUTHORITY_DIAGNOSTIC_SEMANTICS';
const MIGRATION = 'TARGETED_OFFICIAL_SETTLEMENT_TRUTH_REPAIR_WITH_IMMUTABLE_SNAPSHOT_AUTHORITY';
const AUDIT_TABLE = 'tennis_settlement_truth_repairs';
const TARGET_COMPLETED = [2433, 2439, 2440, 2465, 2466];
const TARGET_NON_FINAL = [2431, 2441, 2442, 2469, 2484];
const EXPECTED = Object.freeze({ 2433:'LOST', 2439:'WON', 2440:'WON', 2465:'WON', 2466:'LOST' });
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const preview = args.includes('--preview') || !apply;
const dbArg = args.find(v => /\.db$/i.test(v));
const dbPath = path.resolve(process.cwd(), dbArg || 'backend/database_betting.db');

function openDb(file) {
  try { const BetterSqlite3 = require('better-sqlite3'); return { db:new BetterSqlite3(file), adapter:'better-sqlite3' }; }
  catch (_) { const { DatabaseSync } = require('node:sqlite'); return { db:new DatabaseSync(file), adapter:'node:sqlite' }; }
}
function text(v){ return String(v == null ? '' : v).trim(); }
function stable(value){ if(Array.isArray(value))return value.map(stable); if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])); return value; }
function sha(value){ return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(stable(value))).digest('hex'); }
function tableExists(db,t){ return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(t)); }
function columns(db,t){ return new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(r=>r.name)); }
function qid(name){ if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw new Error('INVALID_IDENTIFIER'); return `"${name}"`; }
function updateExisting(db, table, id, fields){
  const cols=columns(db,table); const entries=Object.entries(fields).filter(([k])=>cols.has(k));
  if(!entries.length)return 0;
  const sql=`UPDATE ${qid(table)} SET ${entries.map(([k])=>`${qid(k)}=?`).join(', ')} WHERE id=?`;
  const res=db.prepare(sql).run(...entries.map(([,v])=>v),id); return Number(res.changes||0);
}
function ensureColumns(db){
  const required=[
    ['settlement_truth_version','TEXT'],['settlement_truth_repair_id','TEXT'],
    ['prediction_snapshot_authority_id','TEXT'],['prediction_snapshot_authority_hash','TEXT']
  ];
  const have=columns(db,'ai_forward_test');
  for(const [name,type] of required) if(!have.has(name)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
}
function ensureAudit(db){
  db.exec(`CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE} (
    repair_id TEXT PRIMARY KEY, bet_id INTEGER NOT NULL, applied_at TEXT NOT NULL,
    migration_version TEXT NOT NULL, truth_version TEXT NOT NULL,
    source_event_id TEXT, source_evidence_hash TEXT,
    snapshot_id TEXT, snapshot_hash TEXT,
    immutable_prediction TEXT, immutable_predicted_player TEXT,
    current_prediction_before TEXT, current_predicted_player_before TEXT,
    status_before TEXT, status_after TEXT, outcome TEXT,
    reason TEXT NOT NULL, before_hash TEXT NOT NULL, after_hash TEXT NOT NULL,
    before_json TEXT NOT NULL, after_json TEXT NOT NULL
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${AUDIT_TABLE}_bet_truth ON ${AUDIT_TABLE}(bet_id, truth_version)`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${AUDIT_TABLE}_no_update BEFORE UPDATE ON ${AUDIT_TABLE} BEGIN SELECT RAISE(ABORT,'${AUDIT_TABLE} append-only'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${AUDIT_TABLE}_no_delete BEFORE DELETE ON ${AUDIT_TABLE} BEGIN SELECT RAISE(ABORT,'${AUDIT_TABLE} append-only'); END;`);
}
function rowSnapshot(row){
  const keys=['id','home_team','away_team','match_date','prediction','internal_side','predicted_player_name','odd','estimated_prob','stake','status','profit','winner_side','winner_player_name','settlement_contract_status','settlement_contract_reason','settlement_source','settlement_source_event_id','settlement_score','settlement_event_fingerprint','settlement_market_fingerprint','tennis_event_fingerprint','tennis_market_fingerprint','settlement_truth_version','settlement_truth_repair_id','prediction_snapshot_authority_id','prediction_snapshot_authority_hash'];
  return Object.fromEntries(keys.map(k=>[k,row?.[k]??null]));
}
function immutableRow(db,row){
  const anchor=snapshots.getCalibrationAnchor(db,row.id);
  if(!anchor) throw new Error(`PATCH34_R4_CALIBRATION_ANCHOR_MISSING:${row.id}`);
  const effective=calibration.applyPredictionSnapshotToRow(row,anchor);
  let payload={}; try{payload=JSON.parse(anchor.payload_json||'{}')||{};}catch(_){}
  const side=text(payload.predicted_side||effective.prediction);
  const player=text(payload.predicted_player_name || (side==='1'?row.home_team:side==='2'?row.away_team:''));
  effective.prediction=side; effective.internal_side=side; effective.predicted_player_name=player;
  effective.tennis_event_fingerprint=payload.event_fingerprint||effective.tennis_event_fingerprint;
  effective.tennis_market_fingerprint=payload.market_fingerprint||effective.tennis_market_fingerprint;
  return { row:effective, anchor, payload };
}
function profitFor(row,outcome){ const stake=Number(row.stake||0); const odd=Number(row.odd||0); if(outcome==='WON')return Number((stake*Math.max(0,odd-1)).toFixed(2)); if(outcome==='LOST')return Number((-stake).toFixed(2)); return 0; }
function repairCompleted(db, betId, now, doApply){
  const current=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(betId); if(!current)throw new Error(`TARGET_BET_MISSING:${betId}`);
  const resolved=truth.resolve(current); if(!resolved||resolved.nonFinal)throw new Error(`TARGET_OFFICIAL_RESULT_MISSING:${betId}`);
  const immutable=immutableRow(db,current); const outcome=truth.expectedOutcome(immutable.row,resolved);
  if(outcome!==EXPECTED[betId])throw new Error(`SNAPSHOT_OUTCOME_MISMATCH:${betId}:${outcome}:${EXPECTED[betId]}`);
  const repairId=`TSR34R4_${betId}_${sha([truth.VERSION,resolved.sourceEventId,immutable.anchor.snapshot_hash]).slice(0,18)}`;
  const fields={
    prediction:immutable.row.prediction, internal_side:immutable.row.internal_side, predicted_player_name:immutable.row.predicted_player_name,
    odd:immutable.row.odd, opening_odd:immutable.row.opening_odd, estimated_prob:immutable.row.estimated_prob,
    calibrated_probability_pct:immutable.row.calibrated_probability_pct,
    tennis_event_fingerprint:immutable.row.tennis_event_fingerprint, tennis_market_fingerprint:immutable.row.tennis_market_fingerprint,
    status:outcome, profit:profitFor(immutable.row,outcome), winner_side:Number(resolved.winner), winner_player_name:resolved.winnerName,
    total_games:Number(resolved.totalGames), settled_at:now,
    settlement_contract_status:'VERIFIED', settlement_contract_reason:'PATCH34_R4_SIGNED_OFFICIAL_TRUTH_AND_IMMUTABLE_SNAPSHOT',
    settlement_contract_version:'TENNIS_SETTLEMENT_CONTRACT_V1_PATCH5', settlement_source:resolved.source,
    settlement_source_tier:'OFFICIAL', settlement_source_event_id:resolved.sourceEventId, settlement_winner_name:resolved.winnerName,
    settlement_score:resolved.score, settlement_observed_at:resolved.observedAt, settlement_confidence:resolved.confidence,
    settlement_evidence_hash:resolved.evidenceHash, settlement_event_fingerprint:immutable.row.tennis_event_fingerprint,
    settlement_market_fingerprint:immutable.row.tennis_market_fingerprint, settlement_operation_id:repairId,
    settlement_note:`Patch 34 R4 targeted truth repair. Outcome ${outcome} evaluated from immutable calibration anchor ${immutable.anchor.snapshot_id}; mutable post-capture analysis cannot rewrite forward truth.`,
    side_mapping_verified:1, side_identity_version:truth.IDENTITY_VERSION,
    settlement_truth_version:truth.VERSION, settlement_truth_repair_id:repairId,
    prediction_snapshot_authority_id:immutable.anchor.snapshot_id, prediction_snapshot_authority_hash:immutable.anchor.snapshot_hash,
    engine_version:'11.8_PATCH34_R4_SETTLEMENT_TRUTH_SNAPSHOT_AUTHORITY'
  };
  const before=rowSnapshot(current); const after={...before,...fields};
  if(doApply){
    const existing=db.prepare(`SELECT repair_id FROM ${AUDIT_TABLE} WHERE bet_id=? AND truth_version=?`).get(betId,truth.VERSION);
    if(!existing){
      updateExisting(db,'ai_forward_test',betId,fields);
      db.prepare(`INSERT INTO ${AUDIT_TABLE}(repair_id,bet_id,applied_at,migration_version,truth_version,source_event_id,source_evidence_hash,snapshot_id,snapshot_hash,immutable_prediction,immutable_predicted_player,current_prediction_before,current_predicted_player_before,status_before,status_after,outcome,reason,before_hash,after_hash,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        repairId,betId,now,MIGRATION,truth.VERSION,resolved.sourceEventId,resolved.evidenceHash,immutable.anchor.snapshot_id,immutable.anchor.snapshot_hash,
        immutable.row.prediction,immutable.row.predicted_player_name,current.prediction,current.predicted_player_name,current.status,outcome,outcome,
        'SIGNED_OFFICIAL_RESULT_WITH_IMMUTABLE_PREMATCH_SNAPSHOT_AUTHORITY',sha(before),sha(after),JSON.stringify(before),JSON.stringify(after)
      );
      snapshots.refreshCalibrationEligibilityForBet(db,betId,{operationId:repairId});
    }
  }
  return { betId, outcome, winner:resolved.winnerName, score:resolved.score, snapshotId:immutable.anchor.snapshot_id, snapshotPrediction:immutable.row.prediction, snapshotPredictedPlayer:immutable.row.predicted_player_name, currentPredictionBefore:current.prediction, currentPredictedPlayerBefore:current.predicted_player_name, driftRepaired:String(current.prediction)!==String(immutable.row.prediction)||text(current.predicted_player_name)!==text(immutable.row.predicted_player_name), repairId };
}
function protectNonFinal(db,betId,now,doApply){
  const row=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(betId); if(!row)throw new Error(`NON_FINAL_BET_MISSING:${betId}`);
  const r=truth.resolve(row); if(!r||!r.nonFinal)throw new Error(`NON_FINAL_EVIDENCE_MISSING:${betId}`);
  const retirement=r.lifecycleStatus==='RETIREMENT_REVIEW'||r.requiresBookmakerRule===true;
  const fields={ status:'PENDING', settlement_contract_status:retirement?'MANUAL_REVIEW':'PENDING', settlement_contract_reason:r.lifecycleReason,
    settlement_contract_version:'TENNIS_SETTLEMENT_CONTRACT_V1_PATCH5', settlement_source:r.source, settlement_source_tier:retirement?'MANUAL':'OFFICIAL_NON_FINAL',
    settlement_source_event_id:r.sourceEventId, settlement_winner_name:r.winnerName||null, settlement_score:r.score||null,
    settlement_observed_at:r.observedAt, settlement_confidence:r.confidence, settlement_evidence_hash:r.evidenceHash,
    settlement_note:r.note, settlement_truth_version:truth.VERSION, engine_version:'11.8_PATCH34_R4_SETTLEMENT_TRUTH_SNAPSHOT_AUTHORITY' };
  if(doApply) updateExisting(db,'ai_forward_test',betId,fields);
  return {betId,status:'PENDING',lifecycleStatus:r.lifecycleStatus,reason:r.lifecycleReason,automaticSettlement:false};
}
function counts(db){ return { total:Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n), tennis:Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'").get().n), pending:Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE status='PENDING' AND (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%')").get().n) }; }

if(!fs.existsSync(dbPath)){console.log(JSON.stringify({success:false,code:'DATABASE_NOT_FOUND',dbPath},null,2));process.exit(1);}
const opened=openDb(dbPath); const db=opened.db; let output;
try{
  const beforeCounts=counts(db); const integrity=db.prepare('PRAGMA integrity_check').get(); const fk=db.prepare('PRAGMA foreign_key_check').all();
  if(String(Object.values(integrity||{})[0]).toLowerCase()!=='ok'||fk.length)throw new Error('DATABASE_INTEGRITY_PRECHECK_FAILED');
  const now=new Date().toISOString(); let completed=[],nonFinal=[];
  if(apply) db.exec('BEGIN IMMEDIATE');
  try{
    if(apply){ensureColumns(db);ensureAudit(db);}
    completed=TARGET_COMPLETED.map(id=>repairCompleted(db,id,now,apply));
    nonFinal=TARGET_NON_FINAL.map(id=>protectNonFinal(db,id,now,apply));
    if(apply)db.exec('COMMIT');
  }catch(error){if(apply)try{db.exec('ROLLBACK');}catch(_){} throw error;}
  const afterCounts=counts(db);
  const statusCols=columns(db,'ai_forward_test');
  const statusFields=['id','status','prediction','predicted_player_name','settlement_contract_status'].concat(statusCols.has('settlement_truth_version')?['settlement_truth_version']:[]);
  const statuses=TARGET_COMPLETED.map(id=>db.prepare(`SELECT ${statusFields.join(',')} FROM ai_forward_test WHERE id=?`).get(id));
  output={success:true,patch:PATCH,revision:REVISION,mode:preview?'PREVIEW':'APPLY',adapter:opened.adapter,dbPath,migration:MIGRATION,
    truth:truth.health(),beforeCounts,afterCounts,businessRowCountUnchanged:beforeCounts.total===afterCounts.total,
    targetedCompleted:completed,targetedNonFinal:nonFinal,statuses,auditRows:tableExists(db,AUDIT_TABLE)?Number(db.prepare(`SELECT COUNT(*) n FROM ${AUDIT_TABLE}`).get().n):0,
    immutableSnapshotAuthority:true,mutableAnalysisCannotRewriteForwardTruth:true,retirementAutoSettlement:false,suspensionAutoSettlement:false};
}finally{db.close();}
console.log(JSON.stringify(output,null,2));
