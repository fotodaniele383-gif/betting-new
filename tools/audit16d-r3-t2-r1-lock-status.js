#!/usr/bin/env node
'use strict';
const path=require('path');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const mod=require(path.join(root,'backend','tennisMultiProviderData.js'));
const dataDir=path.join(root,'backend','sackmann_data');
const status=mod.getRefreshLockStatus(dataDir);
console.log(JSON.stringify({success:true,patch:'AUDIT16D_R3_T2_R1',dataDir,status},null,2));
