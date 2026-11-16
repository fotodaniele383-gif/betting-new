#!/usr/bin/env node
'use strict';
const path=require('path');const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');const force=process.argv.includes('--force');const mod=require(path.join(root,'backend','tennisWtaFreshnessRecoveryPatch39'));mod.refresh({dataDir:path.join(root,'backend','sackmann_data'),force}).then(r=>{console.log(JSON.stringify(r,null,2));process.exit(r.success===false?1:0);}).catch(e=>{console.log(JSON.stringify({success:false,error:e.message},null,2));process.exit(1);});
