'use strict';
const cp=require('child_process');const path=require('path');
const PATCH='BETTING_PATCH_24_CALCIO_CANONICAL_DEEPSCAN_ATOMIC_FINALIZATION';
const suites=['test-calcio-patch24-standalone.js','verify-calcio-patch24-frontend.js','verify-calcio-patch24-db.js','verify-calcio-patch24-regression.js','audit-calcio-patch24.js'];
const results=suites.map(file=>{const r=cp.spawnSync(process.execPath,[path.resolve(__dirname,file)],{encoding:'utf8',timeout:180000,maxBuffer:20*1024*1024});return{file,ok:r.status===0,status:r.status,stdout:r.stdout,stderr:r.stderr};});
const bad=results.filter(x=>!x.ok);if(bad.length){for(const b of bad)console.error(`--- ${b.file} ---\n${b.stdout}\n${b.stderr}`);throw new Error('Patch24 verification failed: '+bad.map(x=>x.file).join(', '));}
console.log(JSON.stringify({success:true,patch:PATCH,verification:`${results.length}/${results.length} PASS`,suites:results.map(x=>({file:x.file,ok:true}))},null,2));
