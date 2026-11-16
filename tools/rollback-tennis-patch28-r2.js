'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const arg=process.argv.indexOf('--root');const root=path.resolve(arg>=0&&process.argv[arg+1]?process.argv[arg+1]:'.');
const statePath=path.join(root,'.tennis_patch28_r2_state.json');
function sha(f){return fs.existsSync(f)?crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'):null}
function copy(a,b){fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(a,b)}
function rm(f){if(fs.existsSync(f))fs.rmSync(f,{force:true})}
if(!fs.existsSync(statePath)){console.log(JSON.stringify({success:false,code:'PATCH28_R2_STATE_NOT_FOUND',error:'Stato rollback Patch 28 R2 non trovato.'},null,2));process.exit(1)}
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
try{
 for(const rel of [...state.targets].reverse()){
  const dst=path.join(root,rel),src=path.join(state.backup,'files',rel);
  if(state.existed[rel])copy(src,dst);else rm(dst);
 }
 rm(statePath);
 const dbPath=path.join(root,'backend','database_betting.db');
 console.log(JSON.stringify({success:true,patch:state.patch,rolledBackTo:'TENNIS_PATCH_28_R1',globalRegistry:'37',tennisRegistry:'28',databaseByteIdentical:sha(dbPath)===state.dbBefore,restoredFiles:state.targets.length},null,2));
}catch(error){console.log(JSON.stringify({success:false,patch:state.patch,error:error.message},null,2));process.exit(1)}
