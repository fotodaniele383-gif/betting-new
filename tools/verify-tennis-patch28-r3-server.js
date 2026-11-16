'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');const root=path.resolve(__dirname,'..');const server=fs.readFileSync(path.join(root,'backend','server.tennis.js'),'utf8');
const syntax=rel=>cp.spawnSync(process.execPath,['--check',path.join(root,rel)],{encoding:'utf8'}).status===0;
const checks=[
 ['server Tennis sintassi',syntax('backend/server.tennis.js')],
 ['capture health sintassi',syntax('backend/tennisForwardCaptureHealth.js')],
 ['reconcile R3 sintassi',syntax('backend/reconcileTennisPatch28R3.js')],
 ['orchestratore unico R3',server.includes('runPatch28R3DerivedStateReconcile')&&!server.includes('runPatch27CohortDerivedStateReconcile')],
 ['ordine lifecycle poi coorti',server.indexOf('reconcileForwardLifecycle(db')<server.indexOf('reconcileForwardCohortMaturity(db')],
 ['catalog timeout 25s',server.includes('TENNIS_ODDS_API_CATALOG_TIMEOUT_MS')&&server.includes("route: 'tennis_analyze_sports_catalog'")],
 ['timeout torneo 20s',server.includes('TENNIS_ODDS_API_TIMEOUT_MS')&&server.includes('tennis_analyze_${sport.key}')],
 ['endpoint alignment presente',server.includes("router.get('/runtime-state-alignment'")],
 ['nessuna nuova URL Odds API',!server.includes('PATCH28_R3_NEW_ODDS_API_ENDPOINT')]
];const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks:results.length,results},null,2));process.exit(bad.length?1:0);
