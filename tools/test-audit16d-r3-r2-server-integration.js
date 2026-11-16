#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const i=process.argv.indexOf('--root'); const ROOT=i>=0?path.resolve(process.argv[i+1]):path.resolve(__dirname,'..');
const s=fs.readFileSync(path.join(ROOT,'backend','server.js'),'utf8'); const d=[]; const c=(n,o,v=null)=>d.push({name:n,ok:Boolean(o),details:v});
for(const token of [
  "require('./calcioSportmonksXgProviderAudit16dR3R2')",
  "require('./calcioXgProviderFailoverAudit16dR3R2')",
  'xgFailoverPrefetchAudit16dR3R2',
  'xgProviderId', 'xgProviderStatus', 'xgProviderSourceClass', 'xgProviderChain', 'xgRealDataAvailable',
  'CERTIFIED_XG_PROVIDER_OR_DECLARED_PROXY'
]) c(`server contains ${token}`,s.includes(token));
c('Sportmonks is not misreported as Understat-loaded',s.includes("understatLoaded: String(xgProviderState?.providerId || '').startsWith('UNDERSTAT')"));
c('Generic real xG participates in multi-provider evidence',s.includes("hasBothXg: Boolean(extData?.xgRealDataAvailable)"));
c('No direct xG provider stake authority introduced',s.includes('directStakeAuthority: false')&&s.includes('directGateAuthority: false'));
const success=d.every(x=>x.ok); console.log(JSON.stringify({success,patch:'AUDIT16D_R3_R2',suite:'SERVER_XG_FAILOVER_INTEGRATION',checks:d.length,failures:d.filter(x=>!x.ok),details:d},null,2)); process.exit(success?0:1);
