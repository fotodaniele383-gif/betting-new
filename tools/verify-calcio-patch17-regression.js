'use strict';
const { spawnSync } = require('child_process'); const path = require('path');
const root=path.resolve(__dirname,'..');
const scripts=['test-calcio-patch1-standalone.js','test-calcio-patch2-standalone.js','test-calcio-patch3-standalone.js','test-calcio-patch4-standalone.js','test-calcio-patch5-standalone.js','test-calcio-patch6-standalone.js','test-calcio-patch7-standalone.js','test-calcio-patch8-standalone.js','test-calcio-patch9-standalone.js','test-calcio-patch11-standalone.js','test-calcio-patch12-standalone.js','test-calcio-patch17-standalone.js'];
const results=[];
for(const file of scripts){const p=spawnSync(process.execPath,[path.join(root,'tools',file)],{cwd:root,encoding:'utf8',timeout:120000}); results.push({file,ok:p.status===0,status:p.status,stdoutTail:(p.stdout||'').slice(-500),stderrTail:(p.stderr||'').slice(-500)}); if(p.status!==0){console.error(JSON.stringify({success:false,results},null,2));process.exit(1);}}
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_17_UNIFIED_PREDICTION_INDEX_STAKE_AUTHORITY',regression:'CALCIO_PATCH_1_13_PLUS_17',results},null,2));
