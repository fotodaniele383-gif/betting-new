#!/usr/bin/env node
'use strict';
const fs=require('fs');const os=require('os');const path=require('path');const {DatabaseSync}=require('node:sqlite');
const root=path.resolve('.');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'patch48-r5-ledger-gap-'));const dbPath=path.join(tmp,'database.db');fs.copyFileSync(path.join(root,'backend','database_betting.db'),dbPath);
const db=new DatabaseSync(dbPath);const ledger=require(path.join(root,'backend','tennisClvDegradedLedgerPatch47.js'));
const STATES=Object.values(ledger.STATES);const checks=[];function check(name,ok,details){checks.push({name,ok:Boolean(ok),details});}
function columns(table){return db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name);}
function insertClone(table,row,overrides={}){const cols=columns(table);const rec={...row,...overrides};const names=cols.filter(c=>c!=='id'||rec.id!=null);db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(n=>'@'+n).join(',')})`).run(Object.fromEntries(names.map(n=>[n,rec[n]??null])));}
try{
 ledger.createSchema(db);
 const where=ledger.buildOperationalWhere(db,'a');
 const initial=ledger.getOperationalCoverage(db);
 const victim=db.prepare(`SELECT * FROM ai_forward_test a WHERE ${where} ORDER BY a.id LIMIT 1`).get();if(!victim)throw new Error('NO_OPERATIONAL_ROW');
 db.prepare("UPDATE ai_forward_test SET status='VOID' WHERE id=?").run(victim.id);
 const source=db.prepare("SELECT * FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' ORDER BY id DESC LIMIT 1").get();
 const baseMax=Number(db.prepare('SELECT MAX(id) id FROM ai_forward_test').get().id||0);const created=[];
 for(let i=1;i<=12;i++){
   const id=baseMax+i;const clone={...source,id,status:'PENDING',sport_type:'TENNIS',bet_type:/MULTI/i.test(String(source.bet_type||''))?'TENNIS_ATP_MONEYLINE':(source.bet_type||'TENNIS_ATP_MONEYLINE'),strategy_tag:source.strategy_tag||'TENNIS',paper_result_key:`PATCH48_R5_LEDGER_GAP_${id}`,clv_degraded_ledger_version:null,clv_degraded_state:null,clv_evidence_key:null,clv_evidence_first_seen_at:null,clv_evidence_last_changed_at:null,clv_evidence_seen_count:0,clv_terminal_reason:null,clv_terminal_at:null,clv_retry_eligible:1};
   if('match_name' in clone)clone.match_name=`PATCH48 R5 LEDGER GAP ${id}`;if('event_name' in clone)clone.event_name=`PATCH48 R5 LEDGER GAP ${id}`;
   insertClone('ai_forward_test',clone,{id});created.push(id);
 }
 const before=ledger.getOperationalCoverage(db);
 check('Riprodotto gap operativo di 12 record',before.operationalRows===initial.operationalRows+11&&before.fullyCovered===initial.fullyCovered-1&&before.invalidStates===12&&before.coverageGap===12,{initial,before,exactUserProfile:before.operationalRows===899&&before.fullyCovered===887});
 const first=ledger.reconcileOperationalCoverage(db,{strict:true,source:'PATCH48_R5_EXACT_FAILURE_TEST',now:new Date('2026-08-05T11:08:10.000Z')});
 const after=ledger.getOperationalCoverage(db);
 check('Dodici record riparati',first.success&&first.repaired===12&&created.every(id=>first.repairedBetIds.includes(id)),first);
 check('Copertura completa dopo reconcile',after.operationalRows===before.operationalRows&&after.fullyCovered===after.operationalRows&&after.invalidStates===0&&after.missingLedgerLinks===0,after);
 const second=ledger.reconcileOperationalCoverage(db,{strict:true,source:'PATCH48_R5_IDEMPOTENCY_TEST',now:new Date('2026-08-05T11:09:10.000Z')});
 check('Secondo passaggio idempotente',second.success&&second.repaired===0&&second.ledgerInserted===0&&second.candidates===0,second);
 const linked=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test a WHERE a.id IN (${created.map(()=>'?').join(',')}) AND EXISTS(SELECT 1 FROM tennis_clv_degraded_ledger_patch47 l WHERE l.bet_id=a.id AND l.evidence_key=a.clv_evidence_key AND UPPER(l.degraded_state)=UPPER(a.clv_degraded_state))`).get(...created).n);
 check('Dodici evidenze append-only collegate',linked===12,{linked});
 const success=checks.every(c=>c.ok);console.log(JSON.stringify({success,checks:checks.length,details:checks},null,2));if(!success)process.exitCode=1;
}catch(error){console.log(JSON.stringify({success:false,error:error.stack||error.message,details:checks},null,2));process.exitCode=1;}finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
