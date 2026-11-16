#!/usr/bin/env node
'use strict';
const path=require('path'); const cp=require('child_process');
const root=path.resolve(__dirname,'..');
const suites=['tools/test-tennis-patch31-security-module.js','tools/test-tennis-patch31-telegram-env-only.js','tools/test-tennis-patch31-release-policy.js','tools/test-tennis-patch31-release-builder.js'];
let functionalChecks=0; const results=[];
for(const file of suites){const r=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024});let j=null;try{j=JSON.parse(String(r.stdout||'').trim());}catch(_){};functionalChecks+=Array.isArray(j?.checks)?j.checks.length:0;results.push({file,ok:r.status===0,exitCode:r.status,...(r.status===0?{}:{stdout:r.stdout,stderr:r.stderr})});}
const failed=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_31_SECRETS_RELEASE_HARDENING',verification:failed.length?'FAILED':`${suites.length}/${suites.length} PASS`,functionalChecks,suites:results},null,2));process.exit(failed.length?1:0);
