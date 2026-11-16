'use strict';
const cp=require('child_process');const path=require('path');
const PATCH='BETTING_PATCH_25_CALCIO_DEEPSCAN_RUNTIME_CONSISTENCY_RECOVERY';
const suites=['test-calcio-patch25-standalone.js','verify-calcio-patch25-frontend.js','verify-calcio-patch25-db.js','verify-calcio-patch25-regression.js','audit-calcio-patch25.js'];
const results=suites.map(file=>{const r=cp.spawnSync(process.execPath,[path.resolve(__dirname,file)],{encoding:'utf8',timeout:180000,maxBuffer:30*1024*1024});return{file,ok:r.status===0,status:r.status,stdout:r.stdout,stderr:r.stderr};});
const bad=results.filter(x=>!x.ok);if(bad.length){for(const b of bad)console.error(`--- ${b.file} ---\n${b.stdout}\n${b.stderr}`);throw new Error('Patch25 verification failed: '+bad.map(x=>x.file).join(', '));}
console.log(JSON.stringify({success:true,patch:PATCH,verification:`${results.length}/${results.length} PASS`,suites:results.map(x=>({file:x.file,ok:true}))},null,2));
