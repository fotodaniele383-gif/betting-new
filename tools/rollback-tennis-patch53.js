#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
function resolveRoot(){const i=process.argv.indexOf('--root');return path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');}
const root=resolveRoot();const stateFile=path.join(root,'.tennis_patch53_state.json');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const mkdir=dir=>fs.mkdirSync(dir,{recursive:true});const rm=target=>{if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});};
function copy(source,target){mkdir(path.dirname(target));const tmp=`${target}.patch53-rollback-${process.pid}.tmp`;fs.copyFileSync(source,tmp);rm(target);fs.renameSync(tmp,target);}
try{
 if(!fs.existsSync(stateFile))throw new Error('PATCH53_STATE_FILE_MISSING');
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
 for(const rel of [...state.targets].reverse()){
  const destination=path.join(root,rel),backup=path.join(state.backup,'files',rel);
  if(state.existed[rel])copy(backup,destination);else rm(destination);
 }
 const db=path.join(root,'backend','database_betting.db');rm(`${db}-wal`);rm(`${db}-shm`);copy(state.databaseBackup,db);rm(`${db}-wal`);rm(`${db}-shm`);
 const dbSha=sha(db);if(state.databaseBeforeSha256&&dbSha!==state.databaseBeforeSha256)throw new Error(`PATCH53_ROLLBACK_DB_HASH_MISMATCH:${dbSha}:${state.databaseBeforeSha256}`);
 if(state.wtaPath){const actual=fs.existsSync(state.wtaPath)?sha(state.wtaPath):null;if((state.wtaBeforeSha256||null)!==actual)throw new Error(`PATCH53_ROLLBACK_WTA_HASH_MISMATCH:${actual}:${state.wtaBeforeSha256}`);}
 if(state.wtaStatePath){const actual=fs.existsSync(state.wtaStatePath)?sha(state.wtaStatePath):null;if((state.wtaStateBeforeSha256||null)!==actual)throw new Error(`PATCH53_ROLLBACK_WTA_STATE_HASH_MISMATCH:${actual}:${state.wtaStateBeforeSha256}`);}
 rm(stateFile);
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));delete require.cache[require.resolve(path.join(root,'backend','tennisPatchRegistry.js'))];const registry=require(path.join(root,'backend','tennisPatchRegistry.js'));
 console.log(JSON.stringify({success:true,patch:state.patch,revision:state.revision,packageVersion:pkg.version,tennisRegistry:String(registry.TENNIS_CURRENT_PATCH_VERSION),databaseSha256:dbSha,stateRemoved:true},null,2));
}catch(error){console.log(JSON.stringify({success:false,error:error.stack||error.message},null,2));process.exit(1);}
