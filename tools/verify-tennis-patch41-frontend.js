#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:'.');
const checks=[];function check(ok,name,details={}){checks.push({name,ok:Boolean(ok),details});if(!ok)process.exitCode=1;}
const pApp=path.join(root,'public','app.js'),bApp=path.join(root,'backend','public','app.js');
const pIdx=path.join(root,'public','index.html'),bIdx=path.join(root,'backend','public','index.html');
const read=p=>fs.readFileSync(p,'utf8');const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
check(fs.existsSync(pApp)&&fs.existsSync(bApp)&&fs.existsSync(pIdx)&&fs.existsSync(bIdx),'frontend files present');
check(hash(pApp)===hash(bApp),'app copies byte-identical',{public:hash(pApp),backend:hash(bApp)});
check(hash(pIdx)===hash(bIdx),'index copies byte-identical',{public:hash(pIdx),backend:hash(bIdx)});
const app=read(pApp),idx=read(pIdx);
check(idx.includes('patch41-trading-dashboard-readability-responsive-tables')||idx.includes('patch42-trading-accordion-icon-disclosure'),'active cache revision Patch41 o successore');
check(app.includes('step41-deepscan-card')&&app.includes('step41-quality-card'),'full-width cards linked');
check(idx.includes('.step41-performance-table { min-width:980px; }'),'desktop table readability');
check(idx.includes('.step41-table-scroll:focus-visible'),'keyboard focus');
const syntax=cp.spawnSync(process.execPath,['--check',pApp],{encoding:'utf8'});
check(syntax.status===0,'app.js syntax',{stderr:syntax.stderr});
const ids=[...idx.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);const dup=[...new Set(ids.filter((v,i)=>ids.indexOf(v)!==i))];
check(dup.length===0,'HTML IDs univoci',{duplicates:dup});
check(!/grid-template-columns:\s*minmax\(280px,\s*0\.9fr\).*minmax\(420px,\s*1\.65fr\)/s.test(idx.slice(idx.indexOf('PATCH41_TRADING_DASHBOARD'),idx.indexOf('/PATCH41_TRADING_DASHBOARD'))),'Patch41 non reintroduce quattro colonne');
console.log(JSON.stringify({success:checks.every(x=>x.ok),checks},null,2));if(process.exitCode)process.exit(process.exitCode);
