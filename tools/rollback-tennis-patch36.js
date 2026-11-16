#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const statePath=path.join(root,'.tennis_patch36_state.json');const dbPath=path.join(root,'backend','database_betting.db');
const patch37State=path.join(root,'.tennis_patch37_state.json');
function sleep(ms){try{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}catch(_){const e=Date.now()+ms;while(Date.now()<e){}}}
function copy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});for(let n=0;n<8;n++){try{fs.copyFileSync(src,dst);return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||n===7)throw e;sleep(80*(n+1));}}}
function remove(target){for(let n=0;n<8;n++){try{if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});return;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||n===7)throw e;sleep(80*(n+1));}}}
if(fs.existsSync(patch37State)){console.log(JSON.stringify({success:false,code:'PATCH37_DEPENDENCY_ACTIVE',message:'Eseguire prima rollback Tennis Patch 37.'},null,2));process.exit(1);}
if(!fs.existsSync(statePath)){console.log(JSON.stringify({success:false,code:'PATCH36_STATE_NOT_FOUND',statePath},null,2));process.exit(1);}
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
try{
 for(const relative of [...state.targets].reverse()){const destination=path.join(root,relative),source=path.join(state.backup,'files',relative);if(state.existed[relative])copy(source,destination);else remove(destination);}
 for(const suffix of ['','-wal','-shm']){const key=`database_betting.db${suffix}`,destination=dbPath+suffix,source=path.join(state.backup,'database',key);remove(destination);if(state.dbArtifacts?.[key]&&fs.existsSync(source))copy(source,destination);}
 remove(statePath);
 console.log(JSON.stringify({success:true,patch:state.patch,revision:state.revision,restoredBackup:state.backup,packageVersion:state.packageBefore,tennisRegistry:state.tennisRegistryBefore,globalRegistry:state.globalRegistryBefore,databaseRestored:true,rowCountsRestored:state.rowCountsBefore,wtaProviderRecoveryRolledBack:true,tourDriftAuthorityRolledBack:true,riskAuthorityRolledBack:true},null,2));
}catch(error){console.log(JSON.stringify({success:false,patch:state.patch,error:error.message},null,2));process.exit(1);}
