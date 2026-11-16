#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');const statePath=path.join(root,'.tennis_patch37_state.json');
if(fs.existsSync(path.join(root,'.tennis_patch38_state.json'))){console.log(JSON.stringify({success:false,code:'PATCH38_DEPENDENCY_ACTIVE'},null,2));process.exit(1);}
function copy(src,dst){fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}function remove(p){if(fs.existsSync(p))fs.rmSync(p,{recursive:true,force:true});}
if(!fs.existsSync(statePath)){console.log(JSON.stringify({success:false,code:'PATCH37_STATE_NOT_FOUND',stateFile:statePath},null,2));process.exit(1);}
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));if(state.patch!=='TENNIS_PATCH_37_EXTERNAL_MATCH_INTELLIGENCE_H2H_WEATHER_RANKING'){console.log(JSON.stringify({success:false,code:'PATCH37_STATE_INVALID'},null,2));process.exit(1);}
try{
 for(const rel of [...state.targets].reverse()){const dst=path.join(root,rel),src=path.join(state.backup,'files',rel);if(state.existed[rel])copy(src,dst);else remove(dst);}
 const dbPath=path.join(root,'backend','database_betting.db');for(const suffix of ['','-wal','-shm']){const key=`database_betting.db${suffix}`,dst=dbPath+suffix,src=path.join(state.backup,'database',key);remove(dst);if(state.dbArtifacts[key]&&fs.existsSync(src))copy(src,dst);}
 remove(statePath);console.log(JSON.stringify({success:true,patch:state.patch,restoredPackageVersion:state.packageBefore,restoredTennisRegistry:state.tennisRegistryBefore,backup:state.backup},null,2));
}catch(error){console.log(JSON.stringify({success:false,code:'PATCH37_ROLLBACK_FAILED',error:error.message},null,2));process.exit(1);}
