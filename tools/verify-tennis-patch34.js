#!/usr/bin/env node
'use strict';
const path=require('path');const cp=require('child_process');const root=path.resolve(__dirname,'..');
const suites=[
 'tools/test-tennis-patch34-schedule-module.js',
 'tools/test-tennis-patch34-transactional-contract.js',
 'tools/verify-tennis-patch34-server.js',
 'tools/verify-tennis-patch34-frontend.js',
 'tools/verify-tennis-patch34-db.js',
 'tools/verify-tennis-patch34-regression.js',
 'tools/verify-tennis-patch34-portability.js',
 'tools/verify-tennis-patch34-r3-baseline-recovery.js',
 'tools/audit-tennis-patch34.js',
 'tools/test-tennis-patch33-event-time-module.js',
 'tools/test-tennis-patch33-transactional-contract.js',
 'tools/test-tennis-patch32-observability-module.js',
 'tools/test-tennis-patch31-security-module.js',
 'tools/verify-tennis-patch30-db.js',
 'tools/verify-tennis-patch29-r3-db.js'
];
let functionalChecks=0,passedSuites=0;const results=[];
for(const file of suites){const run=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:256*1024*1024});let parsed={};try{parsed=JSON.parse(String(run.stdout||'').trim());}catch(_){}if(run.status===0)passedSuites++;functionalChecks+=Array.isArray(parsed.checks)?parsed.checks.length:Number(parsed.functionalChecks||0);results.push({file,ok:run.status===0,exitCode:run.status,...(run.status===0?{}:{stdout:run.stdout,stderr:run.stderr})});}
const failed=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_34_R3_OFFICIAL_SCHEDULE_AUTHORITY_RESCHEDULE_LIFECYCLE',revision:'R3_WINDOWS_NODE_RUNTIME_BASELINE_RECOVERY',verification:failed.length?'FAILED':`${passedSuites}/${suites.length} PASS`,functionalChecks,suites:results},null,2));process.exit(failed.length?1:0);
