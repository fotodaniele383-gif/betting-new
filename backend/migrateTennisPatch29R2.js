#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const official = require('./tennisOfficialSettlementResolver');
const contract = require('./tennisSettlementContract');
const lifecycle = require('./tennisForwardLifecycle');
const cohorts = require('./tennisForwardCohorts');
const performance = require('./tennisHistoricalValidationPerformance');

const PATCH = 'TENNIS_PATCH_29_R2_SETTLEMENT_UPDATE_AUDIT_RUNTIME_TRUTH';
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dbArg = process.argv.find(arg => /database_betting\.db$/i.test(arg));
const dbPath = path.resolve(dbArg || path.join(__dirname, 'database_betting.db'));

function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');}
function rowsHash(db,sql){return hash(db.prepare(sql).all());}
function isTennis(r={}){return /TENNIS|ATP|WTA/i.test([r.sport_type,r.league,r.bet_type,r.strategy_tag].filter(Boolean).join(' '));}
function manualFields(row,resolution,reason,operationId){
  const fields=contract.buildSettlementContractFields(row,resolution,{operationId});
  return {
    status:'PENDING', profit:null, settled_at:null, total_games:null, winner_side:null, winner_player_name:null,
    settlement_source:resolution.source, settlement_note:`${resolution.note||''} Patch 29 R2: revisione manuale protetta; nessun settlement automatico.`.trim(),
    settlement_contract_status:'MANUAL_REVIEW', settlement_contract_reason:reason,
    settlement_contract_version:fields.settlement_contract_version,
    settlement_source_event_id:fields.settlement_source_event_id,
    settlement_winner_name:fields.settlement_winner_name,
    settlement_score:fields.settlement_score,
    settlement_observed_at:fields.settlement_observed_at,
    settlement_confidence:fields.settlement_confidence,
    settlement_evidence_hash:fields.settlement_evidence_hash,
    settlement_event_fingerprint:fields.settlement_event_fingerprint,
    settlement_market_fingerprint:fields.settlement_market_fingerprint,
    settlement_operation_id:operationId,
    settlement_source_tier:'MANUAL'
  };
}
function updateRow(db,id,fields){const entries=Object.entries(fields);const sql=`UPDATE ai_forward_test SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`;const r=db.prepare(sql).run(...entries.map(([,v])=>v),id);if(Number(r.changes||0)!==1)throw new Error(`PATCH29_R2_UPDATE_EXPECTED_ONE_ROW:${id}:${r.changes}`);}

