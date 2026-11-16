#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const checks=[];function check(ok,name,details={}){checks.push({name,ok:Boolean(ok),details});if(!ok)process.exitCode=1;}
const pApp=path.join(root,'public','app.js'),bApp=path.join(root,'backend','public','app.js');
const pIdx=path.join(root,'public','index.html'),bIdx=path.join(root,'backend','public','index.html');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
check([pApp,bApp,pIdx,bIdx].every(fs.existsSync),'frontend files present');
check(hash(pApp)===hash(bApp),'app copies byte-identical',{public:hash(pApp),backend:hash(bApp)});
check(hash(pIdx)===hash(bIdx),'index copies byte-identical',{public:hash(pIdx),backend:hash(bIdx)});
const app=fs.readFileSync(pApp,'utf8'),idx=fs.readFileSync(pIdx,'utf8');
check((/patch(?:4[2-9]|[5-9]\d+)-/.test(idx)),'active cache revision Patch42 o successiva');
check(idx.includes('title="Espandi tutte le sezioni"')&&idx.includes('title="Comprimi tutte le sezioni"'),'tooltip azioni globali');
check(idx.includes('aria-label="Apri Grafici Base"')&&idx.includes('aria-label="Esporta CSV"'),'nomi accessibili toolbar');
check(idx.includes('grid-template-columns:36px minmax(180px,1fr) auto 30px'),'summary desktop leggibile');
check(idx.includes('.step42-panel-body .step41-table-scroll'),'tabelle preservate dentro disclosure');
const syntax=cp.spawnSync(process.execPath,['--check',pApp],{encoding:'utf8'});check(syntax.status===0,'app.js syntax',{stderr:syntax.stderr});
const ids=[...idx.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);const dup=[...new Set(ids.filter((v,j)=>ids.indexOf(v)!==j))];check(dup.length===0,'HTML IDs univoci',{duplicates:dup});
check(!idx.includes('app.js?v=patch41-trading-dashboard-readability-responsive-tables'),'cache Patch41 non attiva');
check(app.includes('step42WriteAccordionState')&&!app.includes('database_betting.db'),'persistenza soltanto browser');
console.log(JSON.stringify({success:checks.every(x=>x.ok),checks},null,2));if(process.exitCode)process.exit(process.exitCode);
