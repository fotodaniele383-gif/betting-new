'use strict';
const cp=require('child_process');const path=require('path');
const root=path.resolve(__dirname,'..');
const tests=['tools/test-calcio-patch26fd-reliability-calibration.js','tools/test-calcio-patch26fd-runtime-diagnostics.js'];
let checks=0;const results=[];
for(const file of tests){const run=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});if(run.status!==0){process.stderr.write(run.stdout||'');process.stderr.write(run.stderr||'');process.exit(run.status||1);}const parsed=JSON.parse(String(run.stdout||'').trim());checks+=Number(parsed.checks||0);results.push({file,ok:true,checks:parsed.checks||0});}
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26F_D_CALCIO_RELIABILITY_CALIBRATION_TRADING_PORTFOLIO_RUNTIME_DIAGNOSTICS_V2',checks,results},null,2));
