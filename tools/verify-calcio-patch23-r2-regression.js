'use strict';
const {spawnSync}=require('child_process');const path=require('path');const assert=require('assert');
const root=path.resolve(__dirname,'..');
const files=['tools/test-calcio-patch1-standalone.js','tools/test-calcio-patch2-standalone.js','tools/test-calcio-patch3-standalone.js','tools/test-calcio-patch4-standalone.js','tools/test-calcio-patch5-standalone.js','tools/test-calcio-patch6-standalone.js','tools/test-calcio-patch7-standalone.js','tools/test-calcio-patch8-standalone.js','tools/test-calcio-patch9-standalone.js','tools/test-calcio-patch12-standalone.js'];
const results=[];for(const file of files){const p=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:50*1024*1024});results.push({file,ok:p.status===0,status:p.status,stdoutTail:(p.stdout||'').slice(-400),stderrTail:(p.stderr||'').slice(-400)});}
for(const r of results)assert(r.ok,JSON.stringify(r));
for(const file of ['backend/server.js','backend/calcioDeepScanPayloadContract.js','public/app.js','backend/public/app.js']){const p=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);}
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_23_R2_CALCIO_DEEPSCAN_COMPACT_PAYLOAD_RUNTIME_RECOVERY',compatibleLegacySuites:results.length,syntaxChecks:4,results},null,2));
