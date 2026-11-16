#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');const statePath=path.join(root,'.tennis_patch47_state.json');
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function copy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});const tmp=`${dst}.rollback47-${process.pid}-${Date.now()}.tmp`;fs.copyFileSync(src,tmp);if(sha(tmp)!==sha(src))throw new Error(`COPY_VERIFY_FAILED:${dst}`);fs.rmSync(dst,{force:true,recursive:true});fs.renameSync(tmp,dst);}
function remove(target){if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});}
try{
 if(!fs.existsSync(statePath))throw new Error('PATCH47_STATE_NOT_FOUND');const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
 if(!state.databaseBackup||!fs.existsSync(state.databaseBackup))throw new Error('PATCH47_DATABASE_BACKUP_NOT_FOUND');
 if(sha(state.databaseBackup)!==state.databaseBeforeSha256)throw new Error(`PATCH47_DATABASE_BACKUP_HASH_MISMATCH:${sha(state.databaseBackup)}:${state.databaseBeforeSha256}`);
 for(const rel of [...state.targets].reverse()){const dst=path.join(root,rel);const backup=path.join(state.backup,'files',rel);if(state.existed[rel])copy(backup,dst);else remove(dst);}
 const dbPath=path.join(root,'backend','database_betting.db');remove(`${dbPath}-wal`);remove(`${dbPath}-shm`);copy(state.databaseBackup,dbPath);remove(`${dbPath}-wal`);remove(`${dbPath}-shm`);
 for(const rel of state.generatedPaths||[])remove(path.join(root,rel));
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));const regPath=path.join(root,'backend','tennisPatchRegistry.js');delete require.cache[require.resolve(regPath)];const reg=require(regPath);
 const out={success:true,patch:'TENNIS_PATCH_47_CLV_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE_TERMINAL_STATES',restoredPackageVersion:pkg.version,restoredRegistry:String(reg.TENNIS_CURRENT_PATCH_VERSION),databaseRestored:true,databaseSha256:sha(dbPath),expectedDatabaseSha256:state.databaseBeforeSha256,exactDatabaseRestore:sha(dbPath)===state.databaseBeforeSha256,stateRemoved:false};
 if(pkg.version!==state.packageBefore||String(reg.TENNIS_CURRENT_PATCH_VERSION)!==String(state.tennisRegistryBefore)||!out.exactDatabaseRestore)throw new Error(`PATCH47_ROLLBACK_POSTCONDITION_FAILED:${JSON.stringify(out)}`);
 remove(statePath);out.stateRemoved=!fs.existsSync(statePath);console.log(JSON.stringify(out,null,2));
}catch(error){console.log(JSON.stringify({success:false,patch:'47',statePreserved:fs.existsSync(statePath),error:error.stack||error.message},null,2));process.exit(1);}
