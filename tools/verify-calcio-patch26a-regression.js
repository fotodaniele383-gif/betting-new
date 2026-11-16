'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const assert=require('assert/strict');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const baselineHashes={
 'backend/calcioAiFinalization.js':'d9f336d1d2af01b27927b430900ad27a1a1be766940cdd0f7923bfec0f45eca6',
 'backend/calcioUnifiedPredictionIndex.js':'b9aade3c1875c380ac4b2e957475c88cedba941d1fa5c973552ebd3f5d3a682b',
 'backend/calcioProfessionalSelection.js':'50a5a5b2f76e9790f96e2df67f27d86f3a7f3165f705c9b8013d93d4040324d4',
 'backend/calcioStakeReconciler.js':'70e44d1f2cee584f9c299fde1760bf4d2cb2935293c71ceb72f729e02e1c6c79',
 'backend/calcioDeepScanPayloadContract.js':'b200ae3bad073fe072aec27ed1b3509ef8dc6d8b369a79e2955b7c9dbe03ed28',
 'backend/calcioSourceIntelligence.js':'b1049902274b307a8aff938ba2d5f254ce33266d527738a258b8655276f6db0c',
 'public/app.js':'facefb35faefc9b674774f9f14a258db27050b36142eba8cee800e3b3f7a1b32',
 'backend/public/app.js':'facefb35faefc9b674774f9f14a258db27050b36142eba8cee800e3b3f7a1b32'
};
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');}
for(const [file,expected] of Object.entries(baselineHashes)) assert.equal(sha(file),expected,`Modulo certificato modificato: ${file}`);
const syntaxFiles=['backend/server.js','backend/calcioObservability.js','backend/calcioPatchRegistry.js'];
for(const file of syntaxFiles){const r=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});assert.equal(r.status,0,`${file}: ${r.stderr}`);}
const legacy=['tools/test-calcio-patch1-standalone.js','tools/test-calcio-patch2-standalone.js','tools/test-calcio-patch3-standalone.js','tools/test-calcio-patch4-standalone.js','tools/test-calcio-patch5-standalone.js','tools/test-calcio-patch6-standalone.js','tools/test-calcio-patch7-standalone.js','tools/test-calcio-patch8-standalone.js','tools/test-calcio-patch9-standalone.js','tools/test-calcio-patch12-standalone.js'];
const results=[];
for(const file of legacy){const r=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});results.push({file,ok:r.status===0,status:r.status,stderr:(r.stderr||'').slice(-1000)});}
assert.ok(results.every(r=>r.ok),JSON.stringify(results.filter(r=>!r.ok),null,2));
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26A_CALCIO_OBSERVABILITY_INVARIANTS_BASELINE',untouchedModuleHashes:Object.fromEntries(Object.keys(baselineHashes).map(f=>[f,sha(f)])),syntaxChecks:syntaxFiles.length,compatibleLegacySuites:results.length,results},null,2));
