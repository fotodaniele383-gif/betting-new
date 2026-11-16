
'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const statePath=path.join(ROOT,'.tennis_patch59_r2_startup_state.json');
if(!fs.existsSync(statePath)){console.error(JSON.stringify({success:false,code:'PATCH59_R2_STATE_MISSING'},null,2));process.exit(2);}
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
for(const item of state.backups){fs.copyFileSync(item.backup,item.target);}
for(const file of (state.createdFiles||[])){try{if(fs.existsSync(file))fs.unlinkSync(file);}catch(_){}}
fs.unlinkSync(statePath);
console.log(JSON.stringify({success:true,patch:'TENNIS_PATCH_59_R2_STARTUP_HEALTH_GRACE_COMPAT',restored:state.backups.map(x=>x.target)},null,2));
