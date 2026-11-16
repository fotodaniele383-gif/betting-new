'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const sha=rel=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,rel))).digest('hex');
const app=read('public/app.js'),backApp=read('backend/public/app.js'),idx=read('public/index.html'),backIdx=read('backend/public/index.html'),server=read('backend/server.tennis.js'),capture=read('backend/tennisForwardCaptureHealth.js'),progression=read('backend/tennisProgramProgressionAudit.js');
const pkg=JSON.parse(read('package.json'));
const registry=require(path.join(root,'backend','tennisPatchRegistry.js'));
const globalRegistry=require(path.join(root,'backend','calcioPatchRegistry.js'));
const checks=[
 ['registry Tennis 28 preservato',String(registry.TENNIS_CURRENT_PATCH_VERSION)==='28'],
 ['registry globale 37 preservato',String(globalRegistry.CALCIO_CURRENT_PATCH_VERSION)==='37'],
 ['package 21.13.0 preservato',pkg.version==='21.13.0'],
 ['marker R3 frontend presente',app.includes('TENNIS_PATCH28_R3_RUNTIME_DIAGNOSTICS_SCOPE_ODDS_TIMEOUT_DERIVED_STATE_ALIGNMENT')],
 ['scope Runtime Diagnostics dinamico',app.includes('getRuntimeDiagnosticScope')&&app.includes('resetRuntimeDiagnosticForSport')&&app.includes('scope: getRuntimeDiagnosticScope()')],
 ['popup errore analisi rimosso',!app.slice(app.indexOf("$('analyzeForm')"),app.indexOf('function normalizeTennisOperationalReport')).includes("alert('Errore Server:")],
 ['timeout Tennis configurabile',server.includes('TENNIS_ODDS_API_TIMEOUT_MS')&&server.includes('TENNIS_ODDS_API_CATALOG_TIMEOUT_MS')],
 ['risultato provider parziale preservato',server.includes('partialProviderFailure')&&server.includes('PARTIAL')||server.includes('partial: partialProviderFailure')],
 ['orchestratore stati derivati presente',server.includes('TENNIS_PATCH28_R3_DERIVED_STATE_ORCHESTRATOR_V1')&&server.includes('runPatch28R3DerivedStateReconcile')],
 ['settlement oltre SLA distinto da errore strutturale',capture.includes('EVIDENCE_OVERDUE')&&capture.includes('structuralBlocked')&&capture.includes('runtimeSeverity')],
 ['letture centro Tennis a batch',app.includes('loaders.slice(index, index + 4)')],
 ['frontend app sincronizzati',sha('public/app.js')===sha('backend/public/app.js')],
 ['frontend index sincronizzati',sha('public/index.html')===sha('backend/public/index.html')],
 ['cache buster R3 attivo',idx.includes('app.js?v=patch28-r3-runtime-diagnostics-scope-timeout-state-alignment')],
 ['progression audit R3 attivo',progression.includes('TENNIS_PROGRAM_PROGRESSION_AUDIT_V16_PATCH28_R3')],
 ['script R3 presenti',Boolean(pkg.scripts?.['verify:tennis:patch28:r3']&&pkg.scripts?.['audit:tennis:patch28:r3']&&pkg.scripts?.['reconcile:tennis:patch28:r3'])],
 ['copie index byte identiche',idx===backIdx]
];
const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)}));const failed=results.filter(x=>!x.ok);
console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_28_R3_RUNTIME_DIAGNOSTICS_SCOPE_ODDS_TIMEOUT_DERIVED_STATE_ALIGNMENT',checks:results.length,passed:results.length-failed.length,failed:failed.length,results},null,2));
process.exit(failed.length?1:0);
