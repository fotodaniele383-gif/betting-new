'use strict';
const path=require('path');const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const suites=['tools/test-calcio-patch19-standalone.js','tools/verify-calcio-patch19-frontend.js','tools/verify-calcio-patch19-db.js','tools/verify-calcio-patch19-regression.js','tools/audit-calcio-patch19.js'];
const results=[];
for(const file of suites){const p=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:100*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1'}});results.push({file,ok:p.status===0,status:p.status,stdout:p.stdout||'',stderr:p.stderr||''});if(p.stdout)process.stdout.write(p.stdout);if(p.stderr)process.stderr.write(p.stderr)}
const failed=results.filter(r=>!r.ok);if(failed.length){console.error(JSON.stringify({success:false,failed:failed.map(r=>({file:r.file,status:r.status,stderr:r.stderr.slice(-2000)}))},null,2));process.exit(1)}
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_19_CALCIO_DECISION_IDENTITY_RELIABILITY_CERTIFICATION',verification:`${suites.length}/${suites.length} PASS`,suites},null,2));
