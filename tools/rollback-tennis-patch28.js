#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const arg=process.argv.indexOf('--root');const root=path.resolve(arg>=0&&process.argv[arg+1]?process.argv[arg+1]:'.');
const statePath=path.join(root,'.tennis_patch28_state.json');
function copy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst)}
function removeSafe(file){for(let i=0;i<8;i++){try{if(fs.existsSync(file))fs.rmSync(file,{force:true});return}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||i===7)throw e;const until=Date.now()+60*(i+1);while(Date.now()<until){}}}}
function sha(file){return fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null}
if(!fs.existsSync(statePath)){console.log(JSON.stringify({success:false,code:'TENNIS_PATCH28_STATE_NOT_FOUND',statePath},null,2));process.exit(1)}
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));const dbPath=path.join(root,'backend','database_betting.db');
try{
 for(const rel of [...state.targets].reverse()){const dst=path.join(root,rel),src=path.join(state.backup,'files',rel);if(state.existed[rel])copy(src,dst);else removeSafe(dst)}
 removeSafe(dbPath);removeSafe(`${dbPath}-wal`);removeSafe(`${dbPath}-shm`);copy(path.join(state.backup,'database_betting.db'),dbPath);
 for(const suffix of ['-wal','-shm']){const src=path.join(state.backup,`database_betting.db${suffix}`);if(state.dbSidecars?.[suffix]&&fs.existsSync(src))copy(src,`${dbPath}${suffix}`)}
 removeSafe(statePath);
 const registry=require(path.join(root,'backend','tennisPatchRegistry.js'));
 console.log(JSON.stringify({success:true,patch:'TENNIS_PATCH_28_RUNTIME_HEALTH_TRUTH_EVIDENCE_STATE_FORWARD_RESCHEDULE_SAFETY',tennisRegistryAfter:String(registry.TENNIS_CURRENT_PATCH_VERSION),globalRegistryAfter:'37',databaseRestored:sha(dbPath)===state.dbBefore,backupDir:path.relative(root,state.backup)},null,2));
}catch(error){console.log(JSON.stringify({success:false,error:error.message},null,2));process.exit(1)}
