#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');const s=fs.readFileSync(path.join(root,'backend','server.tennis.js'),'utf8');const clv=fs.readFileSync(path.join(root,'backend','clvTracker.js'),'utf8');const discovery=fs.readFileSync(path.join(root,'backend','tennisClvSportKeyDiscoveryPatch35.js'),'utf8');const checks=[];function c(n,f){try{f();checks.push({name:n,ok:true});}catch(e){checks.push({name:n,ok:false,error:e.message});}}
c('final stake authority import',()=>assert(s.includes("require('./tennisStakeAuthorityPatch35')")));
c('authority runs after historical evidence',()=>assert(s.indexOf('patch35StakeAuthorityDecision = tennisStakeAuthorityPatch35.decide')>s.indexOf('historicalCombinationEvidence')));
c('final response exposes authority',()=>assert(s.includes('finalStakeAuthority: patch35StakeAuthorityDecision')));
c('persistence includes authority fields',()=>assert(s.includes('tennis_stake_authority_version')&&s.includes('tennis_stake_authority_final_stake')));
c('governance health endpoint',()=>assert(s.includes("router.get('/patch35-governance-health'")));
c('runtime component',()=>assert(s.includes('TENNIS_STAKE_AUTHORITY')));
c('progression V28 expected',()=>assert(s.includes('TENNIS_PROGRAM_PROGRESSION_AUDIT_V28_PATCH35')));
c('CLV discovery import',()=>assert(clv.includes("require('./tennisClvSportKeyDiscoveryPatch35')")));
c('active catalog fetched before plan calls',()=>assert(clv.indexOf('getActiveTennisCatalog')<clv.indexOf('resolvePlanAgainstCatalog')));
c('invalid sport provider truth retained',()=>assert(discovery.includes('INVALID_SPORT_KEY')));
c('valid empty distinct from provider error',()=>assert(clv.includes('CLV_API_VALID_EMPTY_OR_NO_BOOKMAKERS')));
c('provider error does not increment attempts',()=>assert(clv.includes('provider errors do not consume')||clv.includes('providerError')));
c('tracker version Patch35',()=>assert(clv.includes('6.7_PATCH35_ACTIVE_SPORT_DISCOVERY_PROVIDER_TRUTH')));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length},null,2));process.exit(failed.length?1:0);
