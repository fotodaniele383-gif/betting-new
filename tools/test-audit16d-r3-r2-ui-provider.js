#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const rootArg=process.argv.indexOf('--root'); const ROOT=rootArg>=0?path.resolve(process.argv[rootArg+1]):path.resolve(__dirname,'..');
const a=fs.readFileSync(path.join(ROOT,'public','app.js'),'utf8'); const b=fs.readFileSync(path.join(ROOT,'backend','public','app.js'),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex'); const details=[]; const check=(name,ok,v=null)=>details.push({name,ok:Boolean(ok),details:v});
check('Frontend mirrors byte-identical',sha(a)===sha(b),{public:sha(a),backend:sha(b)});
for(const token of ['Provider xG','xgProviderId','xgProviderStatus','xgProviderSourceClass','xgRealDataAvailable']) check(`UI contains ${token}`,a.includes(token));
check('UI preserves R3_R1 DeepScan shadow label',a.includes('Segnale DeepScan (SHADOW)'));
check('UI preserves R3_R1 operational gate label',a.includes('Gate operativo'));
const success=details.every(x=>x.ok); console.log(JSON.stringify({success,patch:'AUDIT16D_R3_R2',suite:'CALCIO_XG_PROVIDER_UI',checks:details.length,failures:details.filter(x=>!x.ok),details},null,2)); process.exit(success?0:1);