const db=new DatabaseSync(dbPath);
db.transaction=fn=>(...a)=>{if(db.inTransaction)return fn(...a);db.exec('BEGIN IMMEDIATE');try{const x=fn(...a);db.exec('COMMIT');return x}catch(e){try{db.exec('ROLLBACK')}catch{}throw e}};
try{
  const operationId=`TENNIS_PATCH29_R2_REPAIR_${Date.now()}`;
  const immutableSql=`SELECT id,match_date,home_team,away_team,prediction,odd,estimated_prob,stake,professional_gate_status,tennis_operational_status,gate_status_code,provider_event_id,tennis_event_fingerprint,tennis_market_fingerprint,clv_contract_status,clv FROM ai_forward_test ORDER BY id`;
  const clvSql=`SELECT id,clv,clv_contract_status,clv_source_event_id,clv_event_fingerprint FROM ai_forward_test ORDER BY id`;
  const immutableBefore=rowsHash(db,immutableSql),clvBefore=rowsHash(db,clvSql);
  const rows=db.prepare(`SELECT * FROM ai_forward_test WHERE COALESCE(paper_result_active,1)=1 ORDER BY id`).all().filter(isTennis);
  const retirement=[],identity=[];
  for(const row of rows){
    const ret=official.resolveRetirementEvidence(row);
    if(ret) retirement.push({row,resolution:ret,reason:'OFFICIAL_RETIREMENT_BOOKMAKER_RULE_REQUIRED'});
    const res=official.resolveFromSeed(row); if(!res) continue;
    const fields=contract.buildSettlementContractFields(row,res,{operationId});
    const cohort=db.prepare('SELECT event_fingerprint,market_fingerprint FROM tennis_forward_cohort_members WHERE bet_id=?').get(row.id)||null;
    if(!cohort)continue;
    const eventMismatch=Boolean(cohort.event_fingerprint&&fields.settlement_event_fingerprint&&cohort.event_fingerprint!==fields.settlement_event_fingerprint);
    const marketMismatch=Boolean(cohort.market_fingerprint&&fields.settlement_market_fingerprint&&cohort.market_fingerprint!==fields.settlement_market_fingerprint);
    if(eventMismatch||marketMismatch) identity.push({row,resolution:res,fields,cohort,reason:marketMismatch?'OFFICIAL_EVENT_MARKET_FINGERPRINT_MISMATCH':'OFFICIAL_EVENT_FINGERPRINT_MISMATCH'});
  }
  const repairs=[];
  if(apply){
    db.transaction(()=>{
      for(const item of retirement){updateRow(db,item.row.id,manualFields(item.row,item.resolution,item.reason,operationId));repairs.push({betId:item.row.id,type:'RETIREMENT_MANUAL_REVIEW',reason:item.reason});}
      for(const item of identity){updateRow(db,item.row.id,manualFields(item.row,item.resolution,item.reason,operationId));repairs.push({betId:item.row.id,type:'IDENTITY_MANUAL_REVIEW',reason:item.reason,cohortMarketFingerprint:item.cohort.market_fingerprint,evidenceMarketFingerprint:item.fields.settlement_market_fingerprint});}
    })();
  }
  const lifecycleResult=apply?lifecycle.reconcileForwardLifecycle(db,{apply:true,operationId}):null;
  const cohortResult=apply?cohorts.reconcileForwardCohortMaturity(db,{operationId,limit:100000}):null;
  const forward=apply?performance.refreshForwardPerformance(db,{persist:true,includeEvaluations:true,generatedAt:new Date().toISOString()}):null;
  const immutableAfter=rowsHash(db,immutableSql),clvAfter=rowsHash(db,clvSql);
  const protectedRows=db.prepare(`SELECT id,status,profit,settled_at,total_games,winner_side,winner_player_name,settlement_source,settlement_contract_status,settlement_contract_reason,settlement_score,settlement_source_tier FROM ai_forward_test WHERE id IN (${[...new Set([...retirement,...identity].map(x=>x.row.id))].join(',')||'0'}) ORDER BY id`).all();
  const output={success:immutableBefore===immutableAfter&&clvBefore===clvAfter,patch:PATCH,mode:apply?'APPLY_PROTECTED_MANUAL_REVIEW_REPAIR':'READ_ONLY_PREVIEW',operationId,
    detected:{retirement:retirement.map(x=>({betId:x.row.id,statusBefore:x.row.status,contractBefore:x.row.settlement_contract_status,reason:x.reason,score:x.resolution.score})),identity:identity.map(x=>({betId:x.row.id,statusBefore:x.row.status,contractBefore:x.row.settlement_contract_status,reason:x.reason,cohortMarketFingerprint:x.cohort.market_fingerprint,evidenceMarketFingerprint:x.fields.settlement_market_fingerprint}))},
    repairs,protectedRows,lifecycle:lifecycleResult?{success:lifecycleResult.success,repaired:lifecycleResult.repaired,failed:lifecycleResult.failed}:null,
    cohorts:cohortResult?{scanned:cohortResult.scanned,updated:cohortResult.updated,unchanged:cohortResult.unchanged,blocked:cohortResult.blocked,errors:cohortResult.errors}:null,
    forwardPerformance:forward?{eligibleRows:forward.eligibleRows,coveredRows:forward.coveredRows,coveragePct:forward.coveragePct,metrics:forward.metrics,performanceGate:forward.performanceGate}:null,
    safeguards:{immutablePredictionFieldsUnchanged:immutableBefore===immutableAfter,clvFieldsUnchanged:clvBefore===clvAfter,retirementAutoSettlement:false,identityMismatchAutoSettlement:false,probabilityAuthorityChanged:false,qualityGateAuthorityChanged:false,stakeAuthorityChanged:false,oddsApiCallsAdded:0}};
  console.log(JSON.stringify(output,null,2));process.exitCode=output.success?0:1;
}finally{db.close();}
