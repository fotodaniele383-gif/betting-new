'use strict';
const fs=require('fs');const path=require('path');const assert=require('assert');const root=path.resolve(__dirname,'..');
const a=fs.readFileSync(path.join(root,'public/app.js'));const b=fs.readFileSync(path.join(root,'backend/public/app.js'));assert.deepEqual(a,b);const text=a.toString('utf8');
const checks=[text.includes('canonicalStatus'),text.includes('tennis_canonical_player_evidence_json'),text.includes('CANONICAL ${canonicalStatus.replaceAll'),!text.includes('DR Est.: 1.00')];
console.log(JSON.stringify({success:checks.every(Boolean),checks},null,2));if(!checks.every(Boolean))process.exit(1);
