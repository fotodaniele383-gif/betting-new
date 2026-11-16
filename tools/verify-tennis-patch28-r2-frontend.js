'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');const root=path.resolve(__dirname,'..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const run=p=>cp.spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});
const appRun=run('public/app.js'),backRun=run('backend/public/app.js');const idx=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const checks=[
 ['public app sintassi',appRun.status===0],['backend app sintassi',backRun.status===0],
 ['app byte-identiche',sha('public/app.js')===sha('backend/public/app.js')],
 ['index byte-identici',sha('public/index.html')===sha('backend/public/index.html')],
 ['index carica R2',idx.includes('app.js?v=patch28-r2-ui-navigation-stability')]
];const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);
console.log(JSON.stringify({success:!bad.length,checks:results.length,results},null,2));process.exit(bad.length?1:0);
