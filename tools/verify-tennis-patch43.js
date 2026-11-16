#!/usr/bin/env node
'use strict';
const cp=require('child_process'),path=require('path');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const suites=[
 ['tools/test-tennis-patch43-wta-discovery.js',14,'functional',true],
 ['tools/verify-tennis-patch43-server.js',9,'functional',true],
 ['tools/verify-tennis-patch43-db.js',6,'functional',true],
 ['tools/audit-tennis-patch43.js',10,'functional',true],
 ['tools/test-tennis-patch42-accordion.js',15,'compatibility',false],
 ['tools/verify-tennis-patch42-frontend.js',10,'compatibility',true],
 ['tools/audit-tennis-patch42.js',9,'compatibility',true],
 ['tools/test-tennis-patch40-taxonomy.js',12,'compatibility',false],
 ['tools/test-tennis-patch40-reporting.js',18,'compatibility',false],
 ['tools/test-tennis-patch40-h2h.js',10,'compatibility',false],
 ['tools/test-tennis-patch39-calibration.js',8,'compatibility',false],
 ['tools/test-tennis-patch39-clv.js',6,'compatibility',false],
 ['tools/test-tennis-patch39-evidence.js',9,'compatibility',false],
 ['tools/test-tennis-patch39-wta-venue.js',6,'compatibility',false],
 ['tools/audit-tennis-core-contract.js',0,'compatibility',false],
 ['tools/audit-tennis-program-progression.js',0,'compatibility',false]
];
let functional=0,compatibility=0,failed=false;const results=[];
for(const [file,expected,kind,withRoot] of suites){const args=[path.join(root,file)];if(withRoot)args.push('--root',root);const r=cp.spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:220*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1',TERM:process.env.TERM||'dumb',TENNIS_PATCH43_WTA_AUTO_REFRESH:'0'}});let parsed=null;try{parsed=JSON.parse(r.stdout)}catch(_){}const ok=r.status===0&&parsed?.success!==false;let checks=Array.isArray(parsed?.checks)?parsed.checks.length:Number(parsed?.checksCount??parsed?.checks);if(!Number.isFinite(checks))checks=Number(expected||0);if(kind==='functional')functional+=checks;else compatibility+=checks;results.push({file,ok,exitCode:r.status,checks,error:ok?null:String(parsed?.error||r.stderr||r.stdout).slice(0,2200)});if(!ok)failed=true;}
const out={success:!failed,patch:'TENNIS_PATCH_43_WTA_SOURCE_DISCOVERY_MIRROR_MANUAL_IMPORT_ATOMIC_RECOVERY',revision:'R1_WINDOWS_NODE_DYNAMIC_DISCOVERY_MIRROR_MANUAL_IMPORT_ATOMIC_LKG',verification:`${results.filter(x=>x.ok).length}/${results.length} PASS`,functionalChecks:functional,compatibilityChecks:compatibility,suites:results};console.log(JSON.stringify(out,null,2));if(failed)process.exit(1);
