#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');const root=path.resolve(__dirname,'..');
const files=['backend/server.tennis.js','backend/oddsApiUsageLedger.js','backend/tennisForwardLifecycle.js','backend/reconcileTennisPatch28R1.js'];
const results=files.map(file=>{const r=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});return{file,ok:r.status===0,stderr:String(r.stderr||'').trim()}});
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');results.push({file:'server-ledger-contract',ok:server.includes('ODDS_API_LEDGER_NON_BLOCKING')&&server.includes('safeOddsUsageTelemetry')});
const out={success:results.every(x=>x.ok),results};console.log(JSON.stringify(out,null,2));process.exitCode=out.success?0:1;
