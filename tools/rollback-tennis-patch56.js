#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));const stateFile=path.join(root,'.tennis_patch56_state.json');const dbPath=path.join(root,'backend','database_betting.db');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');const mkdir=d=>fs.mkdirSync(d,{recursive:true});const rm=t=>{if(fs.existsSync(t))fs.rmSync(t,{recursive:true,force:true});};
function copyAtomic(source,target){mkdir(path.dirname(target));const tmp=`${target}.patch56-rollback-${process.pid}.tmp`;fs.copyFileSync(source,tmp);rm(target);fs.renameSync(tmp,target);}
if(!fs.existsSync(stateFile)){console.log(JSON.stringify({success:false,patch:'56',error:'PATCH56_STATE_NOT_FOUND'},null,2));process.exit(1);}
const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
try{
 for(const rel of [...state.targets].reverse()){const dest=path.join(root,rel),backup=path.join(state.backup,'files',rel);if(state.existed[rel])copyAtomic(backup,dest);else rm(dest);}
 rm(`${dbPath}-wal`);rm(`${dbPath}-shm`);copyAtomic(state.databaseBackup,dbPath);rm(`${dbPath}-wal`);rm(`${dbPath}-shm`);
 const dbSha=sha(dbPath);if(dbSha!==state.databaseBeforeSha256)throw new Error(`PATCH56_ROLLBACK_DATABASE_HASH_MISMATCH:${dbSha}`);
 for(const [name,info] of Object.entries(state.invariantFiles||{})){const f=info.path;const actual=fs.existsSync(f)?sha(f):null;if(actual!==info.sha256)throw new Error(`PATCH56_ROLLBACK_INVARIANT_${name}_MISMATCH`);}
 rm(stateFile);
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));delete require.cache[require.resolve(path.join(root,'backend','tennisPatchRegistry.js'))];const reg=require(path.join(root,'backend','tennisPatchRegistry.js'));
 console.log(JSON.stringify({success:true,patch:'TENNIS_PATCH_56_UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_AUTHORITY',rolledBackTo:{packageVersion:pkg.version,tennisRegistry:String(reg.TENNIS_CURRENT_PATCH_VERSION)},databaseByteIdentical:true,stateRemoved:!fs.existsSync(stateFile)},null,2));
}catch(error){console.log(JSON.stringify({success:false,patch:'56',error:error.stack||error.message},null,2));process.exit(1);}
