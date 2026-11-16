#!/usr/bin/env node
'use strict';
const assert=require('assert');const risk=require('../backend/tennisRiskAuthorityPatch36');const checks=[];function c(n,f){try{f();checks.push({name:n,ok:true});}catch(e){checks.push({name:n,ok:false,error:e.message});}}
const staleWta=risk.decide({proposedStake:4,league:'[WTA] WTA 1000',qualityCode:'APPROVED',historicalEvidence:{resolved:100},dataReadiness:{status:'STALE',dataAgeDays:70.3,providerId:'LAST_KNOWN_GOOD'}});
c('stale WTA stake zero',()=>assert.equal(staleWta.finalStake,0));c('stale WTA breaker active',()=>assert.equal(staleWta.circuitBreaker,true));c('stale reason explicit',()=>assert(staleWta.reason.includes('70.3')));c('WTA tour recognized',()=>assert.equal(staleWta.tour,'WTA'));
const currentWta=risk.decide({proposedStake:4,league:'WTA',qualityCode:'APPROVED',historicalEvidence:{resolved:100},dataReadiness:{status:'CURRENT',dataAgeDays:3}});
c('current WTA preserves proposal',()=>assert.equal(currentWta.finalStake,4));c('current WTA no breaker',()=>assert.equal(currentWta.circuitBreaker,false));
const atp=risk.decide({proposedStake:2,league:'ATP Masters 1000',qualityCode:'WATCHLIST_MICRO',historicalEvidence:{resolved:175},dataReadiness:{status:'CURRENT',dataAgeDays:8}});
c('ATP current stake preserved',()=>assert.equal(atp.finalStake,2));
const n1=risk.decide({proposedStake:2,league:'ATP',qualityCode:'WATCHLIST_MICRO',historicalEvidence:{resolved:1},dataReadiness:{status:'CURRENT',dataAgeDays:8}});
c('Patch35 n1 guard preserved',()=>assert.equal(n1.finalStake,0));
const n23=risk.decide({proposedStake:3,league:'ATP',qualityCode:'APPROVED',historicalEvidence:{resolved:23},dataReadiness:{status:'CURRENT',dataAgeDays:8}});
c('n23 cap preserved',()=>assert.equal(n23.finalStake,2));
c('authority never raises stake',()=>assert(risk.decide({proposedStake:1,league:'ATP',qualityCode:'APPROVED',historicalEvidence:{resolved:100},dataReadiness:{status:'CURRENT'}}).finalStake<=1));
c('no model authority',()=>assert.equal(risk.health().modelAuthority,false));c('sole final authority',()=>assert.equal(risk.health().soleFinalStakeAuthority,true));c('freshness limit 21 days',()=>assert.equal(risk.WTA_STALE_LIMIT_DAYS,21));
const fields=risk.toPersistenceFields(staleWta,'2026-08-03T00:00:00Z');c('persistence includes circuit breaker',()=>assert.equal(fields.tennis_risk_authority_circuit_breaker,1));c('persistence version Patch36',()=>assert.equal(fields.tennis_risk_authority_version,risk.VERSION));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks,passed:checks.length-failed.length,failed:failed.length,health:risk.health()},null,2));process.exit(failed.length?1:0);
