#!/usr/bin/env node
'use strict';
const cp=require('child_process'),path=require('path'),fs=require('fs');const root=path.resolve(__dirname,'..');
const commands=['tools/test-tennis-patch28-all.js','tools/test-tennis-patch28-forward-safety.js'];
const results=commands.map(file=>{const r=cp.spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});return{file,ok:r.status===0,exitCode:r.status,stdout:String(r.stdout||'').slice(0,500)}});
const deep=fs.readFileSync(path.join(root,'backend','deepScanTennis.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
results.push({file:'PATCH27_STATIC_PERFORMANCE_GUARD',ok:deep.includes('TENNIS_DEEPSCAN_RAM_CACHE_V1_PATCH27')&&deep.includes('inFlight')&&app.includes('const pacingMs = sport === SPORT.TENNIS ? 150 : 4000')});
const out={success:results.every(x=>x.ok),results};console.log(JSON.stringify(out,null,2));process.exitCode=out.success?0:1;
