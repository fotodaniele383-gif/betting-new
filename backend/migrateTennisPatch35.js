#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const authority = require('./tennisStakeAuthorityPatch35');

const PATCH = 'TENNIS_PATCH_35_CLV_SPORT_DISCOVERY_FINAL_STAKE_SMALL_SAMPLE_GUARD';
const REVISION = 'R1_WINDOWS_NODE_CLV_SPORT_DISCOVERY_FINAL_STAKE_SMALL_SAMPLE_GUARD';
const MIGRATION = 'ADDITIVE_CLV_DISCOVERY_AND_FINAL_STAKE_AUTHORITY_WITH_TARGETED_PENDING_RECONCILE';
const AUDIT_TABLE = 'tennis_stake_authority_decisions';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const preview = args.includes('--preview') || !apply;
const dbArg = args.find(v => /\.db$/i.test(v));
const dbPath = path.resolve(process.cwd(), dbArg || 'backend/database_betting.db');

function openDb(file){
  try { const Better=require('better-sqlite3'); return {db:new Better(file),adapter:'better-sqlite3'}; }
  catch(_){ const {DatabaseSync}=require('node:sqlite'); return {db:new DatabaseSync(file),adapter:'node:sqlite'}; }
}
function colset(db,t){return new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(r=>r.name));}
function add(db,def){const name=def.split(/\s+/)[0];if(!colset(db,'ai_forward_test').has(name))db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${def}`);}
function table(db,n){return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(n));}
function sha(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function ensureSchema(db){
  [
    'tennis_stake_authority_version TEXT','tennis_stake_authority_status TEXT','tennis_stake_authority_proposed_stake REAL','tennis_stake_authority_final_stake REAL','tennis_stake_authority_sample INTEGER','tennis_stake_authority_reliability TEXT','tennis_stake_authority_reason TEXT','tennis_stake_authority_decided_at TEXT',
    'clv_sport_key_discovery_version TEXT','clv_sport_key_discovery_status TEXT','clv_sport_key_requested TEXT','clv_sport_key_resolved TEXT','clv_provider_error_code TEXT','clv_provider_error_at TEXT'
  ].forEach(def=>add(db,def));
  db.exec(`CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE}(
    decision_id TEXT PRIMARY KEY,
    bet_id INTEGER NOT NULL,
    decided_at TEXT NOT NULL,
    authority_version TEXT NOT NULL,
    status TEXT NOT NULL,
    sample INTEGER NOT NULL,
    reliability TEXT,
    proposed_stake REAL NOT NULL,
    final_stake REAL NOT NULL,
    reason TEXT NOT NULL,
    before_hash TEXT NOT NULL,
    after_hash TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    UNIQUE(bet_id,authority_version)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${AUDIT_TABLE}_bet ON ${AUDIT_TABLE}(bet_id,decided_at)`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${AUDIT_TABLE}_no_update BEFORE UPDATE ON ${AUDIT_TABLE} BEGIN SELECT RAISE(ABORT,'${AUDIT_TABLE} append-only'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${AUDIT_TABLE}_no_delete BEFORE DELETE ON ${AUDIT_TABLE} BEGIN SELECT RAISE(ABORT,'${AUDIT_TABLE} append-only'); END;`);
}
function isTennisWhere(){return `(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')`;}
function counts(db){return {total:Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n),tennis:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${isTennisWhere()}`).get().n),pending:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${isTennisWhere()}`).get().n),positiveStake:Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${isTennisWhere()} AND COALESCE(stake,0)>0`).get().n),stakeTotal:Number(db.prepare(`SELECT ROUND(COALESCE(SUM(stake),0),2) n FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${isTennisWhere()}`).get().n)};}
function rowState(r){return {id:r.id,stake:Number(r.stake||0),professional_gate_allow_bet:r.professional_gate_allow_bet,professional_gate_max_stake:r.professional_gate_max_stake,tennis_operational_status:r.tennis_operational_status,tennis_operational_action:r.tennis_operational_action,trading_scope:r.trading_scope,paper_trading_scope:r.paper_trading_scope,portfolio_scope:r.portfolio_scope,authorityStatus:r.tennis_stake_authority_status,authorityFinal:r.tennis_stake_authority_final_stake};}
function runDecision(db,row,now,doApply){
  if (row.tennis_stake_authority_version === authority.VERSION && table(db,AUDIT_TABLE)) {
    const audit=db.prepare(`SELECT status,sample,reliability,proposed_stake,final_stake,reason FROM ${AUDIT_TABLE} WHERE bet_id=? AND authority_version=?`).get(row.id,authority.VERSION);
    if (audit) return {betId:row.id,match:`${row.home_team} - ${row.away_team}`,beforeStake:Number(audit.proposed_stake||0),afterStake:Number(audit.final_stake||0),status:audit.status,sample:Number(audit.sample||0),reliability:audit.reliability,changed:false,reason:audit.reason,idempotent:true};
  }
  const decision=authority.decide({
    proposedStake:row.stake,
    qualityCode:row.quality_final_code,
    qualityLabel:row.quality_final_label,
    professionalGateStatus:row.professional_gate_status,
    operationalStatus:row.tennis_operational_status,
    operationalAction:row.tennis_operational_action,
    historicalEvidence:{resolved:row.historical_combo_resolved,reliability:row.historical_combo_reliability,operationalRoiPct:row.historical_combo_operational_roi_pct},
    pre_match_historical_sample:row.pre_match_historical_sample
  });
  const before=rowState(row);
  const after={...before,stake:decision.finalStake,professional_gate_allow_bet:decision.finalStake>0?1:0,professional_gate_max_stake:decision.finalStake,tennis_operational_status:`STAKE_AUTHORITY_${decision.status}`,tennis_operational_action:decision.finalStake>0?'FINAL_STAKE_AUTHORIZED':'PAPER_ONLY_NO_OPERATIONAL_STAKE',trading_scope:decision.finalStake>0?'PAPER_OPERATIONAL':'AUDIT_ONLY',paper_trading_scope:decision.finalStake>0?'PAPER_OPERATIONAL':'AUDIT_ONLY',portfolio_scope:'EXCLUDED_FROM_REAL_PORTFOLIO',authorityStatus:decision.status,authorityFinal:decision.finalStake};
  const decisionId=`TSA35_${row.id}_${sha([authority.VERSION,decision.status,decision.sample,before.stake,after.stake]).slice(0,18)}`;
  if(doApply){
    const fields=authority.toPersistenceFields(decision,now);
    db.prepare(`UPDATE ai_forward_test SET
      stake=?, professional_gate_allow_bet=?, professional_gate_max_stake=?,
      tennis_operational_status=?, tennis_operational_action=?, tennis_operational_summary=?, stake_policy_note=?,
      trading_scope=?, paper_trading_scope=?, portfolio_scope=?, audit_scope_reason=?,
      tennis_stake_authority_version=?, tennis_stake_authority_status=?, tennis_stake_authority_proposed_stake=?, tennis_stake_authority_final_stake=?,
      tennis_stake_authority_sample=?, tennis_stake_authority_reliability=?, tennis_stake_authority_reason=?, tennis_stake_authority_decided_at=?
      WHERE id=?`).run(
        decision.finalStake,decision.finalStake>0?1:0,decision.finalStake,
        after.tennis_operational_status,after.tennis_operational_action,decision.reason,`Patch35 ${decision.status}: ${decision.reason}`,
        after.trading_scope,after.paper_trading_scope,after.portfolio_scope,decision.reason,
        fields.tennis_stake_authority_version,fields.tennis_stake_authority_status,fields.tennis_stake_authority_proposed_stake,fields.tennis_stake_authority_final_stake,
        fields.tennis_stake_authority_sample,fields.tennis_stake_authority_reliability,fields.tennis_stake_authority_reason,fields.tennis_stake_authority_decided_at,row.id
      );
    if(!db.prepare(`SELECT 1 ok FROM ${AUDIT_TABLE} WHERE bet_id=? AND authority_version=?`).get(row.id,authority.VERSION)){
      db.prepare(`INSERT INTO ${AUDIT_TABLE}(decision_id,bet_id,decided_at,authority_version,status,sample,reliability,proposed_stake,final_stake,reason,before_hash,after_hash,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(decisionId,row.id,now,authority.VERSION,decision.status,decision.sample,decision.reliability,decision.proposedStake,decision.finalStake,decision.reason,sha(before),sha(after),JSON.stringify(before),JSON.stringify(after));
    }
  }
  return {betId:row.id,match:`${row.home_team} - ${row.away_team}`,beforeStake:before.stake,afterStake:decision.finalStake,status:decision.status,sample:decision.sample,reliability:decision.reliability,changed:before.stake!==decision.finalStake,reason:decision.reason};
}

