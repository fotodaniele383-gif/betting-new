'use strict';
const cp=require('child_process');const path=require('path');const root=path.resolve(__dirname,'..');
const suites=['tools/test-calcio-patch26fd-all.js','tools/verify-calcio-patch26fd-server.js','tools/verify-calcio-patch26fd-frontend.js','tools/verify-calcio-patch26fd-db.js','tools/verify-calcio-patch26fd-regression.js'];
const results=[];
for(const file of suites){const run=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});const ok=run.status===0;results.push({file,ok,exitCode:run.status});if(!ok){process.stderr.write(run.stdout||'');process.stderr.write(run.stderr||'');process.exit(run.status||1);}}
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26F_D_CALCIO_RELIABILITY_CALIBRATION_TRADING_PORTFOLIO_RUNTIME_DIAGNOSTICS_V2',verification:'5/5 PASS',functionalChecks:33,suites:results},null,2));
