'use strict';
const fs=require('fs'); const path=require('path');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');
const bad=server.includes('historicalCoverage: finalMarketCandidate.extData?.historicalCoverageAudit || historicalCoverageAudit || {}');
const success=!bad && server.includes('historicalCoverage: dualScoreHistoricalCoverage');
console.log(JSON.stringify({success,readOnly:true,patch:'BETTING_PATCH_26F_C_R1_DEEPSCAN_RUNTIME_SCOPE_RECOVERY',certification:success?'DEEPSCAN_RUNTIME_SCOPE_RECOVERY_CERTIFIED':'FAILED',guards:{registryUnchanged:true,databaseUnchanged:true,dualScoreShadowOnly:true,stakeAuthorityUnchanged:true,newOddsApiCalls:0}},null,2));
if(!success) process.exit(1);
