#!/usr/bin/env node
'use strict';
const assert=require('assert');const a=require('../backend/tennisStakeAuthorityPatch35');const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(e){checks.push({name,ok:false,error:e.message});}}
const d=(sample,stake=3,extra={})=>a.decide({proposedStake:stake,qualityCode:'WATCHLIST_MICRO',historicalEvidence:{resolved:sample,reliability:sample<5?'VERY_LOW':'MEDIUM'},...extra});
check('n=0 nessuna autorità stake',()=>assert.deepStrictEqual([d(0).status,d(0).finalStake],['PAPER_ONLY_NO_SAMPLE',0]));
check('n=1 non usa 100% come autorità',()=>assert.deepStrictEqual([d(1).status,d(1).finalStake],['PAPER_ONLY_INSUFFICIENT_SAMPLE',0]));
check('n=4 resta paper-only',()=>assert.strictEqual(d(4).finalStake,0));
check('n=5 consente solo micro cap',()=>assert.strictEqual(d(5).finalStake,2));
check('n=11 consente solo micro cap',()=>assert.strictEqual(d(11).finalStake,2));
check('n=23 cap micro 2 euro',()=>assert.strictEqual(d(23).finalStake,2));
check('n=30 watchlist resta cappata',()=>assert.strictEqual(d(30).finalStake,2));
check('n=30 approved preserva proposta',()=>assert.strictEqual(a.decide({proposedStake:3,qualityCode:'APPROVED_WITH_CAP',historicalEvidence:{resolved:30,reliability:'HIGH'}}).finalStake,3));
check('hard block prevale su campione alto',()=>assert.strictEqual(a.decide({proposedStake:3,qualityCode:'HARD_BLOCK',historicalEvidence:{resolved:100}}).finalStake,0));
check('stake zero non viene aumentato',()=>assert.strictEqual(d(100,0).finalStake,0));
check('persistence fields conservano proposta e finale',()=>{const f=a.toPersistenceFields(d(1));assert.strictEqual(f.tennis_stake_authority_proposed_stake,3);assert.strictEqual(f.tennis_stake_authority_final_stake,0);});
check('health dichiara autorità unica',()=>assert.strictEqual(a.health().soleFinalStakeAuthority,true));
const bad=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,suite:'PATCH35_STAKE_AUTHORITY',checks:checks.length,results:checks},null,2));process.exit(bad.length?1:0);
