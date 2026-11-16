'use strict';
const assert=require('assert'); const fs=require('fs'); const path=require('path');
const root=path.join(__dirname,'..'); const a=fs.readFileSync(path.join(root,'public','app.js'),'utf8'); const b=fs.readFileSync(path.join(root,'backend','public','app.js'),'utf8');
const checks=[
 ['frontend copies byte-identical',a===b],
 ['coverage audit preserved in compact payload',a.includes('historicalCoverageAudit: (() =>')],
 ['historical coverage resolver available',a.includes('function calcioHistoricalCoverageFromBet')],
 ['coverage status rendered',a.includes('Copertura storica')],
 ['reason code rendered',a.includes('Motivo storico')],
 ['home and away sources rendered',a.includes('Fonti storico H/A')],
 ['promoted prior rendered',a.includes('Promoted-team prior')]
];
for(const [name,ok] of checks) assert.ok(ok,name);
console.log(JSON.stringify({success:true,checks:checks.map(([name,ok])=>({name,ok}))},null,2));
