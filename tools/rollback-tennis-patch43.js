#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.'),statePath=path.join(root,'.tennis_patch43_state.json');
function copy(s,d){fs.mkdirSync(path.dirname(d),{recursive:true});fs.copyFileSync(s,d)}function remove(p){if(fs.existsSync(p))fs.rmSync(p,{recursive:true,force:true})}
if(!fs.existsSync(statePath)){console.log(JSON.stringify({success:false,code:'PATCH43_STATE_NOT_FOUND',stateFile:statePath},null,2));process.exit(1)}
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));if(state.patch!=='TENNIS_PATCH_43_WTA_SOURCE_DISCOVERY_MIRROR_MANUAL_IMPORT_ATOMIC_RECOVERY'){console.log(JSON.stringify({success:false,code:'PATCH43_STATE_INVALID'},null,2));process.exit(1)}
try{for(const rel of [...state.targets].reverse()){const dst=path.join(root,rel),src=path.join(state.backup,'files',rel);if(state.existed[rel])copy(src,dst);else remove(dst)}remove(statePath);console.log(JSON.stringify({success:true,patch:state.patch,restoredPackageVersion:state.packageBefore,restoredTennisRegistry:state.tennisRegistryBefore,databaseRestored:false,wtaDataRestored:false,runtimeWtaFilesPolicy:'INSTALLER_NEVER_REFRESHES_OR_RESTORES_RUNTIME_WTA_DATA',backup:state.backup},null,2));}catch(error){console.log(JSON.stringify({success:false,code:'PATCH43_ROLLBACK_FAILED',error:error.message},null,2));process.exit(1)}
