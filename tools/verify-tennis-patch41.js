#!/usr/bin/env node
'use strict';
const cp=require('child_process'),path=require('path');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:'.');
const suites=[
 ['tools/test-tennis-patch41-layout.js',12,'functional'],
 ['tools/verify-tennis-patch41-frontend.js',9,'functional'],
 ['tools/audit-tennis-patch41.js',9,'functional'],
 ['tools/test-tennis-patch40-taxonomy.js',12,'compatibility'],
 ['tools/test-tennis-patch40-reporting.js',18,'compatibility'],
 ['tools/test-tennis-patch40-h2h.js',10,'compatibility'],
 ['tools/verify-tennis-patch40-server.js',12,'compatibility'],
 ['tools/verify-tennis-patch40-db.js',15,'compatibility'],
 ['tools/test-tennis-patch39-calibration.js',8,'compatibility'],
 ['tools/test-tennis-patch39-clv.js',6,'compatibility'],
 ['tools/test-tennis-patch39-evidence.js',9,'compatibility'],
 ['tools/test-tennis-patch39-wta-venue.js',6,'compatibility'],
 ['tools/audit-tennis-core-contract.js',0,'compatibility'],
 ['tools/audit-tennis-program-progression.js',0,'compatibility']
];
let functional=0,compatibility=0,failed=false;const results=[];
for(const [file,expected,kind] of suites){const args=[path.join(root,file)];if(file.includes('patch41')||file.includes('verify-tennis-patch40-'))args.push('--root',root);const r=cp.spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:150*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1',TERM:process.env.TERM||'dumb'}});let parsed=null;try{parsed=JSON.parse(r.stdout)}catch(_){}const ok=r.status===0&&parsed?.success!==false;const parsedChecks=Array.isArray(parsed?.checks)?parsed.checks.length:Number(parsed?.checks);const checks=Number.isFinite(parsedChecks)?parsedChecks:Number(expected||0);if(kind==='functional')functional+=checks;else compatibility+=checks;results.push({file,ok,exitCode:r.status,checks,error:ok?null:(parsed?.error||r.stderr||r.stdout).slice(0,1600)});if(!ok)failed=true;}
const output={success:!failed,patch:'TENNIS_PATCH_41_TRADING_DASHBOARD_READABILITY_RESPONSIVE_TABLES',revision:'R1_WINDOWS_NODE_UI_ONLY_RESPONSIVE_TABLE_HIERARCHY',verification:`${results.filter(x=>x.ok).length}/${results.length} PASS`,functionalChecks:functional,compatibilityChecks:compatibility,suites:results};console.log(JSON.stringify(output,null,2));if(failed)process.exit(1);
