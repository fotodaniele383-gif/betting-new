#!/usr/bin/env node
'use strict';
const path=require('path');const args=process.argv;const i=args.indexOf('--root'),root=path.resolve(i>=0&&args[i+1]?args[i+1]:'.');
const mod=require(path.join(root,'backend','tennisWtaSourceDiscoveryPatch43.js'));
mod.refresh({dataDir:path.join(root,'backend','sackmann_data'),projectRoot:root,force:args.includes('--force'),skipNetwork:args.includes('--offline'),manualImportAuthorized:args.includes('--manual-authorized'),usageMode:process.env.TENNIS_DATA_USAGE_MODE}).then(r=>{console.log(JSON.stringify(r,null,2));if(r.success===false)process.exit(1)}).catch(e=>{console.log(JSON.stringify({success:false,error:e.message},null,2));process.exit(1)});
