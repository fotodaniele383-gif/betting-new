#!/usr/bin/env node
'use strict';
const path=require('path');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const m=require(path.join(ROOT,'backend','calcioSettlementDebtAudit16dR3'));
const checks=[];const add=(n,o,d=null)=>checks.push({name:n,ok:Boolean(o),details:d});
let db;
try{
  db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ai_forward_test (
    id INTEGER PRIMARY KEY, home_team TEXT, away_team TEXT, match_date TEXT, status TEXT,
    stake REAL, prediction TEXT, settlement_source TEXT, settlement_evidence_hash TEXT,
    settlement_source_event_id TEXT, data_quality TEXT, sport_type TEXT
  )`);
  const ins=db.prepare(`INSERT INTO ai_forward_test
    (id,home_team,away_team,match_date,status,stake,prediction,settlement_source,settlement_evidence_hash,settlement_source_event_id,data_quality,sport_type)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  ins.run(1,'Old Home','Old Away','2026-09-23T10:00:00Z','PENDING',0,'HOME',null,null,null,'CURRENT_BOOTSTRAP','CALCIO');
  ins.run(2,'Future Home','Future Away','2026-09-26T10:00:00Z','PENDING',0,'HOME',null,null,null,'CURRENT_BOOTSTRAP','CALCIO');
  ins.run(3,'Old Real','Old Away','2026-09-23T09:00:00Z','PENDING',5,'HOME','OFFICIAL','abc','evt3','CURRENT_BOOTSTRAP','CALCIO');
  ins.run(4,'Tennis Old','Tennis Away','2026-09-20T09:00:00Z','PENDING',10,'HOME',null,null,null,'CURRENT_BOOTSTRAP','TENNIS');
  const before=db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
  const out=m.buildReport(db,{now:new Date('2026-09-25T13:00:00Z'),staleHours:24});
  const after=db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
  add('Version',m.VERSION==='AUDIT16D_R3_CALCIO_SETTLEMENT_DEBT_AUDIT_V1');
  add('Only stale Calcio PENDING counted',out.pendingCalcio===3&&out.stalePending===2,out);
  add('Real-stake stale surfaced',out.realStakeStalePending===1,out);
  add('Existing certified evidence surfaced',out.evidencePresent===1,out);
  add('Action requests recovery review without mutation',out.action==='RECOVERY_QUEUE_REVIEW_REQUIRED'&&out.mutation===false,out);
  add('Read-only no row mutation',before===after,{before,after});
}catch(e){add('Unhandled',false,{message:e.message,stack:e.stack});}
finally{try{db?.close()}catch(_){}}
const failures=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failures.length,patch:'AUDIT16D_R3',suite:'SETTLEMENT_DEBT_READ_ONLY',checks:checks.length,failures,details:checks},null,2));process.exit(failures.length?1:0);
