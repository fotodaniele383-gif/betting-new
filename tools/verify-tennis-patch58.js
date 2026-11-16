#!/usr/bin/env node
'use strict';
const path=require('path'),cp=require('child_process');const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));const suites=[
 'tools/test-tennis-patch58-state-machine-policy.js',
 'tools/test-tennis-patch58-reconcile.js',
 'tools/test-tennis-patch58-runtime-contract.js',
 'tools/audit-tennis-patch58.js',
 'tools/test-tennis-patch58-r2-startup-recovery-compat.js',
 'tools/test-tennis-patch57-security-policy.js',
 'tools/test-tennis-patch57-server-contract.js',
 'tools/test-tennis-patch57-release-policy.js',
 'tools/test-tennis-patch55-gate-policy.js',
 'tools/test-calcio-patch54-registry-inventory.js',
 'tools/audit-tennis-patch53.js'
];function parse(s){try{return JSON.parse(String(s||'').trim())}catch(_){const t=String(s||'');const i=t.indexOf('{');if(i>=0){try{return JSON.parse(t.slice(i,t.lastIndexOf('}')+1))}catch(__){}}return null}}let functional=0,compatibility=0;const results=[];let audit=null;for(let i=0;i<suites.length;i++){const file=suites[i],r=cp.spawnSync(process.execPath,[path.join(root,file),'--root',root],{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:128*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1',TERM:'dumb',TENNIS_PATCH52_WTA_AUTO_REFRESH:'0',TENNIS_PATCH43_WTA_AUTO_REFRESH:'0',TENNIS_PATCH39_WTA_AUTO_REFRESH:'0'}}),j=parse(r.stdout),checks=Number(j?.checks||0),ok=r.status===0&&!r.error&&j?.success!==false;functional+=checks;if(i>=5)compatibility+=checks;if(file==='tools/audit-tennis-patch58.js')audit=j;results.push({file,ok,exitCode:r.status,checks,error:r.error?.message||(!ok?String(r.stderr||r.stdout||'').slice(-3000):null)});if(!ok){console.log(JSON.stringify({success:false,patch:'TENNIS_PATCH_58_R2_SCHEDULER_RELIABILITY_OPERATIONAL_STATE_MACHINE_STARTUP_RECOVERY_COMPAT',revision:'R2_WINDOWS_NODE_FAIL_CLOSED_SCHEDULER_STATE_MACHINE_STARTUP_RECOVERY_COMPAT',failed:file,results},null,2));process.exit(1)}}console.log(JSON.stringify({success:true,patch:'TENNIS_PATCH_58_R2_SCHEDULER_RELIABILITY_OPERATIONAL_STATE_MACHINE_STARTUP_RECOVERY_COMPAT',revision:'R2_WINDOWS_NODE_FAIL_CLOSED_SCHEDULER_STATE_MACHINE_STARTUP_RECOVERY_COMPAT',verification:`${suites.length}/${suites.length} PASS`,functionalChecks:functional,compatibilityChecks:compatibility,suites:results,auditSummary:audit?{checks:audit.checks,errors:audit.errors,warnings:audit.warnings,stateMachineStatus:audit.stateMachine?.status}:null},null,2));
