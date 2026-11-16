'use strict';
const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const auditDir=path.join(root,'audit_patch13');fs.mkdirSync(auditDir,{recursive:true});
const checks=[];
function pass(name,details=''){checks.push({name,ok:true,details});console.log(`[PASS] ${name}${details?`\n${details}`:''}`);}
function fail(name,error){checks.push({name,ok:false,error:String(error?.message||error)});console.error(`[FAIL] ${name}: ${error?.message||error}`);}
function run(name,args){try{const out=cp.execFileSync(process.execPath,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});pass(name,out.trim());return out;}catch(error){fail(name,(error.stderr||error.stdout||error).toString());return null;}}
function source(name,test,details=''){if(test)pass(name,details);else fail(name,new Error(details||'SOURCE_GUARD_FAILED'));}
const syntaxFiles=[
  'backend/tennisHistoricalCombinationEvidence.js','backend/tennisProgramProgressionAudit.js','backend/server.tennis.js','backend/tennisPatchRegistry.js',
  'backend/tests/patch13TennisHistoricalCombinationEvidenceAndProgression.test.js','tools/migrate-tennis-patch13-historical-combination.js',
  'tools/verify-tennis-patch13-db.js','tools/audit-tennis-historical-combination.js','tools/audit-tennis-program-progression.js','tools/test-tennis-patch13-standalone.js',
  'public/app.js','backend/public/app.js'
];
for(const file of syntaxFiles)run(`Node syntax - ${file}`,['--check',file]);
run('Patch 13 standalone',['tools/test-tennis-patch13-standalone.js']);
run('Build legacy patch inventory',['tools/build-tennis-patch-inventory.js']);
run('Patch 12 standalone compatibility',['tools/test-tennis-patch12-standalone.js']);
const registry=require('../backend/tennisPatchRegistry');
source('Registry Patch 13 active',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=13&&registry.TENNIS_PATCH_REGISTRY_VERSION===`TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`);
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const bapp=fs.readFileSync(path.join(root,'backend/public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const bhtml=fs.readFileSync(path.join(root,'backend/public/index.html'),'utf8');
source('Historical evidence endpoint read-only',server.includes("router.get('/historical-combination-evidence'")&&server.includes('probabilityAuthority: false'));
source('Program progression endpoint read-only',server.includes("router.get('/program-progression-health'")&&server.includes('readOnly: true'));
source('DeepScan persists evidence after final Quality',server.indexOf('PATCH10_QUALITY_FINAL_AFTER_DEEPSCAN')<server.indexOf('PATCH13_HISTORICAL_COMBINATION_SNAPSHOT')&&server.includes('toPersistenceFields(historicalCombinationEvidence)'));
source('Historical evidence has no stake authority',server.includes('stakeAuthority: false')&&fs.readFileSync(path.join(root,'backend/tennisHistoricalCombinationEvidence.js'),'utf8').includes("probabilityMeaning: 'EMPIRICAL_RESOLVED_WIN_RATE_NOT_MATCH_PROBABILITY'"));
source('AI analysis column linked',html.includes('WR storico DS×Gate')&&app.includes('historical-rate-cell-${index}')&&app.includes('renderHistoricalCombinationEvidenceCell'));
source('Operations center Patch 1-13 compatible',html.includes(`Patch 1–${registry.TENNIS_CURRENT_PATCH_VERSION}`)&&html.includes('tennisHistoricalCombinationPanel')&&html.includes('tennisProgramProgressionPanel'));
source('Frontend copies identical',app===bapp&&html===bhtml);
const ids=[...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);const duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
source('No duplicate HTML ids',duplicates.length===0,JSON.stringify(duplicates));
source('No Soccer/Calcio Patch 13 module',!syntaxFiles.some(file=>/calcio|soccer/i.test(file)));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'backend/tennis_patch_inventory.json'),'utf8'));
source('Inventory 56 legacy steps and current >=13',Number(inventory.summary?.uniqueLegacySteps)===56&&Number(inventory.summary?.unregisteredCount)===0&&Number(inventory.registry?.currentPatchVersion)>=13);
const result={success:checks.every(item=>item.ok),patch:'13',checks,frontendHashes:{app:crypto.createHash('sha256').update(app).digest('hex'),index:crypto.createHash('sha256').update(html).digest('hex')},generatedAt:new Date().toISOString()};
fs.writeFileSync(path.join(auditDir,'patch13_verification_report.json'),JSON.stringify(result,null,2));
console.log(`\nReport: audit_patch13\\patch13_verification_report.json`);
if(!result.success)process.exitCode=2;
