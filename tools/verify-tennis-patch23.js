#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const checks = [];
function pass(name, details=null){checks.push({name,ok:true,details});console.log(`[PASS] ${name}`);}
function fail(name, details=null){checks.push({name,ok:false,details});console.error(`[FAIL] ${name}${details?`: ${details}`:''}`);}
function check(name, value, details=null){value?pass(name,details):fail(name,details);}
function read(rel){return fs.readFileSync(path.join(root,...rel.split('/')),'utf8');}
function sha(rel){return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,...rel.split('/')))).digest('hex');}
function syntax(rel){const r=cp.spawnSync(process.execPath,['--check',path.join(root,...rel.split('/'))],{encoding:'utf8'});check(`Node syntax - ${rel}`,r.status===0,r.stderr||null);}
function duplicateIds(html){const m=new Map();for(const x of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi))m.set(x[1],(m.get(x[1])||0)+1);return [...m].filter(([,n])=>n>1);}
for(const rel of [
 'backend/tennisInformationRetrievalCertification.js','backend/tennisPatchRegistry.js','backend/tennisProgramProgressionAudit.js','backend/server.tennis.js',
 'backend/tests/patch23TennisTourAwareInformationRetrieval.test.js','backend/tests/patch22TennisTourDataReadinessActivityGuard.test.js','tools/test-tennis-patch23-standalone.js','tools/audit-tennis-information-retrieval-patch23.js','tools/verify-tennis-patch23-db.js','tools/verify-tennis-patch23.js','public/app.js','backend/public/app.js'
]) syntax(rel);
try{
 const registry=require(path.join(root,'backend','tennisPatchRegistry'));
 const retrieval=require(path.join(root,'backend','tennisInformationRetrievalCertification'));
 check('Registry Patch 23 active',registry.TENNIS_CURRENT_PATCH_VERSION==='23'&&registry.TENNIS_PATCH_REGISTRY_VERSION==='TENNIS_PATCH_REGISTRY_V23');
 check('Patch 22 retained',registry.PATCHES.some(x=>x.version==='22'&&String(x.status).startsWith('ACTIVE')));
 check('Information Retrieval V3 Patch 23',retrieval.TENNIS_INFORMATION_RETRIEVAL_VERSION==='TENNIS_INFORMATION_RETRIEVAL_V3_PATCH23'&&retrieval.TENNIS_INFORMATION_RETRIEVAL_POLICY_VERSION==='TENNIS_INFORMATION_RETRIEVAL_POLICY_V1_PATCH23');
 check('Schema-adaptive compatibility R1',retrieval.TENNIS_INFORMATION_RETRIEVAL_COMPATIBILITY_VERSION==='TENNIS_INFORMATION_RETRIEVAL_COMPATIBILITY_R1_SCHEMA_ADAPTIVE'&&typeof retrieval.tennisWhereForColumns==='function'&&typeof retrieval.resolvePlayerNamePair==='function');
 check('Tour-aware helper exported',typeof retrieval.resolveProbeScope==='function');
 check('Optional status exported',retrieval.STATUSES.OPTIONAL_NOT_CONFIGURED==='OPTIONAL_NOT_CONFIGURED');
}catch(e){fail('Runtime exports',e.stack||e.message);}
const moduleText=read('backend/tennisInformationRetrievalCertification.js');
const server=read('backend/server.tennis.js');
const app=read('public/app.js');
const html=read('public/index.html');
check('Aggregate freshness explicitly ignored',moduleText.includes('aggregateStatusIgnored: true')&&moduleText.includes('WORST_AVAILABLE_TARGET_FAIL_CLOSED'));
check('Zero-key optional source excluded',moduleText.includes('OPTIONAL_NOT_CONFIGURED')&&moduleText.includes('scoreExcluded: !oddsConfigured'));
check('Probe and canary separated',moduleText.includes('probePlayers')&&moduleText.includes('canaryPlayers')&&moduleText.includes('scoreUsesProbePlayersOnly'));
check('Legacy schema selector guarded',moduleText.includes('resolvePlayerNamePair(cols)')&&moduleText.includes('if (!pair || !where) return []')&&moduleText.includes('catch (_) {\n    return [];'));
const patch22Test=read('backend/tests/patch22TennisTourDataReadinessActivityGuard.test.js');
check('Patch 22 regression forward-compatible',patch22Test.includes('toBeGreaterThanOrEqual(22)')&&patch22Test.includes('TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}')&&patch22Test.includes('displayedPatch'));
check('RSS diagnostics expanded',moduleText.includes('consentPageDetected')&&moduleText.includes('rssParsed')&&moduleText.includes('responseChars'));
check('Server Patch 23 linked',server.includes('PATCH 23 - TOUR-AWARE INFORMATION RETRIEVAL CERTIFICATION')&&server.includes('targetId: req.body?.targetId'));
check('UI Patch 23 linked',html.includes('Patch 23 · Tour-Aware Information Retrieval & Zero-Key Scoring')&&app.includes('Scope circuito')&&app.includes('OPTIONAL_NOT_CONFIGURED'));
check('Frontend app byte-identici',sha('public/app.js')===sha('backend/public/app.js'));
check('Frontend index byte-identici',sha('public/index.html')===sha('backend/public/index.html'));
check('No duplicate HTML ids',duplicateIds(html).length===0,duplicateIds(html));
const pkg=JSON.parse(read('package.json'));
check('Scripts Patch 23',Boolean(pkg.scripts?.['test:tennis:patch23']&&pkg.scripts?.['verify:tennis:patch23']&&pkg.scripts?.['verify:tennis:patch23:db']&&pkg.scripts?.['audit:tennis:information-retrieval-patch23']&&pkg.scripts?.['test:tennis:patch23:standalone']));
const inv=JSON.parse(read('backend/tennis_patch_inventory.json'));
check('Inventory Patch 23',String(inv.registry?.currentPatchVersion)==='23'&&inv.registry?.registryVersion==='TENNIS_PATCH_REGISTRY_V23'&&Number(inv.summary?.unregisteredCount)===0,inv.summary);
check('No operational authority',moduleText.includes("const TENNIS_INFORMATION_RETRIEVAL_MODE = 'CERTIFICATION_READ_ONLY_NO_MODEL_STAKE_AUTHORITY'")&&moduleText.includes('probabilityWeightsChanged: false')&&moduleText.includes('qualityGateAuthority: false')&&moduleText.includes('stakeAuthority: false'));
check('No Soccer Patch 23 payload marker',!moduleText.includes('PATCH23_SOCCER')&&!server.includes('PATCH23_SOCCER'));
const standalone=cp.spawnSync(process.execPath,[path.join(root,'tools','test-tennis-patch23-standalone.js')],{cwd:root,encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}});
if(standalone.stdout)process.stdout.write(standalone.stdout);if(standalone.stderr)process.stderr.write(standalone.stderr);
check('Patch 23 standalone',standalone.status===0);
const failed=checks.filter(x=>!x.ok);const report={success:failed.length===0,patch:'23',checks,failed:failed.map(x=>x.name),generatedAt:new Date().toISOString()};
const dir=path.join(root,'audit_patch23');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'patch23_verification_report.json'),JSON.stringify(report,null,2));
console.log(`\nReport: audit_patch23\\patch23_verification_report.json`);if(failed.length)process.exitCode=2;
