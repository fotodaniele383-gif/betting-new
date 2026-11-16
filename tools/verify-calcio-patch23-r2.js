'use strict';
const {spawnSync}=require('child_process');const path=require('path');const assert=require('assert');
const root=path.resolve(__dirname,'..');const files=['tools/test-calcio-patch23-r2-standalone.js','tools/verify-calcio-patch23-r2-frontend.js','tools/verify-calcio-patch23-r2-db.js','tools/verify-calcio-patch23-r2-regression.js','tools/audit-calcio-patch23-r2.js'];const suites=[];
for(const file of files){const p=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',timeout:300000,maxBuffer:100*1024*1024});suites.push({file:path.basename(file),ok:p.status===0,stdout:p.stdout||'',stderr:p.stderr||''});if(p.status!==0){console.error(p.stdout);console.error(p.stderr);process.exit(1);}}
assert(suites.every(x=>x.ok));console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_23_R2_CALCIO_DEEPSCAN_COMPACT_PAYLOAD_RUNTIME_RECOVERY',verification:'5/5 PASS',suites:suites.map(x=>({file:x.file,ok:x.ok}))},null,2));
