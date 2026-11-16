#!/usr/bin/env node
'use strict';
const assert=require('assert'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const root=path.resolve(__dirname,'..'); const pkg=require('../package.json'); const tennis=require('../backend/tennisPatchRegistry'); const calcio=require('../backend/calcioPatchRegistry');
const checks=[]; function check(name,fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.message});}}
const sha=r=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,r))).digest('hex');
const expected={
 'backend/tennisValueEvaluator.js':'c2cff280a2e0551fd35ec8d0c3fdfd80d45de5a1f8f939c5e98f7c6dde34da3f',
 'backend/deepScanTennis.js':'321b7b70c70944e5b76a5738e7d3894aa065ffb61b94c1d6a972a231d249fa60',
 'backend/tennisQualityGateV2.js':'084803dfce7dcb35d65b0e9f6681771e9670bea2a5e9f45965d74d5c686c3bb7',
 'backend/paperTrading.tennis.js':'0b9a680c393da329e7b0c70b817f64aab7563e899de3da9b7891cb1373a7153f'
};
for(const [file,hash] of Object.entries(expected)) check(`hash invariato ${file}`,()=>assert.equal(sha(file),hash));
const depHash=crypto.createHash('sha256').update(JSON.stringify({dependencies:pkg.dependencies,devDependencies:pkg.devDependencies})).digest('hex');
check('dipendenze npm invariate',()=>assert.equal(depHash,'44734dc36db7dfc064ad4f1fe234d25ca9861fb505623bb079be22e745a0c76d'));
check('package 21.18.0',()=>assert.equal(pkg.version,'21.18.0'));
check('registry Tennis 31',()=>assert.equal(tennis.TENNIS_CURRENT_PATCH_VERSION,'31'));
check('registry Calcio 38',()=>assert.equal(String(calcio.CALCIO_CURRENT_PATCH_VERSION),'38'));
check('Patch30 preservata',()=>assert(tennis.PATCHES.some(x=>String(x.version)==='30')));
check('nessuna Odds API nuovo modulo security',()=>assert(!/axios|odds.?api|api\.the-odds-api/i.test(fs.readFileSync(path.join(root,'backend/tennisReleaseSecurity.js'),'utf8'))));
check('nessuna autorità modello Patch31',()=>{const s=fs.readFileSync(path.join(root,'public/app.js'),'utf8');assert(s.includes('modelProbabilityChanged: false')&&s.includes('qualityGateChanged: false')&&s.includes('stakeChanged: false'));});
check('safe support avanzato V6',()=>assert(fs.readFileSync(path.join(root,'tools/create-tennis-safe-support-bundle.js'),'utf8').includes('TENNIS_SAFE_SUPPORT_BUNDLE_V6_PATCH31')));
check('rollback Patch30 bloccato con Patch31',()=>assert(fs.readFileSync(path.join(root,'tools/rollback-tennis-patch30.js'),'utf8').includes('PATCH31_DEPENDENCY_ACTIVE')));
check('release builder fail closed secrets',()=>assert(fs.readFileSync(path.join(root,'tools/build-betting-safe-release.js'),'utf8').includes('STAGING_SECRET_SCAN_FAILED')));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
