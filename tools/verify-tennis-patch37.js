#!/usr/bin/env node
'use strict';
const cp=require('child_process');const path=require('path');
const root=path.resolve(process.cwd());
const suiteFiles=[
 'tools/test-tennis-patch37-h2h.js','tools/test-tennis-patch37-external-sources.js','tools/verify-tennis-patch37-server.js','tools/verify-tennis-patch37-frontend.js','tools/verify-tennis-patch37-db.js','tools/audit-tennis-patch37.js',
 'tools/test-tennis-patch36-risk-authority.js','tools/test-tennis-patch36-tour-drift-authority.js','tools/test-tennis-patch36-wta-provider-recovery.js','tools/verify-tennis-patch36-patch35-compat.js','tools/audit-tennis-core-contract.js','tools/audit-tennis-program-progression.js'
];
function run(file){const r=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1',TERM:'dumb'},maxBuffer:25*1024*1024});let parsed=null;try{parsed=JSON.parse(r.stdout);}catch(_){}return {file,ok:r.status===0,exitCode:r.status,checks:Number(parsed?.checks)||Number(parsed?.checkCount)||Number(parsed?.passed)||0,stdout:r.status===0?undefined:r.stdout,stderr:r.status===0?undefined:r.stderr};}
const suites=suiteFiles.map(run);const failed=suites.filter(s=>!s.ok);const own=suites.slice(0,6).reduce((sum,s)=>sum+s.checks,0);const compatibility=suites.slice(6).reduce((sum,s)=>sum+s.checks,0);
const output={success:failed.length===0,patch:'TENNIS_PATCH_37_EXTERNAL_MATCH_INTELLIGENCE_H2H_WEATHER_RANKING',revision:'R1_WINDOWS_NODE_EXTERNAL_MATCH_INTELLIGENCE_H2H_WEATHER_RANKING',verification:`${suites.length-failed.length}/${suites.length} PASS`,functionalChecks:own,compatibilityChecks:compatibility,suites};console.log(JSON.stringify(output,null,2));if(failed.length)process.exit(1);
