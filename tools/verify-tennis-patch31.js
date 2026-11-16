#!/usr/bin/env node
'use strict';
const path=require('path'); const cp=require('child_process');
const root=path.resolve(__dirname,'..');
const suites=[
 'tools/test-tennis-patch31-security-module.js',
 'tools/test-tennis-patch31-telegram-env-only.js',
 'tools/test-tennis-patch31-release-policy.js',
 'tools/test-tennis-patch31-release-builder.js',
 'tools/verify-tennis-patch31-server.js',
 'tools/verify-tennis-patch31-frontend.js',
 'tools/verify-tennis-patch31-db.js',
 'tools/verify-tennis-patch31-regression.js',
 'tools/audit-tennis-patch31.js',
 'tools/verify-tennis-patch30.js'
];
let functionalChecks=0; let passedSuites=0; let totalSuites=0; const results=[];
for(const file of suites){const r=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:256*1024*1024});let j=null;try{j=JSON.parse(String(r.stdout||'').trim());}catch(_){};const inner=file.endsWith('verify-tennis-patch30.js')?15:1;totalSuites+=inner;if(r.status===0)passedSuites+=inner;if(Array.isArray(j?.checks))functionalChecks+=j.checks.length;else if(Number.isFinite(Number(j?.functionalChecks)))functionalChecks+=Number(j.functionalChecks);results.push({file,ok:r.status===0,exitCode:r.status,suiteWeight:inner,...(r.status===0?{}:{stdout:r.stdout,stderr:r.stderr})});}
const failed=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_31_SECRETS_RELEASE_HARDENING',revision:'R1_WINDOWS_NODE_SECRETS_RELEASE_HARDENING',verification:failed.length?'FAILED':`${passedSuites}/${totalSuites} PASS`,functionalChecks,suites:results},null,2));process.exit(failed.length?1:0);
