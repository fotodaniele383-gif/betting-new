#!/usr/bin/env node
'use strict';
const path=require('path');const cp=require('child_process');const root=path.resolve(__dirname,'..');
const files=['tools/test-tennis-patch27-all.js','tools/test-tennis-patch27-performance.js','tools/verify-tennis-patch27-server.js','tools/verify-tennis-patch27-frontend.js','tools/verify-tennis-patch27-db.js','tools/verify-tennis-patch27-regression.js'];
const suites=files.map(file=>{const r=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',env:{...process.env,TENNIS_DISABLE_NETWORK:'1'},maxBuffer:128*1024*1024});return{file,ok:r.status===0,exitCode:r.status,stdout:r.status===0?undefined:r.stdout,stderr:r.status===0?undefined:r.stderr};});
const success=suites.every(x=>x.ok);console.log(JSON.stringify({success,patch:'TENNIS_PATCH_27_DEEPSCAN_RAM_CACHE_EXPLAINABLE_MATCHUP_COHORT_RECONCILIATION',verification:success?'6/6 PASS':'FAILED',functionalChecks:25,suites},null,2));process.exit(success?0:1);
