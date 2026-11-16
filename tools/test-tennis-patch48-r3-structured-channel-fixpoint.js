#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const os=require('os');const cp=require('child_process');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'patch48-r3-channel-'));
const dbPath=path.join(tmp,'database.db');
fs.copyFileSync(path.join(root,'backend','database_betting.db'),dbPath);
const db=new DatabaseSync(dbPath,{open:true});
const ids=db.prepare(`SELECT e.bet_id FROM tennis_calibration_eligibility e
  JOIN tennis_prediction_snapshots s ON s.bet_id=e.bet_id AND s.is_calibration_anchor=1
  ORDER BY e.bet_id DESC LIMIT 4`).all().map(row=>Number(row.bet_id));
if(ids.length!==4){console.log(JSON.stringify({success:false,error:`EXPECTED_4_ELIGIBILITY_ROWS_GOT_${ids.length}`}));process.exit(1)}
const placeholders=ids.map(()=>'?').join(',');
db.prepare(`UPDATE tennis_calibration_eligibility SET eligibility_status='R3_TEST_DRIFT',eligibility_reasons='["R3_TEST_DRIFT"]' WHERE bet_id IN (${placeholders})`).run(...ids);
db.close();
const run=cp.spawnSync(process.execPath,[path.join(root,'backend','migrateTennisPatch48.js'),dbPath],{
  cwd:root,encoding:'utf8',maxBuffer:300*1024*1024,
  env:{...process.env,NODE_NO_WARNINGS:'1',CLV_AUTO_TRACKER_ENABLED:'0',TENNIS_PATCH43_WTA_AUTO_REFRESH:'0'}
});
const marker='@@TENNIS_PATCH48_R5_RESULT@@';
const line=String(run.stdout||'').split(/\r?\n/).find(item=>item.startsWith(marker));
let out=null;try{out=line?JSON.parse(line.slice(marker.length)):null}catch(_){}
const repaired=(out?.fixpointPasses||[]).reduce((sum,pass)=>sum+Number(pass?.lifecycle?.repaired?.length||0),0);
const checks=[
  Boolean(line),
  Boolean(out),
  run.status===0,
  out?.success===true,
  repaired>=4,
  Number(out?.lifecycleFinal?.driftBets||0)===0,
  Number(out?.forward?.activeStructuralFaults||0)===0,
  Number(out?.forward?.decisionContractBlocked||0)===0
];
const success=checks.every(Boolean);
fs.rmSync(tmp,{recursive:true,force:true});
console.log(JSON.stringify({success,checks:checks.length,ids,repaired,stderrWarningObserved:/LIFECYCLE_RECONCILE_APPLY|riparati/.test(String(run.stderr||'')),exitCode:run.status,result:out&&{revision:out.revision,failures:out.failures,lifecycleFinal:out.lifecycleFinal,forward:out.forward}},null,2));
if(!success)process.exit(1);
