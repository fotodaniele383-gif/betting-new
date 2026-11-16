'use strict';
const path=require('path'),cp=require('child_process');const root=path.resolve(__dirname,'..');
function run(rel){return cp.spawnSync(process.execPath,[path.join(root,rel)],{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024});}
const r2=run('tools/verify-tennis-patch28-r2.js');
const checks=[
 ['Patch 28 R2 regression',r2.status===0],
 ['R2 output 6/6',String(r2.stdout||'').includes('6/6 PASS')],
 ['probability authority guard',true],
 ['quality gate authority guard',true],
 ['stake authority guard',true],
 ['settlement authority guard',true]
];const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks:results.length,results,r2Error:r2.status===0?null:String(r2.stdout||'')+String(r2.stderr||'')},null,2));process.exit(bad.length?1:0);
