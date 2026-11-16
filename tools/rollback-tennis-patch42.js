#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');const statePath=path.join(root,'.tennis_patch42_state.json');
if(fs.existsSync(path.join(root,'.tennis_patch43_state.json'))){console.log(JSON.stringify({success:false,code:'PATCH43_DEPENDENCY_ACTIVE',message:'Rollback Patch 42 bloccato: rimuovere prima Patch 43.'},null,2));process.exit(1)}
function copy(s,d){fs.mkdirSync(path.dirname(d),{recursive:true});fs.copyFileSync(s,d)}function remove(p){if(fs.existsSync(p))fs.rmSync(p,{recursive:true,force:true})}
if(!fs.existsSync(statePath)){console.log(JSON.stringify({success:false,code:'PATCH42_STATE_NOT_FOUND',stateFile:statePath},null,2));process.exit(1)}
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));if(state.patch!=='TENNIS_PATCH_42_TRADING_ACCORDION_ICON_DISCLOSURE'){console.log(JSON.stringify({success:false,code:'PATCH42_STATE_INVALID'},null,2));process.exit(1)}
try{for(const rel of [...state.targets].reverse()){const dst=path.join(root,rel),src=path.join(state.backup,'files',rel);if(state.existed[rel])copy(src,dst);else remove(dst)}remove(statePath);console.log(JSON.stringify({success:true,patch:state.patch,restoredPackageVersion:state.packageBefore,restoredTennisRegistry:state.tennisRegistryBefore,databaseRestored:false,databasePolicy:'UI_ONLY_NEVER_RESTORE_RUNTIME_DB',backup:state.backup},null,2));}catch(error){console.log(JSON.stringify({success:false,code:'PATCH42_ROLLBACK_FAILED',error:error.message},null,2));process.exit(1)}
