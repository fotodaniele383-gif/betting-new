#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const i=process.argv.indexOf('--root'); const ROOT=i>=0?path.resolve(process.argv[i+1]):path.resolve(__dirname,'..');
const provider=require(path.join(ROOT,'backend','calcioSportmonksXgProviderAudit16dR3R2'));
const health=provider.getProviderHealth();
let cache=[];
try{
  const dir=health.cacheDir;
  for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
    try{ const j=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')); cache.push({file:name,league:j.leagueName||null,season:j.seasonName||j.seasonId||null,fetchedAt:j.fetchedAt||null,teamCount:Object.keys(j.teams||{}).length,fixtureCount:j.fixtureCount||null,fixturesAccepted:j.fixturesAccepted||null}); }catch(_){ cache.push({file:name,status:'INVALID_JSON'}); }
  }
}catch(_){}
console.log(JSON.stringify({success:true,patch:'AUDIT16D_R3_R2',providerHealth:health,cache,directStakeAuthority:false,directGateAuthority:false},null,2));
