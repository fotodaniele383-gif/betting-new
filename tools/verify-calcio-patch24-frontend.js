'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const crypto=require('crypto');
const PATCH='BETTING_PATCH_24_CALCIO_CANONICAL_DEEPSCAN_ATOMIC_FINALIZATION';
const app=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8');
const mirror=fs.readFileSync(path.resolve(__dirname,'../backend/public/app.js'),'utf8');
assert.equal(app,mirror,'Frontend mirrors differ');
const markers=[
  'patch13NullableNumber',
  "const ratePct = resolvedSample > 0 ? pct(evidence.winRatePct) : 'N/D'",
  'applyCalcioDeepScanStakeResult',
  'prediction_visibility',
  'buildCompactCalcioDeepScanPayload',
  'CALCIO_DEEPSCAN_CLIENT_TARGET_BYTES'
];
for(const marker of markers) assert(app.includes(marker),`Missing frontend marker: ${marker}`);
console.log(JSON.stringify({success:true,patch:PATCH,mirrorsAligned:true,bytes:Buffer.byteLength(app),sha256:crypto.createHash('sha256').update(app).digest('hex'),markers},null,2));
