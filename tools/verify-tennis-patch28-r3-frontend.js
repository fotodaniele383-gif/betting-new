'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');const root=path.resolve(__dirname,'..');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8'),idx=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const syntax=rel=>cp.spawnSync(process.execPath,['--check',path.join(root,rel)],{encoding:'utf8'}).status===0;
const analyze=app.slice(app.indexOf("$('analyzeForm')"),app.indexOf('function normalizeTennisOperationalReport'));
const checks=[
 ['public app sintassi',syntax('public/app.js')],
 ['backend app sintassi',syntax('backend/public/app.js')],
 ['app byte-identiche',sha('public/app.js')===sha('backend/public/app.js')],
 ['index byte-identici',sha('public/index.html')===sha('backend/public/index.html')],
 ['index carica R3',idx.includes('app.js?v=patch28-r3-runtime-diagnostics-scope-timeout-state-alignment')],
 ['analisi usa diagnostics',analyze.includes('showRuntimeDiagnostic')&&!analyze.includes("alert('Errore Server:")],
 ['operazioni Tennis non partono in Calcio',app.includes('if (activeSport !== SPORT.TENNIS) return null;')],
 ['refresh operativo limitato',app.includes('loaders.slice(index, index + 4)')]
];const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks:results.length,results},null,2));process.exit(bad.length?1:0);
