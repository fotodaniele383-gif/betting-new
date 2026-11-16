#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const crypto=require('crypto');const root=path.resolve(__dirname,'..');const contract=require('./PATCH35_BASELINE_CONTRACT.json');const pkg=require('../package.json');const checks=[];const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');function c(n,f){try{f();checks.push({name:n,ok:true});}catch(e){checks.push({name:n,ok:false,error:e.message});}}
for(const [rel,expected] of Object.entries(contract.protectedFiles))c(`immutato ${rel}`,()=>assert.equal(sha(path.join(root,rel)),expected));
c('dependencies npm invariate',()=>assert.deepStrictEqual(pkg.dependencies||{},contract.dependencies||{}));c('devDependencies npm invariate',()=>assert.deepStrictEqual(pkg.devDependencies||{},contract.devDependencies||{}));
c('package 21.22.0',()=>assert.equal(pkg.version,'21.22.0'));c('registry Tennis 35',()=>assert.equal(require('../backend/tennisPatchRegistry').TENNIS_CURRENT_PATCH_VERSION,'35'));c('global/Calcio registry 38',()=>assert.equal(require('../backend/calcioPatchRegistry').CALCIO_CURRENT_PATCH_VERSION||require('../backend/calcioPatchRegistry').CURRENT_PATCH_VERSION||'38','38'));
c('nessuna nuova dipendenza npm',()=>assert.deepStrictEqual(Object.keys(pkg.dependencies||{}).sort(),Object.keys(contract.dependencies||{}).sort()));
c('nessun backfill settlement Patch35',()=>assert(!fs.readFileSync(path.join(root,'backend','migrateTennisPatch35.js'),'utf8').includes('UPDATE ai_forward_test SET status')));
c('nessuna modifica modello nel migration',()=>{const x=fs.readFileSync(path.join(root,'backend','migrateTennisPatch35.js'),'utf8');assert(!/estimated_prob\s*=|prediction\s*=/.test(x));});
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
