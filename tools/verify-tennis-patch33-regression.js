#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const crypto=require('crypto');
const root=path.resolve(__dirname,'..');const pkg=require('../package.json');const tennis=require('../backend/tennisPatchRegistry');const calcio=require('../backend/calcioPatchRegistry');const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
const sha=relative=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex');
const expected={
 'backend/tennisValueEvaluator.js':'c2cff280a2e0551fd35ec8d0c3fdfd80d45de5a1f8f939c5e98f7c6dde34da3f',
 'backend/deepScanTennis.js':'321b7b70c70944e5b76a5738e7d3894aa065ffb61b94c1d6a972a231d249fa60',
 'backend/tennisQualityGateV2.js':'084803dfce7dcb35d65b0e9f6681771e9670bea2a5e9f45965d74d5c686c3bb7',
 'backend/paperTrading.tennis.js':'0b9a680c393da329e7b0c70b817f64aab7563e899de3da9b7891cb1373a7153f'
};
for(const [file,hash] of Object.entries(expected))check(`hash invariato ${file}`,()=>assert.equal(sha(file),hash));
const depHash=crypto.createHash('sha256').update(JSON.stringify({dependencies:pkg.dependencies,devDependencies:pkg.devDependencies})).digest('hex');
check('dipendenze npm invariate',()=>assert.equal(depHash,'44734dc36db7dfc064ad4f1fe234d25ca9861fb505623bb079be22e745a0c76d'));
check('package 21.20.0',()=>assert.equal(pkg.version,'21.20.0'));check('registry Tennis 33',()=>assert.equal(tennis.TENNIS_CURRENT_PATCH_VERSION,'33'));check('registry Calcio 38',()=>assert.equal(String(calcio.CALCIO_CURRENT_PATCH_VERSION),'38'));
check('Patch32 preservata',()=>assert(tennis.PATCHES.some(x=>String(x.version)==='32')));
const source=fs.readFileSync(path.join(root,'backend/tennisCanonicalEventTime.js'),'utf8');
check('nessuna rete nel contratto tempo',()=>assert(!/axios|fetch\(|https?:\/\//i.test(source)));
check('nessuna autorità modello o stake',()=>assert(source.includes('productionProbability:false')&&source.includes('qualityGate:false')&&source.includes('stake:false')&&source.includes('settlement:false')));
check('nessun override automatico',()=>assert(source.includes('automaticRescheduleOverride:false')&&source.includes('automaticGateOverride:false')));
check('Prematch Gate versione preservata',()=>assert.equal(require('../backend/tennisPrematchCaptureGate').TENNIS_PREMATCH_CAPTURE_GATE_VERSION,'TENNIS_PREMATCH_CAPTURE_GATE_V1_PATCH29_R3'));
check('rollback Patch32 protetto',()=>assert(fs.readFileSync(path.join(root,'tools/rollback-tennis-patch32.js'),'utf8').includes('PATCH33_DEPENDENCY_ACTIVE')));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_33_CANONICAL_EVENT_TIME_PROVIDER_TIME_QUALITY',checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
