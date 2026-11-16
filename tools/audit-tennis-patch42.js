#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const checks=[];function add(name,ok,details={}){checks.push({name,ok:Boolean(ok),details});}
const pkg=require(path.join(root,'package.json'));delete require.cache[require.resolve(path.join(root,'backend','tennisPatchRegistry.js'))];const registry=require(path.join(root,'backend','tennisPatchRegistry.js'));
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8'),index=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
add('versioni Patch 42',Number(String(pkg.version).split('.')[1])>=29&&Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=42,{packageVersion:pkg.version,registry:registry.TENNIS_CURRENT_PATCH_VERSION});
add('accordion icon-first',app.includes('TENNIS_TRADING_ACCORDION_V1_PATCH42')&&index.includes('.step42-panel-icon'));
add('default chiuso',app.includes("details.open = state[details.dataset.step42Panel] === true")&&!app.includes('details.open = true;'));
add('espansione indipendente',app.includes('step42ApplyStoredState')&&app.includes("details.addEventListener('toggle'"));
add('azioni globali',index.includes('step42ExpandAllBtn')&&index.includes('step42CollapseAllBtn'));
add('fasce AI incluse',app.includes('step42EnhanceAiOutcomePanel'));
add('nessuna autorità business',!app.includes('PATCH42_PROBABILITY_AUTHORITY')&&!app.includes('PATCH42_STAKE_AUTHORITY')&&!app.includes('PATCH42_SETTLEMENT_AUTHORITY'));
add('copie frontend uguali',crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public','app.js'))).digest('hex')===crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'backend','public','app.js'))).digest('hex'));
let db={exists:false,sha256:null,size:null};const dbPath=path.join(root,'backend','database_betting.db');if(fs.existsSync(dbPath)){const buf=fs.readFileSync(dbPath);db={exists:true,sha256:crypto.createHash('sha256').update(buf).digest('hex'),size:buf.length};}
add('database presente e read-only',db.exists,db);
const errors=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:errors.length===0,patch:'TENNIS_PATCH_42_TRADING_ACCORDION_ICON_DISCLOSURE',checks:checks.length,errors:errors.length,details:checks,databaseReadOnly:true},null,2));if(errors.length)process.exit(1);
