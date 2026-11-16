#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:'.');
const checks=[];function add(name,ok,details={}){checks.push({name,ok:Boolean(ok),details});}
const pkg=require(path.join(root,'package.json'));const registry=require(path.join(root,'backend','tennisPatchRegistry.js'));
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');const index=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
add('versioni Patch 41',pkg.version==='21.28.0'&&String(registry.TENNIS_CURRENT_PATCH_VERSION)==='41',{packageVersion:pkg.version,registry:registry.TENNIS_CURRENT_PATCH_VERSION});
add('layout gerarchico',index.includes('"global global"')&&index.includes('"rolling rolling"')&&index.includes('"deepscan deepscan"')&&index.includes('"quality quality"'));
add('DeepScan tabella orizzontale',app.includes('step41-deepscan-card')&&app.includes('step41-performance-table'));
add('Quality Gate allineata',app.includes('step41-quality-card')&&app.includes('Operativo W/L'));
add('rolling tabella unica',app.includes('step41-rolling-table')&&app.includes('Flat teorico')&&app.includes('CLV verificato'));
add('secondarie verticali',app.includes('step41-calibration-table')&&app.includes('Resa per Campionato'));
add('note audit leggere',app.includes('step41-audit-chip')&&app.includes('Audit = stake 0, escluso dal ROI'));
add('nessuna autorità business',!app.includes('PATCH41_PROBABILITY_AUTHORITY')&&!app.includes('PATCH41_STAKE_AUTHORITY')&&!app.includes('PATCH41_SETTLEMENT_AUTHORITY'));
let db={exists:false,sha256:null,size:null};const dbPath=path.join(root,'backend','database_betting.db');if(fs.existsSync(dbPath)){const buf=fs.readFileSync(dbPath);db={exists:true,sha256:crypto.createHash('sha256').update(buf).digest('hex'),size:buf.length};}
add('database presente e non gestito dalla patch',db.exists,db);
const errors=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:errors.length===0,patch:'TENNIS_PATCH_41_TRADING_DASHBOARD_READABILITY_RESPONSIVE_TABLES',checks:checks.length,errors:errors.length,details:checks,databaseReadOnly:true},null,2));if(errors.length)process.exit(1);
