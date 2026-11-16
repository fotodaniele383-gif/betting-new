#!/usr/bin/env node
'use strict';
const cp=require('child_process');const path=require('path');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));
const suites=[
 'tools/test-tennis-patch56-policy.js',
 'tools/test-tennis-patch56-real-db.js',
 'tools/test-tennis-patch56-runtime-contract.js',
 'tools/audit-tennis-patch56.js',
 'tools/test-tennis-patch55-gate-policy.js',
 'tools/test-tennis-patch55-server-contract.js',
 'tools/test-calcio-patch54-registry-inventory.js',
 'tools/test-calcio-patch54-scheduler-health.js'
];
let functionalChecks=0;const results=suites.map(file=>{const r=cp.spawnSync(process.execPath,[path.join(root,file),'--root',root],{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:128*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1',TERM:'dumb',TENNIS_PATCH52_WTA_AUTO_REFRESH:'0',TENNIS_PATCH43_WTA_AUTO_REFRESH:'0',TENNIS_PATCH39_WTA_AUTO_REFRESH:'0',CLV_VERBOSE_AUDIT:'0'}});let parsed=null;try{parsed=JSON.parse(String(r.stdout||'').trim());functionalChecks+=Number(parsed.checks||parsed.functionalChecks||0);}catch(_){}return{file,ok:r.status===0,exitCode:r.status,checks:parsed?.checks??parsed?.functionalChecks??null,error:r.status===0?null:String(r.stderr||r.stdout||'').slice(-6000)};});
const failed=results.filter(x=>!x.ok);const compatibilityChecks=55+38+53;
console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_56_UNIFIED_CROSS_SPORT_PORTFOLIO_RISK_AUTHORITY',revision:'R1_WINDOWS_NODE_FAIL_CLOSED_REAL_MONEY_PORTFOLIO',verification:`${results.length-failed.length}/${results.length} PASS`,functionalChecks,compatibilityChecks,suites:results},null,2));process.exit(failed.length?1:0);
