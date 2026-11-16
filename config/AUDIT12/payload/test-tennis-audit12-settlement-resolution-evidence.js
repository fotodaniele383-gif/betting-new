#!/usr/bin/env node
'use strict';
const assert=require('assert');
const path=require('path');
const {DatabaseSync}=require('node:sqlite');
const i=process.argv.indexOf('--root');
const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const gate=require(path.join(root,'backend','settlementResolutionEvidenceGateAudit12'));
const queue=require(path.join(root,'backend','tennisSettlementExceptionQueuePatch51'));
let checks=0;const check=(name,fn)=>{fn();checks++;};
const baseRow={
  id:1,status:'WON',sport_type:'TENNIS',canonical_match_datetime:'2026-09-20T12:00:00.000Z',match_date:'2026-09-20T12:00:00.000Z',
  settlement_contract_status:'VERIFIED',settlement_contract_reason:'CONTRACT_OK',settlement_source:'OFFICIAL_PROVIDER',settlement_source_tier:'PROVIDER',
  settlement_source_event_id:'OFF-1',settlement_observed_at:'2026-09-20T14:00:00.000Z',settled_at:'2026-09-20T14:01:00.000Z',
  settlement_evidence_hash:'a'.repeat(64),settlement_operation_id:'OP-1',
  tennis_event_fingerprint:'EV1',tennis_market_fingerprint:'MK1',settlement_event_fingerprint:'EV1',settlement_market_fingerprint:'MK1'
};
const baseQueue={bet_id:1,status:'OPEN',exception_type:'WEAK_SOURCE_RECOVERY',recovery_mode:'TARGETED_OFFICIAL_RESULT',manual_action_required:0,evidence_key:'old'};
check('health',()=>assert.equal(gate.health().healthy,true));
check('provider evidence accepted',()=>assert.equal(gate.evaluateResolutionEvidence(baseRow,baseQueue,{operationId:'OP-1'}).ready,true));
check('certified tier accepted',()=>assert.equal(gate.evaluateResolutionEvidence({...baseRow,settlement_source_tier:'CERTIFIED'},baseQueue,{operationId:'OP-1'}).ready,true));
check('structured web rejected',()=>assert(gate.evaluateResolutionEvidence({...baseRow,settlement_source_tier:'STRUCTURED_WEB'},baseQueue,{operationId:'OP-1'}).reasons.includes('SOURCE_TIER_NOT_OFFICIAL')));
check('manual exception rejected',()=>assert(gate.evaluateResolutionEvidence(baseRow,{...baseQueue,manual_action_required:1,recovery_mode:'MANUAL_CONTRACT_REVIEW'},{operationId:'OP-1'}).reasons.includes('MANUAL_ACTION_REQUIRED')));
check('fingerprint mismatch rejected',()=>assert(gate.evaluateResolutionEvidence({...baseRow,settlement_market_fingerprint:'OTHER'},baseQueue,{operationId:'OP-1'}).reasons.includes('MARKET_FINGERPRINT_MISMATCH')));
check('evidence before event rejected',()=>assert(gate.evaluateResolutionEvidence({...baseRow,settlement_observed_at:'2026-09-20T11:59:00.000Z'},baseQueue,{operationId:'OP-1'}).reasons.includes('EVIDENCE_BEFORE_EVENT_START')));
check('operation mismatch rejected',()=>assert(gate.evaluateResolutionEvidence({...baseRow,settlement_operation_id:'OTHER'},baseQueue,{operationId:'OP-1'}).reasons.includes('SETTLEMENT_OPERATION_ID_MISMATCH')));
check('weak source rejected',()=>assert(gate.evaluateResolutionEvidence({...baseRow,settlement_source:'STEP58_WEB_FALLBACK',settlement_source_tier:'PROVIDER'},baseQueue,{operationId:'OP-1'}).reasons.includes('SETTLEMENT_SOURCE_NOT_OFFICIAL')));

const db=new DatabaseSync(':memory:');
db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE ai_forward_test(
 id INTEGER PRIMARY KEY,status TEXT,sport_type TEXT,canonical_match_datetime TEXT,match_date TEXT,home_team TEXT,away_team TEXT,league TEXT,
 settlement_contract_status TEXT,settlement_contract_reason TEXT,settlement_source TEXT,settlement_source_tier TEXT,settlement_source_event_id TEXT,
 settlement_winner_name TEXT,settlement_score TEXT,settlement_observed_at TEXT,settled_at TEXT,settlement_evidence_hash TEXT,settlement_operation_id TEXT,
 settlement_event_fingerprint TEXT,settlement_market_fingerprint TEXT,tennis_event_fingerprint TEXT,tennis_market_fingerprint TEXT
);`);
queue.ensureSchema(db);
db.prepare(`INSERT INTO ai_forward_test(id,status,sport_type,canonical_match_datetime,match_date,home_team,away_team,league,settlement_contract_status,settlement_contract_reason,settlement_source,settlement_source_tier,settlement_source_event_id,settlement_score,tennis_event_fingerprint,tennis_market_fingerprint) VALUES(1,'PENDING','TENNIS','2026-09-20T12:00:00.000Z','2026-09-20T12:00:00.000Z','A','B','ATP','PROPOSED','SOURCE_TIER_WEAK_WEB_REQUIRES_REVIEW','STEP58_WEB_FALLBACK','WEAK_WEB','WEAK-1','6-4 6-4','EV1','MK1')`).run();
queue.seedCurrentExceptions(db,{operationId:'SEED'});
const first=queue.resolveException(db,1,{operationId:'OP-1'});
check('queue blocks weak evidence',()=>assert.equal(first.action,queue.ACTIONS.RESOLUTION_BLOCKED));
check('blocked attempt append-only event',()=>assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${queue.EVENTS_TABLE} WHERE event_type='RESOLUTION_BLOCKED'`).get().c,1));
db.prepare(`UPDATE ai_forward_test SET status='WON',settlement_contract_status='VERIFIED',settlement_contract_reason='CONTRACT_OK',settlement_source='OFFICIAL_PROVIDER',settlement_source_tier='PROVIDER',settlement_source_event_id='OFF-1',settlement_observed_at='2026-09-20T14:00:00.000Z',settled_at='2026-09-20T14:01:00.000Z',settlement_evidence_hash=?,settlement_operation_id='OP-1',settlement_event_fingerprint='EV1',settlement_market_fingerprint='MK1' WHERE id=1`).run('b'.repeat(64));
const second=queue.resolveException(db,1,{operationId:'OP-1'});
check('official evidence resolves',()=>assert.equal(second.action,queue.ACTIONS.RESOLVED));
check('resolved row proof matches',()=>assert.equal(db.prepare(`SELECT evidence_key FROM ${queue.TABLE} WHERE bet_id=1`).get().evidence_key,second.resolutionGate.resolutionEvidenceHash));
check('resolved event contains policy',()=>{const r=db.prepare(`SELECT payload_json FROM ${queue.EVENTS_TABLE} WHERE bet_id=1 AND event_type='RESOLVED' ORDER BY id DESC LIMIT 1`).get();const p=JSON.parse(r.payload_json);assert.equal(p.resolutionPolicyVersion,gate.POLICY_VERSION);assert.equal(p.resolutionGate.ready,true);});
check('integrity',()=>assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok'));
console.log(JSON.stringify({success:true,patch:'AUDIT12',checks,gateVersion:gate.VERSION,queueResolutionPolicy:queue.getSummary(db).resolutionPolicyVersion},null,2));
