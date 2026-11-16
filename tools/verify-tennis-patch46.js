#!/usr/bin/env node
'use strict';
const cp=require('child_process');const path=require('path');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const suites=[
 ['tools/test-tennis-patch46-stake-contract.js','functional',false],
 ['tools/test-tennis-patch46-frontend.js','functional',false],
 ['tools/test-tennis-patch46-server-integration.js','functional',false],
 ['tools/test-tennis-patch46-migration.js','functional',false],
 ['tools/audit-tennis-patch46.js','functional',true],
 ['tools/test-tennis-patch45-clv-binding.js','functional',true],
 ['tools/test-tennis-patch45-clv-runtime.js','functional',true],
 ['tools/test-tennis-patch45-vault-metadata.js','functional',true],
 ['tools/audit-tennis-patch45.js','functional',true],
 ['tools/test-tennis-patch45-legacy-audit-runtime-drift.js','functional',true],
 ['tools/test-tennis-patch44-dom-runtime.js','compatibility',true],
 ['tools/verify-tennis-patch44-frontend.js','compatibility',true],
 ['tools/audit-tennis-patch44.js','compatibility',true],
 ['tools/test-tennis-patch43-wta-discovery.js','compatibility',false],
 ['tools/verify-tennis-patch43-server.js','compatibility',true],
 ['tools/verify-tennis-patch43-db.js','compatibility',true],
 ['tools/test-tennis-patch42-accordion.js','compatibility',true],
 ['tools/verify-tennis-patch42-frontend.js','compatibility',true],
 ['tools/audit-tennis-patch42.js','compatibility',true],
 ['tools/test-tennis-patch40-taxonomy.js','compatibility',false],
 ['tools/test-tennis-patch40-reporting.js','compatibility',false],
 ['tools/test-tennis-patch40-h2h.js','compatibility',false],
 ['tools/test-tennis-patch39-calibration.js','compatibility',false],
 ['tools/test-tennis-patch39-clv.js','compatibility',false],
 ['tools/test-tennis-patch39-evidence.js','compatibility',false],
 ['tools/test-tennis-patch39-wta-venue.js','compatibility',false],
 ['tools/audit-tennis-core-contract.js','compatibility',false],
 ['tools/audit-tennis-program-progression.js','compatibility',false]
];
let functional=0,compatibility=0,failed=false;const results=[];
for(const [file,kind,withRoot] of suites){const args=[path.join(root,file)];if(withRoot)args.push('--root',root);else if(file.endsWith('audit-tennis-program-progression.js'))args.push(root);const run=cp.spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:320*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1',TERM:process.env.TERM||'dumb',TENNIS_PATCH43_WTA_AUTO_REFRESH:'0',CLV_VERBOSE_AUDIT:'0'}});let parsed=null;try{parsed=JSON.parse(run.stdout)}catch(_){}const ok=run.status===0&&parsed?.success!==false;let n=Array.isArray(parsed?.details)?parsed.details.length:(Array.isArray(parsed?.checks)?parsed.checks.length:Number(parsed?.checksCount??parsed?.checks??0));if(!Number.isFinite(n))n=0;if(kind==='functional')functional+=n;else compatibility+=n;results.push({file,ok,exitCode:run.status,checks:n,error:ok?null:String(parsed?.error||run.stderr||run.stdout).slice(0,5000)});if(!ok)failed=true;}
const out={success:!failed,patch:'TENNIS_PATCH_46_STAKE_AUTHORITY_SEMANTIC_SEPARATION_FINAL_EXECUTABLE_CONTRACT',revision:'R1_WINDOWS_NODE_FINAL_EXECUTABLE_STAKE_CONTRACT_APPEND_ONLY_SNAPSHOT',verification:`${results.filter(x=>x.ok).length}/${results.length} PASS`,functionalChecks:functional,compatibilityChecks:compatibility,suites:results};console.log(JSON.stringify(out,null,2));if(failed)process.exit(1);
