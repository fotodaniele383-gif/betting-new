#!/usr/bin/env node
'use strict';
const path=require('path'),{resolveProjectRoot,hasFlag}=require('./patch52-cli');
const root=resolveProjectRoot();const mod=require(path.join(root,'backend','tennisWtaInformationRecoveryPatch52.js'));
mod.probe({dataDir:path.join(root,'backend','sackmann_data'),projectRoot:root,skipNetwork:hasFlag('--offline'),force:hasFlag('--force'),manualImportAuthorized:hasFlag('--manual-authorized'),usageMode:process.env.TENNIS_DATA_USAGE_MODE}).then(r=>{console.log(JSON.stringify(r,null,2));if(r.success===false)process.exit(1)}).catch(e=>{console.log(JSON.stringify({success:false,error:e.stack||e.message},null,2));process.exit(1)});
