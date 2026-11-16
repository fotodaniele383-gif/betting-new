#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const cp=require('child_process');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));const checks=[];
function check(name,value,details=null){checks.push({name,ok:Boolean(value),details});console[value?'log':'error'](`[${value?'PASS':'FAIL'}] ${name}${!value&&details?`: ${details}`:''}`);}
function read(rel){return fs.readFileSync(path.join(root,...rel.split('/')),'utf8');}
function sha(rel){return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,...rel.split('/')))).digest('hex');}
function syntax(rel){const r=cp.spawnSync(process.execPath,['--check',path.join(root,...rel.split('/'))],{encoding:'utf8'});check(`Node syntax - ${rel}`,r.status===0,r.stderr||null);}
function duplicateIds(html){const m=new Map();for(const x of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi))m.set(x[1],(m.get(x[1])||0)+1);return[...m].filter(([,n])=>n>1);}
const files=['backend/tennisForwardSampleIntake.js','backend/tennisPatchRegistry.js','backend/tennisProgramProgressionAudit.js','backend/server.tennis.js','backend/tests/patch24TennisForwardSampleIntakeAssurance.test.js','backend/tests/patch23TennisTourAwareInformationRetrieval.test.js','tools/test-tennis-patch24-standalone.js','tools/audit-tennis-forward-sample-intake-patch24.js','tools/verify-tennis-patch24-db.js','tools/verify-tennis-patch24-canary.js','tools/verify-tennis-patch24.js','public/app.js','backend/public/app.js'];
for(const rel of files)syntax(rel);
try{
 const registry=require(path.join(root,'backend','tennisPatchRegistry'));const intake=require(path.join(root,'backend','tennisForwardSampleIntake'));
 check('Registry Patch 24 active',registry.TENNIS_CURRENT_PATCH_VERSION==='24'&&registry.TENNIS_PATCH_REGISTRY_VERSION==='TENNIS_PATCH_REGISTRY_V24');
 check('Patch 23 retained',registry.PATCHES.some(x=>x.version==='23'&&String(x.status).startsWith('ACTIVE')));
 check('Forward intake V1 Patch 24',intake.TENNIS_FORWARD_SAMPLE_INTAKE_VERSION==='TENNIS_FORWARD_SAMPLE_INTAKE_V1_PATCH24');
 check('Postcondition helper exported',typeof intake.assertForwardCapturePostconditions==='function'&&typeof intake.inspectForwardSampleIntake==='function');
 check('Minimum forward sample conservative',intake.MIN_FORWARD_ACTIONABLE_ROWS===100);
}catch(e){check('Runtime exports',false,e.stack||e.message);}
const moduleText=read('backend/tennisForwardSampleIntake.js');const server=read('backend/server.tennis.js');const progression=read('backend/tennisProgramProgressionAudit.js');const app=read('public/app.js');const html=read('public/index.html');
check('No historical backfill',moduleText.includes('NO_HISTORICAL_BACKFILL')&&moduleText.includes('historicalBackfill: false'));
check('Atomic postcondition linked',server.includes('assertForwardCapturePostconditions(db, betId')&&server.includes("patch24FailureStage = 'FORWARD_CAPTURE_POSTCONDITION'")&&server.includes('failureStage: patch24FailureStage'));
check('Read-only endpoint linked',server.includes("router.get('/forward-sample-intake-readiness'")&&server.includes("forwardSampleIntakeEndpoint: '/api/tennis/forward-sample-intake-readiness'"));
check('Progression Patch 24 linked',progression.includes("TENNIS_PROGRAM_PROGRESSION_AUDIT_V12_PATCH24")&&progression.includes('forwardSampleIntakeHealth')&&progression.includes('Pipeline intake forward Patch 24 strutturalmente pronta'));
check('Patch 23 regression forward-compatible',read('backend/tests/patch23TennisTourAwareInformationRetrieval.test.js').includes('toBeGreaterThanOrEqual(23)')&&read('backend/tests/patch23TennisTourAwareInformationRetrieval.test.js').includes('displayedPatch'));
check('UI Patch 24 linked',html.includes('Patch 24 · Forward Sample Intake Assurance')&&html.includes('Patch 1–24')&&app.includes('loadTennisForwardSampleIntake')&&app.includes('FORWARD ONLY · NO HISTORICAL BACKFILL'));
check('Frontend app byte-identici',sha('public/app.js')===sha('backend/public/app.js'));
check('Frontend index byte-identici',sha('public/index.html')===sha('backend/public/index.html'));
check('No duplicate HTML ids',duplicateIds(html).length===0,duplicateIds(html));
const pkg=JSON.parse(read('package.json'));
check('Scripts Patch 24',Boolean(pkg.scripts?.['test:tennis:patch24']&&pkg.scripts?.['verify:tennis:patch24']&&pkg.scripts?.['verify:tennis:patch24:db']&&pkg.scripts?.['audit:tennis:forward-sample-intake-patch24']&&pkg.scripts?.['test:tennis:patch24:standalone']&&pkg.scripts?.['test:tennis:patch24:canary']));
const inv=JSON.parse(read('backend/tennis_patch_inventory.json'));
check('Inventory Patch 24',String(inv.registry?.currentPatchVersion)==='24'&&inv.registry?.registryVersion==='TENNIS_PATCH_REGISTRY_V24'&&Number(inv.summary?.unregisteredCount)===0,inv.summary);
check('No operational authority',moduleText.includes('productionProbability: false')&&moduleText.includes('deepScanDecision: false')&&moduleText.includes('qualityGate: false')&&moduleText.includes('stake: false')&&moduleText.includes('settlement: false')&&moduleText.includes('automaticPromotion: false'));
check('No Soccer Patch 24 payload marker',!moduleText.includes('PATCH24_SOCCER')&&!server.includes('PATCH24_SOCCER'));
const standalone=cp.spawnSync(process.execPath,[path.join(root,'tools','test-tennis-patch24-standalone.js')],{cwd:root,encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}});if(standalone.stdout)process.stdout.write(standalone.stdout);if(standalone.stderr)process.stderr.write(standalone.stderr);check('Patch 24 standalone',standalone.status===0);
const failed=checks.filter(x=>!x.ok);const report={success:failed.length===0,patch:'24',version:'24.0.0',checks,failed:failed.map(x=>x.name),generatedAt:new Date().toISOString()};const dir=path.join(root,'audit_patch24');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'patch24_verification_report.json'),JSON.stringify(report,null,2));console.log(`\nReport: audit_patch24\\patch24_verification_report.json`);if(failed.length)process.exitCode=2;
