#!/usr/bin/env node
'use strict';
const cp=require('child_process');const path=require('path');const root=path.resolve(__dirname,'..');
const suites=[
 'tools/test-tennis-patch35-clv-discovery.js',
 'tools/test-tennis-patch35-stake-authority.js',
 'tools/verify-tennis-patch35-db.js',
 'tools/verify-tennis-patch35-server.js',
 'tools/verify-tennis-patch35-frontend.js',
 'tools/verify-tennis-patch35-regression.js',
 'tools/verify-tennis-patch35-portability.js',
 'tools/audit-tennis-patch35-clv-discovery.js',
 'tools/audit-tennis-patch35.js',
 'tools/verify-tennis-patch35-patch34-compat.js',
 'tools/audit-tennis-core-contract.js',
 'tools/audit-tennis-program-progression.js'
];
const results=[];let checks=0;
for(const file of suites){const run=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}});let parsed=null;try{parsed=JSON.parse(run.stdout);}catch(_){}const passed=Number(parsed?.passed ?? parsed?.functionalChecks ?? (typeof parsed?.checks==='number'?parsed.checks:0) ?? 0);checks+=Number.isFinite(passed)?passed:0;results.push({file,ok:run.status===0&&parsed?.success!==false,exitCode:run.status,passed,stdout:run.status===0?undefined:run.stdout,stderr:run.status===0?undefined:run.stderr});}
const failed=results.filter(r=>!r.ok);const output={success:!failed.length,patch:'TENNIS_PATCH_35_CLV_SPORT_DISCOVERY_FINAL_STAKE_SMALL_SAMPLE_GUARD',revision:'R1_WINDOWS_NODE_CLV_SPORT_DISCOVERY_FINAL_STAKE_SMALL_SAMPLE_GUARD',verification:failed.length?'FAILED':`${results.length}/${results.length} PASS`,functionalChecks:checks,suites:results};console.log(JSON.stringify(output,null,2));process.exit(failed.length?1:0);
