#!/usr/bin/env node
'use strict';const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');const root=path.resolve(__dirname,'..');let checks=0;function ok(v,m){assert.ok(v,m);checks++;}
const a=fs.readFileSync(path.join(root,'public','app.js'));const b=fs.readFileSync(path.join(root,'backend','public','app.js'));ok(a.equals(b),'app mirror');
const i1=fs.readFileSync(path.join(root,'public','index.html'));const i2=fs.readFileSync(path.join(root,'backend','public','index.html'));ok(i1.equals(i2),'index mirror');
const text=i1.toString();ok(text.includes('app.js?v=patch48-r5-continuous-clv-ledger-onboarding') || text.includes('app.js?v=patch49-analysis-memory-prediction-index-bands-ai-reliability') || text.includes('app.js?v=patch50-health-check-alignment-prediction-index-collapse') || text.includes('app.js?v=patch51-settlement-exception-queue-idempotent-notifications'),'cache revision Patch48 o successivo');
const app=a.toString();ok(app.includes('tennis_deepscan_canonical_action'),'canonical DeepScan');ok(app.includes('Proposta DS canonica'),'canonical label');
console.log(JSON.stringify({success:true,checks,sha256:crypto.createHash('sha256').update(a).digest('hex')}));
