'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const assert=require('assert/strict');const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const untouched=['backend/calcioUnifiedPredictionIndex.js','backend/calcioProfessionalSelection.js','backend/calcioStakeReconciler.js','backend/calcioDeepScanPayloadContract.js','backend/calcioSourceIntelligence.js','backend/calcioObservability.js','public/app.js','backend/public/app.js'];
const baseline={};
for(const f of untouched) baseline[f]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
assert.equal(baseline['public/app.js'],baseline['backend/public/app.js']);
const syntax=['backend/server.js','backend/calcioAiFinalization.js','backend/calcioEventFinalizationIsolation.js','backend/calcioPatchRegistry.js'];
for(const f of syntax){const r=spawnSync(process.execPath,['--check',path.join(root,f)],{encoding:'utf8'});assert.equal(r.status,0,`${f}:${r.stderr}`);}
const suites=['tools/test-calcio-patch1-standalone.js','tools/test-calcio-patch2-standalone.js','tools/test-calcio-patch3-standalone.js','tools/test-calcio-patch4-standalone.js','tools/test-calcio-patch5-standalone.js','tools/test-calcio-patch6-standalone.js','tools/test-calcio-patch7-standalone.js','tools/test-calcio-patch8-standalone.js','tools/test-calcio-patch9-standalone.js','tools/test-calcio-patch12-standalone.js','tools/test-calcio-patch26a-standalone.js'];
const results=suites.map(file=>{const r=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});return{file,ok:r.status===0,status:r.status,stderr:(r.stderr||'').slice(-1200)};});
assert.ok(results.every(r=>r.ok),JSON.stringify(results.filter(r=>!r.ok),null,2));
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26B_CALCIO_FULL_CANDIDATE_POOL_EVENT_ISOLATION',untouchedHashes:baseline,syntaxChecks:syntax.length,compatibleSuites:results.length,results},null,2));
