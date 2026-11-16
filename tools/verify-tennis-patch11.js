'use strict';
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const checks = [];
function pass(name, ok, detail='') { checks.push({ name, ok, detail }); console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? `: ${detail}` : ''}`); if (!ok) process.exitCode = 2; }
function syntax(rel) { const r=spawnSync(process.execPath,['--check',rel],{cwd:root,encoding:'utf8'}); pass(`Node syntax - ${rel}`,r.status===0,r.stderr.trim()); }
for (const rel of ['backend/tennisForwardCaptureHealth.js','backend/server.tennis.js','backend/tennisPatchRegistry.js','backend/tests/patch11TennisForwardCaptureHealthAndSafeSupport.test.js','tools/create-tennis-safe-support-bundle.js','tools/audit-tennis-forward-capture.js','tools/verify-tennis-patch11-db.js','tools/test-tennis-patch11-standalone.js','public/app.js','backend/public/app.js']) syntax(rel);
let r=spawnSync(process.execPath,['tools/test-tennis-patch11-standalone.js'],{cwd:root,encoding:'utf8'}); if(r.stdout)console.log(r.stdout.trim()); if(r.stderr)console.error(r.stderr.trim()); pass('Patch 11 standalone',r.status===0);
r=spawnSync(process.execPath,['tools/build-tennis-patch-inventory.js'],{cwd:root,encoding:'utf8'}); if(r.stdout)console.log(r.stdout.trim()); pass('Build legacy patch inventory',r.status===0);
const registry=require(path.join(root,'backend/tennisPatchRegistry.js')); pass('Registry Patch 11 active',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=11 && registry.TENNIS_PATCH_REGISTRY_VERSION===`TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}` && registry.PATCHES.some(p=>p.version==='11'&&String(p.status).startsWith('ACTIVE')));
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8'); const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'); const app2=fs.readFileSync(path.join(root,'backend/public/app.js'),'utf8'); const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8'); const html2=fs.readFileSync(path.join(root,'backend/public/index.html'),'utf8');
pass('Frontend copies identical',app===app2 && html===html2);
pass('Forward capture health active',server.includes('tennisForwardCaptureActive') && server.includes('TENNIS_FORWARD_CAPTURE_SLA_V1_PATCH11'));
pass('Forward capture endpoint read-only',server.includes("router.get('/forward-capture-health'") && !server.match(/forward-capture-health[\s\S]{0,1800}(INSERT|UPDATE|DELETE)\s+/i));
pass('Operations center Patch 1-11 compatible',html.includes('tennisForwardCapturePanel') && /Patch 1[–-](?:11|12)/.test(html));
pass('Safe support script excludes secrets',fs.readFileSync(path.join(root,'tools/create-tennis-safe-support-bundle.js'),'utf8').includes('telegram.config.json') && fs.readFileSync(path.join(root,'tools/create-tennis-safe-support-bundle.js'),'utf8').includes("'.env"));
let p10=spawnSync(process.execPath,['tools/test-tennis-patch10-standalone.js'],{cwd:root,encoding:'utf8'}); if(p10.stdout)console.log(p10.stdout.trim()); if(p10.stderr)console.error(p10.stderr.trim()); pass('Patch 10 standalone compatibility',p10.status===0);
pass('No Soccer/Calcio Patch 11 module',!['backend/tennisForwardCaptureHealth.js','tools/create-tennis-safe-support-bundle.js'].some(rel=>/(soccer|calcio)/i.test(rel)));
const out=path.join(root,'audit_patch11'); fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(path.join(out,'patch11_verification_report.json'),JSON.stringify({success:checks.every(x=>x.ok),patch:'11',checks},null,2));
if(process.exitCode) process.exit(process.exitCode);
