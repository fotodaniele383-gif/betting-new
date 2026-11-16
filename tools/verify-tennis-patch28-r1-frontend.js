#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');const root=path.resolve(__dirname,'..');
const a=fs.readFileSync(path.join(root,'public/app.js'),'utf8'),b=fs.readFileSync(path.join(root,'backend/public/app.js'),'utf8');
const ia=fs.readFileSync(path.join(root,'public/index.html'),'utf8'),ib=fs.readFileSync(path.join(root,'backend/public/index.html'),'utf8');
const syntax=cp.spawnSync(process.execPath,['--check',path.join(root,'public/app.js')],{encoding:'utf8'});
const lifecycleLoader=(a.match(/async function loadTennisForwardLifecycle\(\) \{[\s\S]*?\n\}/)||[''])[0];
const results=[
{name:'frontend syntax',ok:syntax.status===0},
{name:'copie app sincronizzate',ok:a===b},
{name:'copie index sincronizzate',ok:ia===ib},
{name:'HTTP 200 con drift non diventa indisponibile',ok:lifecycleLoader.includes('if (!response.ok)')&&!lifecycleLoader.includes('payload.success === false')},
{name:'drift mostrato come watchdog disponibile',ok:a.includes('Watchdog disponibile: rilevati')},
{name:'cache buster R1',ok:ia.includes('patch28-r1-lifecycle-atp-ledger-recovery')}
];const out={success:results.every(x=>x.ok),results};console.log(JSON.stringify(out,null,2));process.exitCode=out.success?0:1;
