'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'backend/server.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'backend/runtimeDiagnostics.js'),'utf8');
const checks=[
 ['imports reliability calibration module',server.includes("require('./calcioReliabilityCalibration')")],
 ['generic runtime diagnostics endpoint',server.includes("app.get('/api/runtime-diagnostics'")],
 ['runtime scope filter used',server.includes('normalizeDiagnosticScope')],
 ['portfolio report exposes reliability calibration',server.includes('reliabilityCalibration')],
 ['dedicated reliability endpoint',server.includes("/api/calcio/analytics/reliability-calibration")],
 ['runtime diagnostics v2',runtime.includes('RUNTIME_DIAGNOSTICS_V2_PATCH26FD')],
 ['tail read implemented',runtime.includes('function readTailText')],
 ['legacy compatibility declared',runtime.includes('RUNTIME_DIAGNOSTICS_V1_PATCH5')],
 ['no odds api integration added',!server.includes('PATCH26FD_ODDS_API')]
];
checks.forEach(([name,ok])=>assert.ok(ok,name));
console.log(JSON.stringify({success:true,checks:checks.map(([name,ok])=>({name,ok}))},null,2));
