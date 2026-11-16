#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const checks=[];const add=(name,ok,details={})=>checks.push({name,ok:Boolean(ok),details});const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const pApp=path.join(root,'public','app.js'),bApp=path.join(root,'backend','public','app.js'),pIdx=path.join(root,'public','index.html'),bIdx=path.join(root,'backend','public','index.html');
add('frontend files presenti',[pApp,bApp,pIdx,bIdx].every(fs.existsSync));
add('app mirror byte-identici',hash(pApp)===hash(bApp),{public:hash(pApp),backend:hash(bApp)});
add('index mirror byte-identici',hash(pIdx)===hash(bIdx),{public:hash(pIdx),backend:hash(bIdx)});
const app=fs.readFileSync(pApp,'utf8'),idx=fs.readFileSync(pIdx,'utf8');
add('cache buster Patch44 o successivo',/app\.js\?v=patch(?:44|4[5-9]|[5-9]\d+)-[a-z0-9-]+/.test(idx));
add('marker atomico',app.includes("STEP44_TRADING_DOM_ATOMIC_WRAP_VERSION = 'TENNIS_TRADING_DOM_ATOMIC_WRAP_V1_PATCH44'"));
add('anchor pre-detach',app.includes('const originalNextSibling = card.nextSibling;')&&app.includes('step44InsertDetachedWrapper(dashboard, details, originalNextSibling);'));
add('audit usa percorso atomico',app.includes('const originalNextSibling = directAudit.nextSibling;')&&app.includes('step44InsertDetachedWrapper(summaryBox, wrapper, originalNextSibling);'));
add('replaceChild vulnerabile rimosso',!app.includes('dashboard.replaceChild(details, card)')&&!app.includes('summaryBox.replaceChild(wrapper, directAudit)'));
add('error boundary attivo',app.includes('function step44SafelyEnhanceTradingDashboard')&&app.includes("dataset.step44EnhancementStatus = 'DEGRADED_FALLBACK'")&&app.includes('step44SafelyEnhanceTradingDashboard(summaryBox);'));
for(const f of [pApp,bApp]){const r=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});add(`sintassi ${path.relative(root,f)}`,r.status===0,{stderr:r.stderr})}
const ids=[...idx.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]),dup=[...new Set(ids.filter((v,n)=>ids.indexOf(v)!==n))];add('ID HTML univoci',dup.length===0,{duplicates:dup});
add('nessuna dipendenza frontend nuova',!app.includes("require('jsdom')")&&!app.includes('window.React'));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:failed.length===0,patch:'44',checks,errors:failed.length},null,2));if(failed.length)process.exit(1);
