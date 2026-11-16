#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const text=fs.readFileSync(path.join(root,'backend','server.tennis.js'),'utf8');
const checks=[];const add=(name,ok,details={})=>checks.push({name,ok:Boolean(ok),details});
add('import Patch43',text.includes("require('./tennisWtaSourceDiscoveryPatch43')"));
add('scheduler Patch43',text.includes('patch43WtaRefreshSchedule')&&text.includes("operation: 'PATCH43_WTA_REFRESH'"));
add('scheduler Patch39 disattivato',text.includes("reason: 'PATCH43_DYNAMIC_SOURCE_DISCOVERY_ACTIVE'"));
add('endpoint health',text.includes("router.get('/patch43-wta-source-health'"));
add('endpoint probe',text.includes("router.get('/patch43-wta-source-probe'"));
add('endpoint refresh',text.includes("router.post('/patch43-wta-source-refresh'"));
add('legacy route delegata',text.includes("supersededBy:tennisWtaSourceDiscoveryPatch43.VERSION")&&text.includes("tennisWtaSourceDiscoveryPatch43.refresh({dataDir:ABSOLUTE_SACKMANN_DIR"));
add('riavvio player evidence dopo attivazione',text.includes("result?.status === 'WTA_REFRESH_ACTIVATED'")&&text.includes('ensureSackmannReady({required:false})'));
add('nessuna autorità nel server',!text.includes('PATCH43_PROBABILITY_AUTHORITY')&&!text.includes('PATCH43_STAKE_AUTHORITY'));
const errors=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:errors.length===0,patch:'43',checks,errors:errors.length},null,2));if(errors.length)process.exit(1);
