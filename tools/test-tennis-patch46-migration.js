#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const cp=require('child_process');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tp46-migration-'));
const dbPath=path.join(tmp,'test.db');
const db=new DatabaseSync(dbPath);
db.exec(`CREATE TABLE ai_forward_test(
 id INTEGER PRIMARY KEY,status TEXT,sport_type TEXT,bet_type TEXT,strategy_tag TEXT,stake REAL,estimated_prob REAL,edge_pp REAL,ev_pct REAL,ds_action TEXT,
 quality_final_code TEXT,quality_final_label TEXT,quality_final_score REAL,quality_final_reason TEXT,quality_stake_amount REAL,professional_gate_allow_bet INTEGER,professional_gate_max_stake REAL,
 tennis_stake_authority_version TEXT,tennis_stake_authority_status TEXT,tennis_stake_authority_proposed_stake REAL,tennis_stake_authority_final_stake REAL,tennis_stake_authority_reason TEXT,tennis_stake_authority_decided_at TEXT,
 tennis_risk_authority_version TEXT,tennis_risk_authority_status TEXT,tennis_risk_authority_reason TEXT,tennis_risk_authority_circuit_breaker INTEGER,
 tennis_probability_guard_version TEXT,tennis_probability_guard_status TEXT,tennis_probability_guard_stake_cap REAL,tennis_probability_guard_reason TEXT,tennis_probability_guard_decided_at TEXT,
 stake_policy_note TEXT,stake_base_before_deepscan REAL
)`);
function insert(row){const keys=Object.keys(row);db.prepare(`INSERT INTO ai_forward_test(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}
const common={status:'PENDING',sport_type:'TENNIS',strategy_tag:'TENNIS',estimated_prob:68,edge_pp:8,ev_pct:15,ds_action:'VALUE CONFERMATO',quality_final_code:'APPROVED_WITH_CAP',quality_final_label:'APPROVATA CON CAP',quality_final_score:88,quality_final_reason:'ok',professional_gate_allow_bet:1,tennis_stake_authority_version:'P35',tennis_stake_authority_decided_at:'2026-08-04T15:00:00Z',tennis_risk_authority_version:'P36',tennis_probability_guard_version:'P39',tennis_probability_guard_status:'PASS',tennis_probability_guard_reason:'pass',tennis_probability_guard_decided_at:'2026-08-04T15:00:00Z',stake_policy_note:'note'};
insert({...common,id:1,bet_type:'TENNIS_ATP_MONEYLINE',stake:2,quality_stake_amount:3,professional_gate_max_stake:2,tennis_stake_authority_status:'AUTHORIZED_MICRO_SAMPLE_CAP',tennis_stake_authority_proposed_stake:3,tennis_stake_authority_final_stake:2,tennis_stake_authority_reason:'cap',tennis_risk_authority_status:'AUTHORIZED_MICRO_SAMPLE_CAP',tennis_risk_authority_reason:'cap',tennis_risk_authority_circuit_breaker:0,tennis_probability_guard_stake_cap:2,stake_base_before_deepscan:3});
insert({...common,id:2,bet_type:'TENNIS_WTA_MONEYLINE',stake:0,quality_stake_amount:2,professional_gate_max_stake:0,tennis_stake_authority_status:'PAPER_ONLY_WTA_TECHNICAL_DATA_STALE',tennis_stake_authority_proposed_stake:2,tennis_stake_authority_final_stake:0,tennis_stake_authority_reason:'stale',tennis_risk_authority_status:'PAPER_ONLY_WTA_TECHNICAL_DATA_STALE',tennis_risk_authority_reason:'stale',tennis_risk_authority_circuit_breaker:1,tennis_probability_guard_stake_cap:0,stake_base_before_deepscan:2});
insert({...common,id:3,status:'WON',bet_type:'TENNIS_ATP_MONEYLINE',stake:4,quality_stake_amount:4,professional_gate_max_stake:4,tennis_stake_authority_status:'AUTHORIZED_STANDARD',tennis_stake_authority_proposed_stake:4,tennis_stake_authority_final_stake:4,tennis_stake_authority_reason:'ok',tennis_risk_authority_status:'AUTHORIZED_STANDARD',tennis_risk_authority_reason:'ok',tennis_risk_authority_circuit_breaker:0,tennis_probability_guard_stake_cap:4,stake_base_before_deepscan:4});
insert({id:4,status:'PENDING',sport_type:'CALCIO',bet_type:'1X2',strategy_tag:'CALCIO',stake:10,estimated_prob:60,edge_pp:4,ev_pct:8,ds_action:'',quality_final_code:'APPROVED',quality_final_label:'APPROVATA',quality_final_score:70,quality_final_reason:'ok',quality_stake_amount:10,professional_gate_allow_bet:1,professional_gate_max_stake:10});
db.close();
const run=cp.spawnSync(process.execPath,[path.join(root,'backend/migrateTennisPatch46.js'),'--apply',dbPath],{cwd:root,encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}});
assert.equal(run.status,0,run.stderr||run.stdout);
const out=JSON.parse(run.stdout);let checks=0;function c(name,fn){fn();checks+=1;}
c('migration success',()=>assert.equal(out.success,true));
c('business unchanged',()=>assert.equal(out.businessValuesUnchanged,true));
c('row counts unchanged',()=>assert.equal(out.rowCountsUnchanged,true));
c('pending contracts planned',()=>assert.equal(out.plannedContracts,2));
c('snapshots inserted',()=>assert.equal(out.insertedSnapshots,2));
const verify=new DatabaseSync(dbPath);
c('semantic columns',()=>{const names=new Set(verify.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));['tennis_stake_final_execution_status','tennis_stake_final_executable','tennis_stake_final_authority','tennis_stake_contract_hash'].forEach(n=>assert(names.has(n)));});
c('ATP executable micro',()=>assert.equal(verify.prepare('SELECT tennis_stake_final_execution_status s FROM ai_forward_test WHERE id=1').get().s,'EXECUTABLE_MICRO_STAKE'));
c('WTA paper only',()=>assert.equal(verify.prepare('SELECT tennis_stake_final_execution_status s FROM ai_forward_test WHERE id=2').get().s,'PAPER_ONLY_RISK_GUARD'));
c('closed row not backfilled',()=>assert.equal(verify.prepare('SELECT tennis_stake_contract_version v FROM ai_forward_test WHERE id=3').get().v,null));
c('calcio untouched',()=>assert.equal(verify.prepare('SELECT tennis_stake_contract_version v FROM ai_forward_test WHERE id=4').get().v,null));
c('snapshot append only',()=>assert.throws(()=>verify.prepare('DELETE FROM tennis_stake_execution_contracts_patch46').run(),/TENNIS_PATCH46_STAKE_CONTRACT_APPEND_ONLY/));
verify.close();fs.rmSync(tmp,{recursive:true,force:true});
console.log(JSON.stringify({success:true,patch:'46',checks},null,2));
