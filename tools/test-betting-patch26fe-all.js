'use strict';
const cp=require('child_process');const path=require('path');const root=path.resolve(__dirname,'..');const tests=['tools/test-betting-patch26fe-unified-index.js'];let checks=0;const results=[];
for(const file of tests){const run=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});if(run.status!==0){process.stderr.write(run.stdout||'');process.stderr.write(run.stderr||'');process.exit(run.status||1);}const parsed=JSON.parse(String(run.stdout||'').trim());checks+=Number(parsed.checks||0);results.push({file,ok:true,checks:parsed.checks||0,fixture:parsed.fixture||null,liveRows:parsed.liveRows||0});}
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_26F_E_UNIFIED_ANALYSIS_TABLE_SPORT_PARITY',checks,results},null,2));
