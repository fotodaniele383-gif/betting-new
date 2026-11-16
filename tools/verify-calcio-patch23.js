'use strict';
const cp=require('child_process');const path=require('path');
const PATCH='BETTING_PATCH_23_CALCIO_AI_DETERMINISTIC_FINALIZATION_CERTIFICATION';
const suites=['test-calcio-patch23-standalone.js','verify-calcio-patch23-frontend.js','verify-calcio-patch23-db.js','verify-calcio-patch23-regression.js','audit-calcio-patch23.js'];
const results=suites.map(file=>{const r=cp.spawnSync(process.execPath,[path.resolve(__dirname,file)],{encoding:'utf8',timeout:120000,maxBuffer:20*1024*1024});return{file,ok:r.status===0,status:r.status,stdout:r.stdout,stderr:r.stderr};});const bad=results.filter(x=>!x.ok);if(bad.length){for(const x of bad)console.error(x.file,x.stderr||x.stdout);process.exit(1);}console.log(JSON.stringify({success:true,patch:PATCH,verification:'5/5 PASS',suites:results.map(x=>({file:x.file,ok:true}))},null,2));
