'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const checks = [];
function pass(name, ok, detail='') { checks.push({ name, ok:Boolean(ok), detail }); console.log(`${ok?'[PASS]':'[FAIL]'} ${name}${detail?`: ${detail}`:''}`); if(!ok) process.exitCode=2; }
function syntax(rel) { const r=spawnSync(process.execPath,['--check',rel],{cwd:root,encoding:'utf8'}); pass(`Node syntax - ${rel}`,r.status===0,r.stderr.trim()); }
const files=[
  'backend/tennisPlayerEvidence.js','backend/tennisMatchupIntelligence.js','backend/sackmann.js','backend/server.tennis.js','backend/tennisPatchRegistry.js',
  'backend/tests/patch12TennisPlayerEvidenceMatchupIntelligence.test.js','backend/tests/patch11TennisForwardCaptureHealthAndSafeSupport.test.js',
  'tools/migrate-tennis-patch12-matchup-intelligence.js','tools/verify-tennis-patch12-db.js','tools/audit-tennis-matchup-intelligence.js','tools/verify-tennis-patch12-canary.js','tools/test-tennis-patch12-standalone.js','tools/create-tennis-safe-support-bundle.js',
  'public/app.js','backend/public/app.js'
];
files.forEach(syntax);
let r=spawnSync(process.execPath,['tools/build-tennis-patch-inventory.js'],{cwd:root,encoding:'utf8'}); if(r.stdout)console.log(r.stdout.trim()); if(r.stderr)console.error(r.stderr.trim()); pass('Build legacy patch inventory',r.status===0);
r=spawnSync(process.execPath,['tools/test-tennis-patch12-standalone.js'],{cwd:root,encoding:'utf8'}); if(r.stdout)console.log(r.stdout.trim()); if(r.stderr)console.error(r.stderr.trim()); pass('Patch 12 standalone',r.status===0);
r=spawnSync(process.execPath,['tools/test-tennis-patch11-standalone.js'],{cwd:root,encoding:'utf8'}); if(r.stdout)console.log(r.stdout.trim()); if(r.stderr)console.error(r.stderr.trim()); pass('Patch 11 standalone compatibility',r.status===0);
const registry=require(path.join(root,'backend/tennisPatchRegistry.js'));
pass('Registry Patch 12 active',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=12 && registry.TENNIS_PATCH_REGISTRY_VERSION===`TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}` && registry.PATCHES.some(p=>p.version==='12'&&String(p.status).startsWith('ACTIVE')));
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
const sackmann=fs.readFileSync(path.join(root,'backend/sackmann.js'),'utf8');
const evidence=fs.readFileSync(path.join(root,'backend/tennisPlayerEvidence.js'),'utf8');
const intelligence=fs.readFileSync(path.join(root,'backend/tennisMatchupIntelligence.js'),'utf8');
const support=fs.readFileSync(path.join(root,'tools/create-tennis-safe-support-bundle.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'); const app2=fs.readFileSync(path.join(root,'backend/public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8'); const html2=fs.readFileSync(path.join(root,'backend/public/index.html'),'utf8');
pass('Frontend copies identical',app===app2 && html===html2);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]); const duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
pass('No duplicate HTML ids',duplicates.length===0,duplicates.join(','));
pass('Sackmann synchronous local adapter',/SACKMANN_LOCAL_(?:REFRESHABLE_)?AS_OF_SAFE_V(?:8_PATCH12|9_PATCH14)/.test(sackmann) && !/axios|https?:\/\//i.test(sackmann) && !/async\s+function\s+init/.test(sackmann));
pass('Temporal as-of guard present',evidence.includes('temporalLeakageGuard: true') && evidence.includes('rows[mid].dateMs < asOfMs') && !evidence.includes('closingOdd'));
pass('Patch 12 R1 legacy evidence API compatibility',evidence.includes('PATCH12_R1_LEGACY_PLAYER_EVIDENCE_API_COMPATIBILITY') && evidence.includes('options = asOf') && evidence.includes('surface = opponentName'));
pass('Patch 7 diagnostic contract preserved',server.includes('PATCH12_R1_PATCH7_DIAGNOSTIC_COMPATIBILITY') && server.includes("operation.error('SNAPSHOT_FAILED'") && server.includes("patch12Event: 'PLAYER_MATCHUP_INTELLIGENCE_FAILED'"));
const patch11Test=fs.readFileSync(path.join(root,'backend/tests/patch11TennisForwardCaptureHealthAndSafeSupport.test.js'),'utf8');
pass('Patch 11 UI regression is forward-compatible',patch11Test.includes('Patch 1–${registry.TENNIS_CURRENT_PATCH_VERSION}') && !patch11Test.includes("toContain('Patch 1–11')"));
pass('Production adapter uses match timestamp',server.includes("sackmann.getAdvancedMatchup(p1NameSackmann, p2NameSackmann, surface, match.commence_time)"));
pass('Immutable intelligence atomically persisted',server.includes('persistMatchupIntelligenceForBet') && server.includes('PLAYER_EVIDENCE_CAPTURE') && intelligence.includes('PATCH12_PLAYER_EVIDENCE_IMMUTABLE') && intelligence.includes('PATCH12_CHALLENGER_IMMUTABLE'));
pass('Challenger shadow has no stake authority',server.includes('stakeAuthority: false') && intelligence.includes('SHADOW_ONLY_NO_STAKE_AUTHORITY') && !/challenger[\s\S]{0,240}(stake|allowBet)\s*[:=]/i.test(intelligence));
pass('DeepScan remains separate',server.includes('deepScanSeparate: true') && evidence.toUpperCase().indexOf('DEEPSCAN')===-1);
pass('Read-only intelligence endpoints',server.includes("router.get('/player-matchup-intelligence'") && server.includes("router.get('/player-matchup-intelligence/:betId'") && !/player-matchup-intelligence[\s\S]{0,2500}\b(INSERT|UPDATE|DELETE)\s+/i.test(server));
pass('Operations center Patch 1-12 compatible',html.includes(`Patch 1–${registry.TENNIS_CURRENT_PATCH_VERSION}`) && html.includes('tennisMatchupIntelligencePanel') && app.includes('loadTennisMatchupIntelligence'));
pass('Analysis result displays shadow comparison',app.includes('renderPatch12MatchupBadge') && app.includes('renderPatch12MatchupDetail') && app.includes('La probabilità operativa mostrata nella tabella non viene sostituita'));
pass('Safe support V2 excludes backup trees',/TENNIS_SAFE_SUPPORT_BUNDLE_V(?:2_PATCH12|3_PATCH14|4_PATCH15)/.test(support) && /EXCLUDED_NAMES[^\n]+['"]backup['"][^\n]+['"]backups['"]/.test(support));
pass('No Soccer/Calcio Patch 12 module',!files.some(rel=>/(soccer|calcio)/i.test(rel)));
const forbidden=['backend/.env','backend/telegram.config.json']; pass('No sensitive payload paths',!files.some(rel=>forbidden.includes(rel)));
const out=path.join(root,'audit_patch12'); fs.mkdirSync(out,{recursive:true});
const report={success:checks.every(c=>c.ok),patch:'12',registryVersion:registry.TENNIS_PATCH_REGISTRY_VERSION,currentPatchVersion:registry.TENNIS_CURRENT_PATCH_VERSION,checks,timestamp:new Date().toISOString()};
fs.writeFileSync(path.join(out,'patch12_verification_report.json'),JSON.stringify(report,null,2));
if(process.exitCode) process.exit(process.exitCode);
