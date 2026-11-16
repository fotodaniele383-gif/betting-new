#!/usr/bin/env node
'use strict';
const path=require('path');const args=process.argv;const i=args.indexOf('--root'),root=path.resolve(i>=0&&args[i+1]?args[i+1]:'.');
const mod=require(path.join(root,'backend','tennisWtaSourceDiscoveryPatch43.js'));
const offline=args.includes('--offline'),force=args.includes('--force'),manual=args.includes('--manual-authorized');
mod.probe({dataDir:path.join(root,'backend','sackmann_data'),projectRoot:root,skipNetwork:offline,force,manualImportAuthorized:manual,usageMode:process.env.TENNIS_DATA_USAGE_MODE}).then(r=>{console.log(JSON.stringify(r,null,2));if(r.success===false)process.exit(1)}).catch(e=>{console.log(JSON.stringify({success:false,error:e.message},null,2));process.exit(1)});
