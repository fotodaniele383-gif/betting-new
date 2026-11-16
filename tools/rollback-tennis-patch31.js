#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path');
const index=process.argv.indexOf('--root'); const root=path.resolve(index>=0&&process.argv[index+1]?process.argv[index+1]:'.');
const statePath=path.join(root,'.tennis_patch31_state.json'); const dbPath=path.join(root,'backend','database_betting.db');
const nextState=path.join(root,'.tennis_patch32_state.json');
function sleep(ms){try{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}catch(_){const end=Date.now()+ms;while(Date.now()<end){}}}
function copy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});for(let i=0;i<8;i++){try{fs.copyFileSync(src,dst);return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||i===7)throw e;sleep(80*(i+1));}}}
function remove(target){for(let i=0;i<8;i++){try{if(fs.existsSync(target))fs.rmSync(target,{force:true,recursive:true});return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||i===7)throw e;sleep(80*(i+1));}}}
if(fs.existsSync(nextState)){console.log(JSON.stringify({success:false,code:'PATCH32_DEPENDENCY_ACTIVE',requiredAction:'rollback the active successor patch first',statePath:nextState},null,2));process.exit(1);}
if(!fs.existsSync(statePath)){console.log(JSON.stringify({success:false,code:'PATCH31_STATE_NOT_FOUND',statePath},null,2));process.exit(1);}
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
try{
 for(const relative of [...state.targets].reverse()){
   if((state.forwardOnlySecurityFiles||[]).includes(relative))continue;
   const destination=path.join(root,relative); const source=path.join(state.backup,'files',relative);
   if(state.existed[relative])copy(source,destination);else remove(destination);
 }
 for(const suffix of ['','-wal','-shm']){const key=`database_betting.db${suffix}`;const destination=dbPath+suffix;const source=path.join(state.backup,'database',key);remove(destination);if(state.dbArtifacts?.[key]&&fs.existsSync(source))copy(source,destination);}
 remove(statePath);
 console.log(JSON.stringify({success:true,patch:state.patch,restoredBackup:state.backup,packageVersion:state.packageBefore,tennisRegistry:state.tennisRegistryBefore,globalRegistry:state.globalRegistryBefore,databaseRestored:true,rowCountsRestored:state.rowCountsBefore,securityMigrationPreserved:true,forwardOnlySecurityFiles:state.forwardOnlySecurityFiles||[],note:'Credenziali e template sanificati non vengono riportati in file distribuibili dal rollback.'},null,2));
}catch(error){console.log(JSON.stringify({success:false,patch:state.patch,error:error.message},null,2));process.exit(1);}
