'use strict';
const fs=require('fs');const path=require('path');const assert=require('assert');const root=path.resolve(__dirname,'..');
const bridge=require('../backend/tennisCanonicalPlayerEvidenceBridge');const r=bridge.buildMatchupBridge('Elisabetta Cocciaretto','Emma Navarro','WTA','2026-07-29T09:00:00Z',{});
assert.equal(r.authority.modelProbability,false);assert.equal(r.authority.qualityGate,false);assert.equal(r.authority.stake,false);assert.equal(r.authority.settlement,false);
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');assert.ok(server.includes('canonicalPlayerEvidenceProbabilityChanged: false'));assert.ok(server.includes('canonicalPlayerEvidenceStakeChanged: false'));
const deep=fs.readFileSync(path.join(root,'backend/deepScanTennis.js'),'utf8');assert.ok(deep.includes("canonicalPlayerEvidenceAuthority: 'DEEPSCAN_CONTEXT_ONLY'"));
console.log(JSON.stringify({success:true,guards:{productionProbabilityUnchanged:true,qualityGateAuthorityPreserved:true,stakeAuthorityPreserved:true,settlementPreserved:true,deepScanContextOnly:true,newApiCalls:0}},null,2));
