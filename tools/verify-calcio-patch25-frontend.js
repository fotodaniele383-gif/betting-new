'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const PATCH='BETTING_PATCH_25_CALCIO_DEEPSCAN_RUNTIME_CONSISTENCY_RECOVERY';
const app=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8');
const mirror=fs.readFileSync(path.resolve(__dirname,'../backend/public/app.js'),'utf8');
assert.equal(app,mirror,'Frontend mirrors differ');
const markers=[
  'let deepScanApiSucceeded = false',
  "if (deepScanApiSucceeded) badgeEl.innerHTML = '⚠️ UI'",
  'index.operationalStake >= 2',
  "const ratePct = resolvedSample > 0 ? pct(evidence.winRatePct) : 'N/D'",
  "const ciText = resolvedSample > 0",
  'calcio_deepscan_timing_advisory',
  'STRUTTURALMENTE CERTIFICATA · PT ASSENTE'
];
for(const marker of markers)assert(app.includes(marker),`Missing frontend marker: ${marker}`);
assert(app.includes('applyCalcioDeepScanStakeResult'));
assert(app.includes("predictionIndex.status = finalEligible ? 'UNIFIED_INDEX_STAKE_AUTHORIZED' : 'UNIFIED_INDEX_NO_STAKE'"));
console.log(JSON.stringify({success:true,patch:PATCH,mirrorsAligned:true,bytes:Buffer.byteLength(app),sha256:require('crypto').createHash('sha256').update(app).digest('hex'),markers},null,2));
