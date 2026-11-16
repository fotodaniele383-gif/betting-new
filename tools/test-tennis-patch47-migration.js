#!/usr/bin/env node
'use strict';
const fs=require('fs');const os=require('os');const path=require('path');const {DatabaseSync}=require('node:sqlite');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const migration=require(path.join(root,'backend','migrateTennisPatch47.js'));
const checks=[];function check(name,ok,details=null){checks.push({name,ok:Boolean(ok),details});}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'patch47-migration-'));const dbPath=path.join(dir,'test.db');
try{
 const db=new DatabaseSync(dbPath);
 db.exec(`CREATE TABLE ai_forward_test(
 id INTEGER PRIMARY KEY,status TEXT,stake REAL,odd REAL,estimated_prob REAL,edge_pp REAL,ev_pct REAL,ds_action TEXT,quality_final_code TEXT,
 professional_gate_allow_bet INTEGER,professional_gate_max_stake REAL,clv REAL,clv_edge REAL,closing_odd REAL,opening_odd REAL,clv_verified INTEGER,
 clv_contract_status TEXT,clv_contract_reason TEXT,sport_type TEXT,bet_type TEXT,strategy_tag TEXT,match_date TEXT,prediction TEXT,
 clv_source TEXT,clv_opening_ts INTEGER,clv_closing_ts INTEGER,clv_bookmaker TEXT,clv_source_event_id TEXT,clv_event_fingerprint TEXT,
 clv_market_fingerprint TEXT,clv_point_line REAL,closing_odd_side TEXT,clv_last_attempt_result TEXT,clv_pending_reason TEXT,clv_attempt_count INTEGER,
 clv_next_retry_ts INTEGER,data_quality TEXT,home_team TEXT,away_team TEXT
 );`);
 const insert=db.prepare(`INSERT INTO ai_forward_test(id,status,stake,odd,estimated_prob,edge_pp,ev_pct,ds_action,quality_final_code,professional_gate_allow_bet,professional_gate_max_stake,clv,clv_edge,closing_odd,opening_odd,clv_verified,clv_contract_status,clv_contract_reason,sport_type,bet_type,strategy_tag,match_date,prediction,clv_source,clv_opening_ts,clv_closing_ts,clv_bookmaker,clv_source_event_id,clv_event_fingerprint,clv_market_fingerprint,clv_point_line,closing_odd_side,clv_last_attempt_result,clv_pending_reason,clv_attempt_count,clv_next_retry_ts,data_quality,home_team,away_team) VALUES(${Array(39).fill('?').join(',')})`);
 const base=(id,match)=>[id,'PENDING',2,2,60,5,10,'VALUE','APPROVED',1,2,0,0,null,null,0,null,null,'TENNIS','TENNIS_ATP_MONEYLINE','TENNIS',match,'1',null,null,null,null,null,null,null,null,'1',null,null,0,0,'CURRENT_BOOTSTRAP','A','B'];
 let r=base(1,'05/08/2026, 12:00:00');r[11]=1.8;r[13]=1.8;r[14]=2;r[15]=1;r[16]='VERIFIED';r[17]='CONTRACT_OK';r[23]='LIVE_API';r[24]=Date.parse('2026-08-05T06:00:00Z');r[25]=Date.parse('2026-08-05T07:00:00Z');r[26]='Pinnacle';r[27]='EV1';r[28]='FP1';r[29]='MP1';insert.run(...r);
 r=base(2,'04/08/2026, 12:00:00');r[11]=6.8;r[13]=6.8;r[14]=2;r[16]='AVAILABLE_UNVERIFIED';r[17]='CLOSING_AFTER_MATCH_START';r[23]='POST_MATCH_VAULT';insert.run(...r);
 r=base(3,'20/07/2026, 12:00:00');r[33]='CLV_VAULT_NO_SNAPSHOT';insert.run(...r);
 r=base(4,'05/08/2026, 15:00:00');r[33]='CLV_VAULT_NO_SNAPSHOT';insert.run(...r);
 r=base(5,'05/08/2026, 16:00:00');r[32]='CLV_MAX_ATTEMPTS_PER_MATCH_REACHED';r[34]=2;insert.run(...r);
 db.close();
 const now=new Date('2026-08-05T07:20:00Z');
 const first=migration.migrate({dbPath,apply:true,now});
 check('Prima migrazione riuscita',first.success===true,first);
 check('Valori business invariati',first.businessValuesUnchanged===true&&first.noStakeChange&&first.noClvValueRewrite,first);
 check('Cinque righe semantiche e ledger',first.updatedSemanticRows===5&&first.insertedLedgerRows===5,first);
 const db2=new DatabaseSync(dbPath);
 const states=Object.fromEntries(db2.prepare('SELECT id,clv_degraded_state FROM ai_forward_test ORDER BY id').all().map(x=>[Number(x.id),x.clv_degraded_state]));
 check('Classificazioni attese',states[1]==='VERIFIED'&&states[2]==='IRRECOVERABLE_TEMPORAL'&&states[3]==='IRRECOVERABLE_MARKET'&&states[4]==='RETRY_ELIGIBLE'&&states[5]==='MAX_ATTEMPTS_EXHAUSTED',states);
 const ledgerBefore=Number(db2.prepare('SELECT COUNT(*) n FROM tennis_clv_degraded_ledger_patch47').get().n);db2.close();
 const second=migration.migrate({dbPath,apply:true,now});
 check('Seconda migrazione idempotente',second.updatedSemanticRows===0&&second.insertedLedgerRows===0&&second.reusedLedgerRows===5,second);
 const db3=new DatabaseSync(dbPath);const ledgerAfter=Number(db3.prepare('SELECT COUNT(*) n FROM tennis_clv_degraded_ledger_patch47').get().n);
 check('Ledger non duplicato',ledgerBefore===5&&ledgerAfter===5,{ledgerBefore,ledgerAfter});
 let updateBlocked=false,deleteBlocked=false;try{db3.exec("UPDATE tennis_clv_degraded_ledger_patch47 SET degraded_state='X' WHERE id=1");}catch(e){updateBlocked=/APPEND_ONLY/.test(e.message);}try{db3.exec('DELETE FROM tennis_clv_degraded_ledger_patch47 WHERE id=1');}catch(e){deleteBlocked=/APPEND_ONLY/.test(e.message);}db3.close();
 check('Ledger append-only protetto',updateBlocked&&deleteBlocked,{updateBlocked,deleteBlocked});
}catch(error){checks.push({name:'Eccezione suite',ok:false,details:error.stack||error.message});}
finally{fs.rmSync(dir,{recursive:true,force:true});}
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_47_CLV_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE_TERMINAL_STATES',suite:'PATCH47_MIGRATION_IDEMPOTENCY',checks:checks.length,details:checks,failures:failed},null,2));if(failed.length)process.exit(1);
