'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const pub=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const back=fs.readFileSync(path.join(root,'backend/public/app.js'),'utf8');
const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const checks=[
 ['frontend copies byte-identical',hash(pub)===hash(back)],
 ['trading has reliability column',pub.includes("key: 'ai_reliability'")],
 ['trading has canonical reliability resolver',pub.includes('function resolveCalcioAiReliability')],
 ['trading explains score is not win probability',pub.includes('non è probabilità di vincita')],
 ['portfolio has reliability calibration panel',pub.includes('portfolioReliabilityCalibrationPanel')],
 ['portfolio renders Wilson interval',pub.includes("hitRateCi95")],
 ['portfolio renders validation confidence',pub.includes('Confidenza validazione')],
 ['runtime UI uses generic scoped endpoint',pub.includes('/api/runtime-diagnostics?scope=')],
 ['runtime info uses console.info',pub.includes("console.info('[PATCH5 RUNTIME DIAGNOSTICS]'")],
 ['post-commit persisted stake authority restored',pub.includes('persistedStakeAuthority')],
 ['post-commit persisted data quality restored',pub.includes('persistedDataQuality')],
 ['index marks patch26fd',index.includes('data-patch26fd-reliability-calibration="true"')]
];
checks.forEach(([name,ok])=>assert.ok(ok,name));
console.log(JSON.stringify({success:true,checks:checks.map(([name,ok])=>({name,ok}))},null,2));
