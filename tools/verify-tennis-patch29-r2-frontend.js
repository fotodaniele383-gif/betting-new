'use strict';const fs=require('fs'),path=require('path'),crypto=require('crypto');const root=path.resolve(__dirname,'..');const read=r=>fs.readFileSync(path.join(root,r),'utf8'),sha=r=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,r))).digest('hex');const app=read('public/app.js'),idx=read('public/index.html');const checks=[
['app copies synchronized',sha('public/app.js')===sha('backend/public/app.js')],['index copies synchronized',sha('public/index.html')===sha('backend/public/index.html')],
['R2 marker app',app.includes('PATCH29_R2_SETTLEMENT_UPDATE_AUDIT_RUNTIME_TRUTH')],['R2 marker body',idx.includes('data-patch29-r2-settlement-update-audit-truth="true"')],
['cache R2',idx.includes('app.js?v=patch29-r2-settlement-update-audit-truth')],['DB title',app.includes('Aggiornamento database settlement non riuscito')],
['weak source title',app.includes('Fonte debole · settlement non applicato')],['manual protected title',app.includes('Settlement manuale protetto')],
['forward detail counts',app.includes('manualBookmakerReview, manualIdentityReview, clvOnlyDegraded')]
].map(([name,ok])=>({name,ok}));const bad=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks,failed:bad.length},null,2));process.exit(bad.length?1:0);
