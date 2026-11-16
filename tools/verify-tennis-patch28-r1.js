#!/usr/bin/env node
'use strict';
const cp=require('child_process'),path=require('path');const root=path.resolve(__dirname,'..');
const suites=['tools/test-tennis-patch28-r1-all.js','tools/test-tennis-patch28-r1-odds-ledger.js','tools/test-tennis-patch28-r1-lifecycle-recovery.js','tools/verify-tennis-patch28-r1-server.js','tools/verify-tennis-patch28-r1-frontend.js','tools/verify-tennis-patch28-r1-regression.js'];
const results=suites.map(file=>{const r=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024});return{file,ok:r.status===0,exitCode:r.status,stdout:String(r.stdout||'').trim(),stderr:String(r.stderr||'').trim()}});
const out={success:results.every(x=>x.ok),patch:'TENNIS_PATCH_28_R1_LIFECYCLE_AVAILABILITY_ATP_LEDGER_RECOVERY',verification:`${results.filter(x=>x.ok).length}/${results.length} PASS`,functionalChecks:29,suites:results.map(({file,ok,exitCode})=>({file,ok,exitCode}))};
console.log(JSON.stringify(out,null,2));process.exitCode=out.success?0:1;
