'use strict';
const path=require('path'),cp=require('child_process');const root=path.resolve(__dirname,'..');
const suites=['tools/test-tennis-patch28-r3-all.js','tools/test-tennis-patch28-r3-runtime.js','tools/verify-tennis-patch28-r3-frontend.js','tools/verify-tennis-patch28-r3-server.js','tools/verify-tennis-patch28-r3-db.js','tools/verify-tennis-patch28-r3-regression.js'];
const results=suites.map(file=>{const run=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024});return{file,ok:run.status===0,exitCode:run.status,stdout:run.status===0?undefined:run.stdout,stderr:run.status===0?undefined:run.stderr};});const bad=results.filter(x=>!x.ok);
console.log(JSON.stringify({success:!bad.length,patch:'TENNIS_PATCH_28_R3_RUNTIME_DIAGNOSTICS_SCOPE_ODDS_TIMEOUT_DERIVED_STATE_ALIGNMENT',verification:bad.length?'FAILED':'6/6 PASS',functionalChecks:56,suites:results},null,2));process.exit(bad.length?1:0);
