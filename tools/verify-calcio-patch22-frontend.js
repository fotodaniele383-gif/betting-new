'use strict';
const fs=require('fs');const path=require('path');const assert=require('assert');const crypto=require('crypto');
const a=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8');const b=fs.readFileSync(path.resolve(__dirname,'../backend/public/app.js'),'utf8');const h=fs.readFileSync(path.resolve(__dirname,'../public/index.html'),'utf8');const hb=fs.readFileSync(path.resolve(__dirname,'../backend/public/index.html'),'utf8');
assert.equal(a,b);assert.equal(h,hb);for(const m of ['Pot. +€','Gap modello/mercato','Quota netta eseguibile','Finalizzazione AI','consenso mercato + rischio quota'])assert(a.includes(m),m);assert(h.includes('Profitto pot.'));
console.log(JSON.stringify({success:true,patch:'BETTING_PATCH_22_CALCIO_AI_FINALIZATION_CONSENSUS_RISK_GUARDS',mirrorsAligned:true,appSha256:crypto.createHash('sha256').update(a).digest('hex'),htmlSha256:crypto.createHash('sha256').update(h).digest('hex')},null,2));
