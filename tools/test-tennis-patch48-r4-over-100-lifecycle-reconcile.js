#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const os=require('os');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'patch48-r4-over100-'));
const dbPath=path.join(tmp,'database.db');fs.copyFileSync(path.join(root,'backend','database_betting.db'),dbPath);
const db=new DatabaseSync(dbPath,{open:true});
const snapshots=require(path.join(root,'backend','tennisPredictionSnapshots.js'));
const lifecycle=require(path.join(root,'backend','tennisForwardLifecycle.js'));
function insertClone(table,row,overrides={}){const cols=db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name);const record={...row,...overrides};const names=cols.filter(c=>c!=='id'||record.id!=null);db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(n=>'@'+n).join(',')})`).run(Object.fromEntries(names.map(n=>[n,record[n]??null])));}
try{
 const trackedBefore=Number(db.prepare('SELECT COUNT(DISTINCT bet_id) n FROM tennis_prediction_snapshots WHERE is_calibration_anchor=1').get().n);
 const baseAnchor=db.prepare(`SELECT s.*,a.* FROM tennis_prediction_snapshots s JOIN ai_forward_test a ON a.id=s.bet_id WHERE s.is_calibration_anchor=1 ORDER BY s.bet_id LIMIT 1`).get();
 if(!baseAnchor)throw new Error('NO_BASE_ANCHOR');
 const source=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(baseAnchor.bet_id);
 const maxId=Number(db.prepare('SELECT MAX(id) id FROM ai_forward_test').get().id||0);
 const created=[];
 for(let i=1;i<=11;i++){
   const id=maxId+i;const clone={...source,id,match_name:`R4 OVER100 ${i} ${source.match_name||''}`,event_name:`R4 OVER100 ${i} ${source.event_name||''}`,paper_result_key:`R4_OVER100_${id}`};
   insertClone('ai_forward_test',clone,{id});
   const fresh=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(id);
   const cap=snapshots.capturePredictionSnapshot(db,fresh,{capturedAt:baseAnchor.captured_at,snapshotType:snapshots.SNAPSHOT_TYPES.ORIGINAL,operationId:`PATCH48_R4_OVER100_${id}`});
   if(!cap.inserted||Number(cap.snapshot.is_calibration_anchor)!==1)throw new Error(`ANCHOR_CREATE_FAILED_${id}_${cap.validation?.status}`);
   const elig=snapshots.refreshCalibrationEligibilityForBet(db,id,{operationId:`PATCH48_R4_OVER100_ELIG_${id}`});if(!elig.updated)throw new Error(`ELIG_CREATE_FAILED_${id}`);
   created.push(id);
 }
 const tracked=Number(db.prepare('SELECT COUNT(DISTINCT bet_id) n FROM tennis_prediction_snapshots WHERE is_calibration_anchor=1').get().n);
 if(tracked<=100)throw new Error(`TRACKED_NOT_OVER_100_${tracked}`);
 const driftIds=created.slice(-9);const q=driftIds.map(()=>'?').join(',');
 db.prepare(`UPDATE tennis_calibration_eligibility SET eligibility_status='R4_STALE',eligibility_reasons='["R4_STALE"]',snapshot_hash='R4_STALE_HASH' WHERE bet_id IN (${q})`).run(...driftIds);
 const publicScan=lifecycle.scanForwardLifecycle(db,{includeDetails:true,limit:100});
 const before=lifecycle.scanForwardLifecycle(db,{includeDetails:true,internalUnboundedDetails:true,limit:100000});
 const originalConsole={log:console.log,warn:console.warn,error:console.error};console.log=()=>{};console.warn=()=>{};console.error=()=>{};let result;try{result=lifecycle.reconcileForwardLifecycle(db,{apply:true,operationId:'TENNIS_PATCH48_R4_OVER100_RECONCILE'});}finally{console.log=originalConsole.log;console.warn=originalConsole.warn;console.error=originalConsole.error;}
 const after=lifecycle.scanForwardLifecycle(db,{includeDetails:true,internalUnboundedDetails:true,limit:100000});
 const repairedIds=new Set((result.repaired||[]).map(x=>Number(x.betId)));
 const checks=[tracked===trackedBefore+11,tracked>100,publicScan.details.length===100,publicScan.detailsTruncated===true,before.driftBets===9,before.details.length===tracked,result.success===true,result.repaired.length===9,driftIds.every(id=>repairedIds.has(id)),after.driftBets===0,after.details.length===tracked];
 const success=checks.every(Boolean);
 console.log(JSON.stringify({success,checks:checks.length,trackedBefore,tracked,publicDetails:publicScan.details.length,publicTruncated:publicScan.detailsTruncated,beforeDrift:before.driftBets,internalDetails:before.details.length,repaired:result.repaired.length,repairedIds:[...repairedIds],afterDrift:after.driftBets},null,2));
 if(!success)process.exitCode=1;
}catch(error){console.log(JSON.stringify({success:false,error:error.stack||error.message},null,2));process.exitCode=1;}finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
