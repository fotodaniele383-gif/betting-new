'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const files = [
  'tools/test-calcio-patch1-standalone.js',
  'tools/test-calcio-patch2-standalone.js',
  'tools/test-calcio-patch3-standalone.js',
  'tools/test-calcio-patch4-standalone.js',
  'tools/test-calcio-patch5-standalone.js',
  'tools/test-calcio-patch6-standalone.js',
  'tools/test-calcio-patch7-standalone.js',
  'tools/test-calcio-patch8-standalone.js',
  'tools/test-calcio-patch9-standalone.js',
  'tools/test-calcio-patch12-standalone.js'
];
const results=[];
for (const file of files) {
  const p=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:30*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1'}});
  results.push({file,ok:p.status===0,status:p.status,stdoutTail:(p.stdout||'').slice(-700),stderrTail:(p.stderr||'').slice(-700)});
}
for (const file of ['backend/server.js','backend/calcioDecisionCertification.js','backend/calcioUnifiedPredictionIndex.js','backend/calcioProfessionalSelection.js']) {
  const p=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  results.push({file:`syntax:${file}`,ok:p.status===0,status:p.status,stderrTail:p.stderr||''});
}
const failed=results.filter(r=>!r.ok);
if (failed.length) throw new Error(`Regressioni Patch 19: ${JSON.stringify(failed,null,2)}`);
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_19_CALCIO_DECISION_IDENTITY_RELIABILITY_CERTIFICATION',compatibleLegacySuites:files.length,syntaxChecks:4,results},null,2));
