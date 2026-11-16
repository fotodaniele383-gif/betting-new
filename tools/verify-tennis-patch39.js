#!/usr/bin/env node
'use strict';
const path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(process.argv[process.argv.indexOf('--root')+1]||'.');
const suites=[
 ['tools/test-tennis-patch39-calibration.js',8],['tools/test-tennis-patch39-clv.js',8],['tools/test-tennis-patch39-evidence.js',11],['tools/test-tennis-patch39-wta-venue.js',6],
 ['tools/verify-tennis-patch39-server.js',15],['tools/verify-tennis-patch39-db.js',14],['tools/audit-tennis-patch39.js',10],
 ['tools/test-tennis-patch37-h2h.js',10],['tools/test-tennis-patch37-external-sources.js',15],['tools/verify-tennis-patch38-server.js',6],
 ['tools/audit-tennis-core-contract.js',0],['tools/audit-tennis-program-progression.js',66]
];
const results=[];let failed=false;for(const [file,checks] of suites){const args=[path.join(root,file)]; if(file.includes('patch39')) args.push('--root',root); const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}});const ok=r.status===0;results.push({file,ok,exitCode:r.status,checks,stdout:ok?undefined:String(r.stdout||'').slice(-2000),stderr:ok?undefined:String(r.stderr||'').slice(-2000)});if(!ok)failed=true;}
const functionalChecks=8+8+11+6+15+14+10;const compatibilityChecks=10+15+6+66;
const output={success:!failed,patch:'TENNIS_PATCH_39_PRIORITY_CALIBRATION_CLV_EVIDENCE_WTA_VENUE_GUARD',revision:'R1_WINDOWS_NODE_MODULAR_PRIORITY_GOVERNANCE',verification:`${suites.length-failed?0:0}/${suites.length} PASS`,functionalChecks,compatibilityChecks,suites};
output.verification=failed?`${results.filter(x=>x.ok).length}/${suites.length} PASS`:`${suites.length}/${suites.length} PASS`;console.log(JSON.stringify({...output,suites:results},null,2));if(failed)process.exit(1);
