'use strict';
const path=require('path');const {spawnSync}=require('child_process');const root=path.resolve(__dirname,'..');
const suites=['tools/test-calcio-patch26b-standalone.js','tools/verify-calcio-patch26b-server.js','tools/verify-calcio-patch26b-db.js','tools/verify-calcio-patch26b-regression.js','tools/audit-calcio-patch26b.js'];
const results=suites.map(file=>{const r=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:128*1024*1024});return{file,ok:r.status===0,status:r.status,stdout:r.stdout||'',stderr:r.stderr||''};});
if(!results.every(r=>r.ok)){console.error(JSON.stringify({success:false,patch:'BETTING_PATCH_26B_CALCIO_FULL_CANDIDATE_POOL_EVENT_ISOLATION',results:results.map(r=>({...r,stdout:r.stdout.slice(-5000),stderr:r.stderr.slice(-5000)}))},null,2));process.exit(1);}
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26B_CALCIO_FULL_CANDIDATE_POOL_EVENT_ISOLATION',verification:'5/5 PASS',suites:results.map(r=>({file:r.file,ok:r.ok}))},null,2));
