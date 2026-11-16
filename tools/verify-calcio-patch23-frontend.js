'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const PATCH='BETTING_PATCH_23_CALCIO_AI_DETERMINISTIC_FINALIZATION_CERTIFICATION';
const a=fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8');
const b=fs.readFileSync(path.resolve(__dirname,'../backend/public/app.js'),'utf8');
if(a!==b) throw new Error('Frontend mirrors non allineati');
const markers=['MIGLIOR PRONOSTICO CERTIFICATO','MIGLIOR MERCATO FINALIZZATO','STRUTTURALMENTE CERTIFICATA','PT ASSENTE','calcio-forecast-badge-','renderCalcioCertifiedOddsCell','Profitto potenziale'];
for(const m of markers) if(!a.includes(m)) throw new Error('Marker frontend mancante: '+m);
console.log(JSON.stringify({success:true,patch:PATCH,mirrorsAligned:true,bytes:Buffer.byteLength(a),sha256:crypto.createHash('sha256').update(a).digest('hex'),markers},null,2));
