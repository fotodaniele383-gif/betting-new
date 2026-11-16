'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const cp=require('child_process');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const auditDir=path.join(root,'audit_patch22');fs.mkdirSync(auditDir,{recursive:true});
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function run(name,args){const out=cp.spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});return{name,success:out.status===0,status:out.status,stdout:out.stdout.trim(),stderr:out.stderr.trim()};}
function check(name,success,details=null){return{name,success:Boolean(success),details};}
function duplicateIds(html){const ids=[...html.matchAll(/\sid=["']([^"']+)["']/g)].map(x=>x[1]);const seen=new Set(),dups=[];for(const id of ids){if(seen.has(id)&&!dups.includes(id))dups.push(id);seen.add(id);}return dups;}
const jsFiles=[
 'backend/tennisTourDataReadiness.js','backend/tennisPlayerDataRefresh.js','backend/tennisPlayerEvidence.js','backend/tennisMatchupIntelligence.js','backend/tennisProgramProgressionAudit.js','backend/server.tennis.js','backend/tennisPatchRegistry.js','backend/tests/patch22TennisTourDataReadinessActivityGuard.test.js','tools/migrate-tennis-patch22-tour-data-readiness.js','tools/verify-tennis-patch22-db.js','tools/audit-tennis-tour-data-readiness.js','tools/test-tennis-patch22-standalone.js','tools/create-tennis-safe-support-bundle.js','tools/test-tennis-safe-support-immutable-sanitization.js','tools/verify-tennis-patch22.js','public/app.js','backend/public/app.js'
];
const checks=[];
for(const rel of jsFiles){const f=path.join(root,rel);const out=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});checks.push(check(`Node syntax - ${rel}`,out.status===0,out.stderr.trim()));}
const inventoryRun=run('Build legacy patch inventory',['tools/build-tennis-patch-inventory.js']);checks.push(check(inventoryRun.name,inventoryRun.success,inventoryRun.stdout||inventoryRun.stderr));
const standalone=run('Patch 22 standalone',['tools/test-tennis-patch22-standalone.js']);checks.push(check(standalone.name,standalone.success,standalone.stdout||standalone.stderr));
const registry=require(path.join(root,'backend/tennisPatchRegistry'));
const readiness=require(path.join(root,'backend/tennisTourDataReadiness'));
const progression=require(path.join(root,'backend/tennisProgramProgressionAudit'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'backend/tennis_patch_inventory.json'),'utf8'));
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const safeSupport=fs.readFileSync(path.join(root,'tools/create-tennis-safe-support-bundle.js'),'utf8');
const status=readiness.buildTargetReadiness({dataDir:path.join(root,'backend/sackmann_data'),projectRoot:root,now:new Date('2026-07-20T08:00:00.000Z')});
checks.push(
 check('Registry Patch 22 active',registry.TENNIS_CURRENT_PATCH_VERSION==='22'&&registry.TENNIS_PATCH_REGISTRY_VERSION==='TENNIS_PATCH_REGISTRY_V22'&&registry.PATCHES.some(x=>x.version==='21'&&x.status==='ACTIVE')),
 check('Tour readiness module',readiness.TENNIS_TOUR_DATA_READINESS_VERSION==='TENNIS_TOUR_DATA_READINESS_V1_PATCH22'),
 check('ATP current and WTA stale unmasked',status.status==='MIXED_CURRENT_STALE'&&status.targets.find(x=>x.targetId==='ATP_MAIN')?.status==='CURRENT'&&status.targets.find(x=>x.targetId==='WTA_MAIN')?.status==='STALE'&&status.sourceFreshnessNotMasked===true,status.targets),
 check('Activity separated',readiness.resolveEvidenceReadiness({tour:'ATP',activityDays:60},{report:status}).sourceFreshnessSeparateFromPlayerActivity===true),
 check('Read-only endpoint',server.includes("router.get('/tour-data-readiness'")&&!server.includes("router.post('/tour-data-readiness'")),
 check('Health component and progression',server.includes('tennisTourDataReadinessActive')&&progression.TENNIS_PROGRAM_PROGRESSION_AUDIT_VERSION==='TENNIS_PROGRAM_PROGRESSION_AUDIT_V10_PATCH22'),
 check('UI Patch 1-22',html.includes('Patch 1–22')&&html.includes('Freschezza per circuito')&&app.includes('loadTennisTourDataReadiness')),
 check('Frontend app byte-identici',sha(path.join(root,'public/app.js'))===sha(path.join(root,'backend/public/app.js'))),
 check('Frontend index byte-identici',sha(path.join(root,'public/index.html'))===sha(path.join(root,'backend/public/index.html'))),
 check('No duplicate HTML ids',duplicateIds(html).length===0,duplicateIds(html)),
 check('Scripts Patch 22',Boolean(pkg.scripts['test:tennis:patch22']&&pkg.scripts['migrate:tennis:patch22']&&pkg.scripts['verify:tennis:patch22']&&pkg.scripts['verify:tennis:patch22:db']&&pkg.scripts['audit:tennis:tour-data-readiness']&&pkg.scripts['test:tennis:patch22:r2:safe-support'])),
 check('Safe support immutable trigger compatibility',safeSupport.includes('TENNIS_SAFE_SUPPORT_BUNDLE_V5_PATCH22_R2')&&safeSupport.includes('dropUserTriggers(db, triggers)')&&safeSupport.includes('restoreUserTriggers(db, triggers)')&&safeSupport.includes('assertTriggerSchemaRestored(db, triggers)')), 
 check('Inventory Patch 22',inventory.registry.currentPatchVersion==='22'&&inventory.registry.registryVersion==='TENNIS_PATCH_REGISTRY_V22'&&inventory.summary.uniqueLegacySteps===56&&inventory.summary.unregisteredCount===0),
 check('No operational authority',status.authority.productionProbability===false&&status.authority.deepScanDecision===false&&status.authority.qualityGate===false&&status.authority.stake===false&&status.authority.automaticPromotion===false),
 check('No Soccer Patch 22 payload marker',!server.includes('PATCH22_SOCCER')&&!app.includes('PATCH22_SOCCER'))
);
const report={success:checks.every(x=>x.success),patch:'22',version:readiness.TENNIS_TOUR_DATA_READINESS_VERSION,checks,generatedAt:new Date().toISOString()};
fs.writeFileSync(path.join(auditDir,'patch22_verification_report.json'),JSON.stringify(report,null,2));
for(const item of checks)console.log(`[${item.success?'PASS':'FAIL'}] ${item.name}${item.details&&item.success===false?`: ${JSON.stringify(item.details)}`:''}`);
console.log(`\nReport: ${path.relative(root,path.join(auditDir,'patch22_verification_report.json'))}`);
if(!report.success)process.exit(2);
