#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const arg=process.argv.indexOf('--root'),root=path.resolve(arg>=0&&process.argv[arg+1]?process.argv[arg+1]:'.');
const statePath=path.join(root,'.tennis_patch29_r1_state.json'),dbPath=path.join(root,'backend','database_betting.db');
function sleep(ms){try{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}catch{const end=Date.now()+ms;while(Date.now()<end){}}}
function copy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});for(let i=0;i<8;i++){try{fs.copyFileSync(src,dst);return}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||i===7)throw e;sleep(60*(i+1));}}}
function rm(file){for(let i=0;i<8;i++){try{if(fs.existsSync(file))fs.rmSync(file,{force:true});return}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||i===7)throw e;sleep(60*(i+1));}}}
if(!fs.existsSync(statePath)){console.log(JSON.stringify({success:false,code:'PATCH29_R1_STATE_NOT_FOUND',error:'Stato rollback Patch 29 R1 non trovato.'},null,2));process.exit(1)}
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
try{
 for(const rel of [...state.targets].reverse()){const dst=path.join(root,rel),src=path.join(state.backup,'files',rel);if(state.existed[rel])copy(src,dst);else rm(dst)}
 for(const suffix of ['', '-wal', '-shm']){const dst=dbPath+suffix,key=`database_betting.db${suffix}`,src=path.join(state.backup,'database',key);rm(dst);if(state.dbArtifacts?.[key]&&fs.existsSync(src))copy(src,dst)}
 rm(statePath);
 console.log(JSON.stringify({success:true,patch:state.patch,revision:state.revision,restoredBackup:path.relative(root,state.backup),globalRegistry:'38',tennisRegistry:'29',packageVersion:'21.15.0',databaseRestored:true},null,2));
}catch(error){console.log(JSON.stringify({success:false,patch:state.patch,error:error.message},null,2));process.exit(1)}
