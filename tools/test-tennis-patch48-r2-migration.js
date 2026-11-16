#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const root=path.resolve(__dirname,'..');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'patch48-r2-'));const db=path.join(tmp,'database.db');fs.copyFileSync(path.join(root,'backend','database_betting.db'),db);
const run=cp.spawnSync(process.execPath,[path.join(root,'backend','migrateTennisPatch48.js'),db],{cwd:root,encoding:'utf8',maxBuffer:200*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1',CLV_AUTO_TRACKER_ENABLED:'0'}});
const marker='@@TENNIS_PATCH48_R5_RESULT@@';const resultLine=String(run.stdout||'').split(/\r?\n/).find(line=>line.startsWith(marker));let out;try{out=resultLine?JSON.parse(resultLine.slice(marker.length)):null}catch(e){console.error(run.stdout,run.stderr);process.exit(1)}if(!out){console.error(run.stdout,run.stderr);process.exit(1)}
const checks=[run.status===0,out.success===true,out.probabilityChanged===false,out.oddsChanged===false,out.clvChanged===false,out.forward?.activeStructuralFaults===0,out.forward?.decisionContractBlocked===0,out.integrity==='ok',out.foreignKeyViolations===0];
fs.rmSync(tmp,{recursive:true,force:true});const success=checks.every(Boolean);console.log(JSON.stringify({success,checks:checks.length,details:out},null,2));if(!success)process.exit(1);
