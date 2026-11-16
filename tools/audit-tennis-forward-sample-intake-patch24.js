#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const intake=require('../backend/tennisForwardSampleIntake');
function openDb(file){try{const Database=require('better-sqlite3');return{db:new Database(file,{readonly:true,fileMustExist:true}),adapter:'better-sqlite3'};}catch(_){const{DatabaseSync}=require('node:sqlite');return{db:new DatabaseSync(file,{readOnly:true}),adapter:'node:sqlite'};}}
function main(){
 const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));const file=path.join(root,'backend','database_betting.db');const{db,adapter}=openDb(file);
 try{
  const report=intake.inspectForwardSampleIntake(db);
  const success=report.version==='TENNIS_FORWARD_SAMPLE_INTAKE_V1_PATCH24'&&report.structuralReady===true&&report.status!=='BLOCKED_CAPTURE'&&report.historicalBackfill===false&&Object.values(report.authority).every(v=>v===false);
  const output={...report,success,auditAdapter:adapter,patch:'24'};
  const dir=path.join(root,'audit_patch24');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'patch24_forward_sample_intake_audit.json'),JSON.stringify(output,null,2));
  fs.writeFileSync(path.join(dir,'patch24_forward_sample_intake_audit.md'),`# Patch 24 Forward Sample Intake\n\n- Status: **${output.status}**\n- Structural ready: **${output.structuralReady}**\n- Captured valid anchors: **${output.forwardSample.capturedValidAnchors}**\n- Structurally complete: **${output.forwardSample.structurallyCompleteRows}**\n- Settled actionable: **${output.forwardSample.actionableRows}/${output.forwardSample.minimumActionableRows}**\n- Progress: **${output.forwardSample.progressPct}%**\n- Historical backfill: **false**\n- Production authority: **false**\n`);
  console.log(JSON.stringify(output,null,2));if(!success)process.exitCode=2;
 }finally{try{db.close();}catch(_){}}
}
main();