const opened=openDb(dbPath);const db=opened.db;let out;
try{
  const integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];const fk=db.prepare('PRAGMA foreign_key_check').all();if(String(integrity).toLowerCase()!=='ok'||fk.length)throw new Error('DATABASE_INTEGRITY_PRECHECK_FAILED');
  const before=counts(db);const rows=db.prepare(`SELECT * FROM ai_forward_test WHERE UPPER(status)='PENDING' AND ${isTennisWhere()} ORDER BY id`).all();const now=new Date().toISOString();let decisions=[];
  if(apply)db.exec('BEGIN IMMEDIATE');
  try{if(apply)ensureSchema(db);decisions=rows.map(r=>runDecision(db,r,now,apply));if(apply)db.exec('COMMIT');}catch(e){if(apply)try{db.exec('ROLLBACK');}catch(_){}throw e;}
  const after=counts(db);const changed=decisions.filter(d=>d.changed);const zeroed=changed.filter(d=>d.afterStake===0);const capped=changed.filter(d=>d.afterStake>0);
  out={success:true,patch:PATCH,revision:REVISION,mode:preview?'PREVIEW':'APPLY',adapter:opened.adapter,dbPath,migration:MIGRATION,before,after,businessRowCountUnchanged:before.total===after.total,decisions:decisions.length,changedStakeRows:changed.length,zeroedSmallSampleRows:zeroed.length,cappedRows:capped.length,changed,authority:authority.health(),auditRows:table(db,AUDIT_TABLE)?Number(db.prepare(`SELECT COUNT(*) n FROM ${AUDIT_TABLE}`).get().n):0,clvDiscoveryColumnsAdded:apply,foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all().length,integrity:Object.values(db.prepare('PRAGMA integrity_check').get())[0]};
}finally{db.close();}
console.log(JSON.stringify(out,null,2));
