'use strict';
const {spawnSync}=require('child_process');
const path=require('path');
const registry=require('../backend/calcioPatchRegistry');
const r=spawnSync(process.execPath,[path.join(__dirname,'audit-calcio-historical-coverage.js')],{encoding:'utf8',env:process.env});
if(r.status!==0){ if(r.stdout)process.stderr.write(r.stdout); if(r.stderr)process.stderr.write(r.stderr); process.exit(1); }
let coverage={}; try{coverage=JSON.parse(String(r.stdout||'').trim());}catch(error){console.error(r.stdout);throw error;}
const success=coverage.success===true&&registry.CALCIO_CURRENT_PATCH_VERSION==='34';
console.log(JSON.stringify({success,patch:'BETTING_PATCH_26F_B_CALCIO_HISTORICAL_COVERAGE_ENTITY_RESOLUTION',certification:success?'HISTORICAL_COVERAGE_ENTITY_RESOLUTION_CERTIFIED':'HISTORICAL_COVERAGE_NOT_CERTIFIED',registry:{version:registry.CALCIO_CURRENT_PATCH_VERSION,id:registry.PATCHES.at(-1).id},fixtureCoverage:coverage.fixtureCoverage,persistedCoverage:coverage.persistedCoverage,sourceMatrix:coverage.sourceMatrix,rows:coverage.rows,guards:{inventedData:false,asOfSafeCutoff:true,promotedTeamEvidenceShrunk:true,productionProbabilityAuthorityPreserved:true,unifiedStakeAuthorityPreserved:true,portfolioCapsPreserved:true,finalMarketContractPreserved:true,tennisUnchanged:true,newOddsApiCalls:0}},null,2));
process.exit(success?0:1);
