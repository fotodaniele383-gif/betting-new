'use strict';
const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');const server=fs.readFileSync(path.join(root,'backend/server.js'),'utf8');const mod=require('../backend/aiOutcomeBandPerformance');
const checks=[
 ['route analytics presente',server.includes("app.get('/api/analytics/ai-outcome-bands'")],
 ['query solo WON LOST',server.includes("IN ('WON','LOST')")],
 ['query esclude conflitti',server.includes('paper_result_conflict,0) = 0')],
 ['query esclude multiple',server.includes("NOT LIKE '%MULTI%'")],
 ['sport query limitato',server.includes("=== 'TENNIS' ? 'TENNIS' : 'CALCIO'")],
 ['builder read-only invocato',server.includes('buildAiOutcomeBandPerformance(rows, { sport })')],
 ['modulo esporta nove fasce',mod.BAND_DEFINITIONS.length===9],
 ['nessuna autorita modificata',mod.buildAiOutcomeBandPerformance([],{sport:'CALCIO'}).safeguards.stakeAuthorityChanged===false]
].map(([name,ok])=>({name,ok:Boolean(ok)}));const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks:checks.length,results:checks},null,2));process.exit(failed.length?1:0);
