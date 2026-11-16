#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const idx=process.argv.indexOf('--root');const root=path.resolve(idx>=0&&process.argv[idx+1]?process.argv[idx+1]:'.');
const stateFile=path.join(root,'.tennis_patch54_state.json');
const mkdir=d=>fs.mkdirSync(d,{recursive:true});const rm=t=>{if(fs.existsSync(t))fs.rmSync(t,{recursive:true,force:true});};
function copyAtomic(source,target){mkdir(path.dirname(target));const tmp=`${target}.patch54-rollback-${process.pid}.tmp`;fs.copyFileSync(source,tmp);rm(target);fs.renameSync(tmp,target);}
try{
 if(!fs.existsSync(stateFile))throw new Error('PATCH54_STATE_NOT_FOUND');
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 for(const rel of [...state.targets].reverse()){
   const dest=path.join(root,rel),backup=path.join(state.backup,'files',rel);
   if(state.existed[rel])copyAtomic(backup,dest);else rm(dest);
 }
 rm(stateFile);
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 delete require.cache[require.resolve(path.join(root,'backend','tennisPatchRegistry.js'))];
 delete require.cache[require.resolve(path.join(root,'backend','calcioPatchRegistry.js'))];
 const tennis=require(path.join(root,'backend','tennisPatchRegistry.js'));const calcio=require(path.join(root,'backend','calcioPatchRegistry.js'));
 console.log(JSON.stringify({success:true,patch:'TENNIS_PATCH_54_CALCIO_REGISTRY_INVENTORY_REGRESSION_HARMONIZATION',rollback:true,packageVersion:pkg.version,tennisRegistry:String(tennis.TENNIS_CURRENT_PATCH_VERSION),calcioRegistry:String(calcio.CALCIO_CURRENT_PATCH_VERSION),databaseTouched:false,stateRemoved:!fs.existsSync(stateFile)},null,2));
}catch(error){console.log(JSON.stringify({success:false,patch:'TENNIS_PATCH_54_CALCIO_REGISTRY_INVENTORY_REGRESSION_HARMONIZATION',rollback:true,error:error.stack||error.message},null,2));process.exit(1);}
