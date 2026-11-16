#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');const a=fs.readFileSync(path.join(root,'public','app.js'),'utf8');const ab=fs.readFileSync(path.join(root,'backend','public','app.js'),'utf8');const i=fs.readFileSync(path.join(root,'public','index.html'),'utf8');const ib=fs.readFileSync(path.join(root,'backend','public','index.html'),'utf8');const checks=[];function c(n,f){try{f();checks.push({name:n,ok:true});}catch(e){checks.push({name:n,ok:false,error:e.message});}}
c('app mirrors byte-identical',()=>assert.equal(a,ab));c('index mirrors byte-identical',()=>assert.equal(i,ib));
c('Patch35 marker',()=>assert(a.includes('TENNIS_PATCH35_CLV_SPORT_DISCOVERY_FINAL_STAKE_SMALL_SAMPLE_GUARD')));
c('n<5 headline protected',()=>assert(a.includes('CAMPIONE INSUFFICIENTE')));
c('raw small sample visible',()=>assert(a.includes('nessuna autorità stake')));
c('final authority first in advisory',()=>assert(a.includes('stakeAdjustment.finalStakeAuthority')));
c('solidità evidenze non win rate',()=>assert(a.includes('solidità evidenze · non win%')));
c('cache buster Patch35',()=>assert(i.includes('app.js?v=patch35-clv-discovery-final-stake-small-sample')));
c('old headline 100 percent path guarded',()=>assert(a.includes('insufficientSample ?')));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
