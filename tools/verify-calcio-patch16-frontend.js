'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const assert = require('assert');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const a = fs.readFileSync(path.join(root,'public','app.js')); const b = fs.readFileSync(path.join(root,'backend','public','app.js'));
assert.deepEqual(a,b,'Frontend mirrors differ'); const text=a.toString('utf8');
for(const marker of ['applyCalcioDeepScanStakeResult','matchExposureKey: bet.match_exposure_key','stakeReconciliation','calcio_operational_stake = operational','16.0_PATCH16_FORCED_STAKE_AUTHORITY_RECONCILIATION']) assert(text.includes(marker),`Missing frontend marker: ${marker}`);
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_16_FORCED_STAKE_AUTHORITY_RECONCILIATION',sha256:crypto.createHash('sha256').update(a).digest('hex'),mirrorBytes:a.length,markers:5},null,2));
