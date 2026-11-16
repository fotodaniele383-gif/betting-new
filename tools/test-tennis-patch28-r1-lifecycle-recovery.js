#!/usr/bin/env node
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const lifecycle=require('../backend/tennisForwardLifecycle');
const source=path.resolve(__dirname,'..','backend','database_betting.db');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'patch28-r1-life-'));
const dbPath=path.join(dir,'fixture.db');fs.copyFileSync(source,dbPath);
const db=new DatabaseSync(dbPath);
const results=[];const check=(name,ok,details)=>results.push({name,ok:Boolean(ok),...(details?{details}:{})});
function hashSource(){const rows=db.prepare('SELECT * FROM ai_forward_test ORDER BY id').all();return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
try{
  const candidate=db.prepare(`SELECT a.id FROM ai_forward_test a JOIN tennis_prediction_snapshots s ON s.bet_id=a.id AND s.is_calibration_anchor=1 JOIN tennis_calibration_eligibility l ON l.bet_id=a.id WHERE UPPER(COALESCE(a.sport_type,''))='TENNIS' ORDER BY a.id LIMIT 1`).get();
  if(!candidate) throw new Error('NO_LIFECYCLE_FIXTURE');
  const id=Number(candidate.id); const sourceHashBefore=hashSource();
  db.prepare(`UPDATE tennis_calibration_eligibility SET eligibility_status='LEGACY_UNVERIFIED',eligibility_reasons='["PRE_CONTRACT_LEGACY_RECORD"]',snapshot_hash='STALE_FIXTURE' WHERE bet_id=?`).run(id);
  const before=lifecycle.scanForwardLifecycle(db,{includeDetails:true,limit:100000});
  check('fixture crea drift derivato',before.driftBets>0,{drift:before.driftBets});
  const rec=lifecycle.reconcileForwardLifecycle(db,{apply:true,operationId:'PATCH28_R1_FIXTURE'});
  const after=lifecycle.scanForwardLifecycle(db,{includeDetails:true,limit:100000});
  check('reconcile ripara drift',rec.success===true&&after.driftBets===0,{repaired:rec.repaired.length,failed:rec.failed.length});
  check('sorgente ai_forward_test invariata',sourceHashBefore===hashSource());
  db.prepare(`UPDATE ai_forward_test SET settlement_contract_status='PROPOSED' WHERE id=?`).run(id);
  require('../backend/tennisPredictionSnapshots').refreshCalibrationEligibilityForBet(db,id,{operationId:'PATCH28_R1_PROPOSED'});
  const proposed=lifecycle.inspectForwardLifecycleBet(db,id);
  check('PROPOSED è attesa evidenza non review',proposed.lifecycleState==='SETTLEMENT_EVIDENCE_PENDING'&&proposed.healthy===true,{state:proposed.lifecycleState,reasons:proposed.reasons});
}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
const failed=results.filter(x=>!x.ok);const out={success:failed.length===0,patch:'TENNIS_PATCH_28_R1',checks:results.length,results};console.log(JSON.stringify(out,null,2));process.exitCode=out.success?0:1;
