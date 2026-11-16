'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const capture=require(path.join(root,'backend','tennisForwardCaptureHealth.js'));
const server=fs.readFileSync(path.join(root,'backend','server.tennis.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const checks=[
 ['solo settlement SLA critico = evidence overdue',capture.classifyCaptureBlock(['SETTLEMENT_SLA_CRITICAL'])==='EVIDENCE_OVERDUE'],
 ['reason strutturale = structural',capture.classifyCaptureBlock(['SNAPSHOT_MISSING'])==='STRUCTURAL'],
 ['reason misti = structural',capture.classifyCaptureBlock(['SETTLEMENT_SLA_CRITICAL','COHORT_MISSING'])==='STRUCTURAL'],
 ['nessun reason = none',capture.classifyCaptureBlock([])==='NONE'],
 ['runtime severity marker R3',capture.TENNIS_FORWARD_CAPTURE_RUNTIME_SEVERITY_VERSION==='TENNIS_FORWARD_CAPTURE_RUNTIME_SEVERITY_V2_PATCH28_R3'],
 ['timeout default superiore al legacy 12s',server.includes('process.env.TENNIS_ODDS_API_TIMEOUT_MS || 20000')&&server.includes('process.env.TENNIS_ODDS_API_CATALOG_TIMEOUT_MS || 25000')],
 ['timeout produce codice retryable',server.includes("error.code = 'TENNIS_ODDS_PROVIDER_TIMEOUT'")&&server.includes('error.retryable = true')],
 ['torneo lento non annulla altri risultati',server.includes('partialProviderFailure')&&server.includes('oddsErrors')],
 ['frontend usa diagnostica non alert',app.includes("title: data.code === 'TENNIS_ODDS_PROVIDER_TIMEOUT'")&&app.includes("scope: 'TENNIS'")],
 ['scope Calcio/Tennis non condiviso',app.includes("? 'TENNIS'")&&app.includes("? 'CALCIO'")],
 ['evidenza overdue mostrata warn',app.includes("'Settlement in attesa di evidenza verificabile'")&&app.includes("severity: structuralBlocked > 0 ? 'ERROR' : 'WARN'")],
 ['endpoint alignment read-only',server.includes("router.get('/runtime-state-alignment'")&&server.includes('readOnly: true')]
];
const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);
console.log(JSON.stringify({success:bad.length===0,patch:'TENNIS_PATCH_28_R3',checks:results.length,results},null,2));process.exit(bad.length?1:0);
