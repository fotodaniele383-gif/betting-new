'use strict';
const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');const server=fs.readFileSync(path.join(root,'backend','server.tennis.js'),'utf8');const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const checks=[
 ['endpoint portfolio preservato',server.includes('/api/portfolio/report')||fs.readFileSync(path.join(root,'backend','server.js'),'utf8').includes('/api/portfolio/report')],
 ['endpoint trading Tennis preservato',server.includes("router.get('/resolve_ai'")],
 ['nessuna nuova Odds API',!app.includes('PATCH28_R2_NEW_ODDS_API_CALL')],
 ['R1 ledger marker preservato',fs.readFileSync(path.join(root,'backend','oddsApiUsageLedger.js'),'utf8').includes('BETTING_PATCH_12_ODDS_API_HEADER_LEDGER_V1')],
 ['lifecycle R1 preservato',fs.readFileSync(path.join(root,'backend','tennisForwardLifecycle.js'),'utf8').includes('TENNIS_FORWARD_LIFECYCLE_V2_PATCH28_R1')]
];const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks:results.length,results},null,2));process.exit(bad.length?1:0);
