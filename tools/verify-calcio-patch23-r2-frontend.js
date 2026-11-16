'use strict';
const fs=require('fs');const path=require('path');const assert=require('assert');const crypto=require('crypto');
const root=path.resolve(__dirname,'..');const a=fs.readFileSync(path.join(root,'public/app.js'),'utf8');const b=fs.readFileSync(path.join(root,'backend/public/app.js'),'utf8');
assert.equal(a,b,'Frontend mirrors not aligned');
for(const marker of ['CALCIO_DEEPSCAN_COMPACT_PAYLOAD_VERSION','buildCompactCalcioDeepScanPayload','compactCalcioDeepScanExtData','clientPayloadBytes','⚠️ Parziale','❌ Payload']) assert(a.includes(marker),marker);
const payloadBlock=a.slice(a.indexOf('function buildCompactCalcioDeepScanPayload'),a.indexOf('window.processDeepScanQueue'));
assert(!payloadBlock.includes('...(bet.extData || {})'),'Full extData spread is forbidden');
for(const forbidden of ['understatData','teamSnapshots','scoreDistribution','marketSelectionAudit']) assert(!payloadBlock.includes(`payload.extData.${forbidden}`),forbidden);
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_23_R2_CALCIO_DEEPSCAN_COMPACT_PAYLOAD_RUNTIME_RECOVERY',mirrorsAligned:true,bytes:Buffer.byteLength(a),sha256:crypto.createHash('sha256').update(a).digest('hex'),markers:6},null,2));
