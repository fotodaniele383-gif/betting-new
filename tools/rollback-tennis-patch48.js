#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');const statePath=path.join(root,'.tennis_patch48_state.json');
function sha(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}function copy(a,b){fs.mkdirSync(path.dirname(b),{recursive:true});const t=`${b}.restore-${process.pid}.tmp`;fs.copyFileSync(a,t);fs.rmSync(b,{force:true,recursive:true});fs.renameSync(t,b);}function rm(p){if(fs.existsSync(p))fs.rmSync(p,{recursive:true,force:true});}
if(!fs.existsSync(statePath)){console.log(JSON.stringify({success:false,code:'PATCH48_STATE_NOT_FOUND'},null,2));process.exit(1);}const s=JSON.parse(fs.readFileSync(statePath,'utf8'));
try{
 for(const rel of [...s.targets].reverse()){const dst=path.join(root,rel),bak=path.join(s.backup,'files',rel);if(s.existed[rel])copy(bak,dst);else rm(dst);}
 const db=path.join(root,'backend','database_betting.db');rm(db+'-wal');rm(db+'-shm');copy(s.databaseBackup,db);rm(db+'-wal');rm(db+'-shm');
 const restoredSha=sha(db);if(restoredSha!==s.databaseBeforeSha256)throw new Error(`DATABASE_HASH_MISMATCH:${restoredSha}:${s.databaseBeforeSha256}`);
 rm(statePath);const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));const regPath=path.join(root,'backend','tennisPatchRegistry.js');delete require.cache[require.resolve(regPath)];const reg=require(regPath);
 console.log(JSON.stringify({success:true,patch:s.patch,revision:s.revision,restoredPackage:pkg.version,restoredRegistry:String(reg.TENNIS_CURRENT_PATCH_VERSION),databaseSha256:restoredSha,backup:s.backup},null,2));
}catch(error){console.log(JSON.stringify({success:false,code:'PATCH48_ROLLBACK_FAILED',error:error.message,backup:s.backup},null,2));process.exit(1);}
