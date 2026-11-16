#!/usr/bin/env node
'use strict';
const path=require('path');
const idx=process.argv.indexOf('--root'),root=path.resolve(idx>=0&&process.argv[idx+1]?process.argv[idx+1]:'.');
const sportArg=process.argv.find(x=>x.startsWith('--sport='));const minutesArg=process.argv.find(x=>x.startsWith('--minutes='));const confirmArg=process.argv.find(x=>x.startsWith('--confirm='));
const m=require(path.join(root,'backend','controlledCanaryActivationPatch59'));
try{const result=m.requestAuthorization({projectRoot:root,sport:sportArg?.split('=')[1],minutes:Number(minutesArg?.split('=')[1]||60),confirmation:confirmArg?.slice('--confirm='.length)});console.log(JSON.stringify(result,null,2));}
catch(error){console.log(JSON.stringify({success:false,status:'CONTROLLED_CANARY_NOT_AUTHORIZED',error:error.message,details:error.report||null,requiredConfirmation:m.CONFIRMATION},null,2));process.exit(1)}
