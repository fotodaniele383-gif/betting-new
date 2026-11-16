
'use strict';
const {spawnSync}=require('child_process');
const path=require('path');
const fs=require('fs');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const runs=[
  ['node',['--check',path.join(ROOT,'tools','startupDoctorPatch57R2.js')]],
  ['node',[path.join(ROOT,'tools','test-tennis-patch59-r2-startup-compat.js'),'--root',ROOT]]
];
const results=[]; let success=true;
for(const [cmd,args] of runs){const r=spawnSync(cmd,args,{cwd:ROOT,encoding:'utf8'}); const ok=r.status===0; success=success&&ok; results.push({command:[cmd,...args].join(' '),ok,exitCode:r.status,stdout:(r.stdout||'').trim(),stderr:(r.stderr||'').trim()});}
console.log(JSON.stringify({success,patch:'TENNIS_PATCH_59_R2_STARTUP_HEALTH_GRACE_COMPAT',verification:success?'2/2 PASS':'FAILED',results},null,2));
process.exit(success?0:1);
