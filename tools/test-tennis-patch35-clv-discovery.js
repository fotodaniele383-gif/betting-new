#!/usr/bin/env node
'use strict';
const assert=require('assert');
const discovery=require('../backend/tennisClvSportKeyDiscoveryPatch35');
const fs=require('fs');const path=require('path');
const clvSource=fs.readFileSync(path.join(__dirname,'..','backend','clvTracker.js'),'utf8');
const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true});}catch(e){checks.push({name,ok:false,error:e.message});}}
(async()=>{
 discovery.resetCacheForTests();
 const catalogRaw=[
  {key:'tennis_atp_canadian_open',group:'Tennis',title:'ATP Canadian Open',active:true},
  {key:'tennis_wta_canadian_open',group:'Tennis',title:'WTA Canadian Open',active:true},
  {key:'tennis_atp_washington_open',group:'Tennis',title:'ATP Washington Open',active:true}
 ];
 const catalog=discovery.normalizeCatalog(catalogRaw);
 check('catalog normalizzato Tennis-only',()=>assert.strictEqual(catalog.length,3));
 check('errore 404 classificato invalid sport',()=>assert.strictEqual(discovery.errorInfo({response:{status:404,data:{error_code:'UNKNOWN_SPORT'}}}).category,'INVALID_SPORT_KEY'));
 check('errore 429 classificato rate limit',()=>assert.strictEqual(discovery.errorInfo({response:{status:429,data:{error_code:'RATE_LIMIT'}}}).category,'RATE_LIMIT'));
 const atpBet={id:1,league:'[ATP] Masters 1000',tournament:'Canada Masters Toronto Montreal',sport_type:'TENNIS',home_team:'A',away_team:'B'};
 const wtaBet={id:2,league:'[WTA] WTA 1000',tournament:'National Bank Open Toronto',sport_type:'TENNIS',home_team:'C',away_team:'D'};
 const atp=discovery.resolveBetSportKeys(atpBet,catalog,'tennis_atp_canada_masters_toronto_montreal');
 const wta=discovery.resolveBetSportKeys(wtaBet,catalog,'tennis_wta_toronto');
 check('chiave ATP inventata sostituita dal catalogo attivo',()=>assert.deepStrictEqual(atp.resolvedKeys,['tennis_atp_canadian_open']));
 check('chiave WTA risolta senza contaminazione ATP',()=>assert.deepStrictEqual(wta.resolvedKeys,['tennis_wta_canadian_open']));
 const plan={calls:[{sportKey:'tennis_atp_canada_masters_toronto_montreal',markets:'h2h',betIds:[1],candidateCount:1,highestPriority:100}],blocked:[],maxApiCallsPerRun:3};
 const resolved=discovery.resolvePlanAgainstCatalog(plan,[atpBet],{status:'OK_LIVE',sports:catalog,cacheHit:false,fingerprint:'x'});
 check('piano CLV usa solo sport key catalogata',()=>assert.strictEqual(resolved.calls[0].sportKey,'tennis_atp_canadian_open'));
 check('diagnostica registra invalid key replacement',()=>assert.strictEqual(resolved.sportKeyDiscovery.invalidRequestedKeys,1));
 let calls=0;
 const fetch=async()=>{calls++;return catalogRaw;};
 const [c1,c2]=await Promise.all([discovery.getActiveTennisCatalog(fetch,{forceRefresh:true}),discovery.getActiveTennisCatalog(fetch,{forceRefresh:true})]);
 check('single-flight catalogo una sola richiesta concorrente',()=>assert.strictEqual(calls,1));
 check('catalogo live contiene tre sport',()=>assert.strictEqual(c1.sports.length,3));
 check('seconda promessa riceve stesso fingerprint',()=>assert.strictEqual(c1.fingerprint,c2.fingerprint));
 check('clvTracker integra discovery Patch35',()=>assert.ok(clvSource.includes("require('./tennisClvSportKeyDiscoveryPatch35')")));
 check('versione tracker Patch35 attiva',()=>assert.ok(clvSource.includes('6.7_PATCH35_ACTIVE_SPORT_DISCOVERY_PROVIDER_TRUTH')));
 const bad=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,suite:'PATCH35_CLV_DISCOVERY',checks:checks.length,results:checks},null,2));process.exit(bad.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
