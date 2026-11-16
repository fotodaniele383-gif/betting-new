#!/usr/bin/env node
'use strict';
const cp=require('child_process');const path=require('path');const root=path.resolve(__dirname,'..');
const suites=[
 'tools/test-tennis-patch34-r4-truth-module.js',
 'tools/test-tennis-patch34-r4-snapshot-authority.js',
 'tools/verify-tennis-patch34-r4-server.js',
 'tools/verify-tennis-patch34-r4-frontend.js',
 'tools/verify-tennis-patch34-r4-db.js',
 'tools/verify-tennis-patch34-r4-regression.js',
 'tools/verify-tennis-patch34-r4-runtime-baseline.js',
 'tools/verify-tennis-patch34-r4-portability.js',
 'tools/audit-tennis-patch34-r4.js',
 'tools/test-tennis-patch34-schedule-module.js',
 'tools/test-tennis-patch34-transactional-contract.js',
 'tools/test-tennis-patch33-event-time-module.js',
 'tools/test-tennis-patch32-observability-module.js',
 'tools/test-tennis-patch31-security-module.js',
 'tools/audit-tennis-core-contract.js'
];
const results=[];let checks=0;
for(const file of suites){const run=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}});let parsed=null;try{parsed=JSON.parse(run.stdout);}catch(_){}const passed=Number(parsed?.passed||0);checks+=passed;results.push({file,ok:run.status===0&&parsed?.success!==false,exitCode:run.status,passed,stdout:run.status===0?undefined:run.stdout,stderr:run.status===0?undefined:run.stderr});}
const failed=results.filter(r=>!r.ok);const output={success:!failed.length,patch:'TENNIS_PATCH_34_R4_SETTLEMENT_TRUTH_SNAPSHOT_AUTHORITY_DIAGNOSTIC_SEMANTICS',revision:'R4_WINDOWS_NODE_SETTLEMENT_TRUTH_SNAPSHOT_AUTHORITY_DIAGNOSTIC_SEMANTICS',verification:failed.length?'FAILED':`${results.length}/${results.length} PASS`,functionalChecks:checks,suites:results};console.log(JSON.stringify(output,null,2));process.exit(failed.length?1:0);
