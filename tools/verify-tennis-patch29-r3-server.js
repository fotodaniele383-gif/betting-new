#!/usr/bin/env node
'use strict';const fs=require('fs'),path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'..');const s=fs.readFileSync(path.join(root,'backend','server.tennis.js'),'utf8');const checks=[];function c(n,f){try{f();checks.push({name:n,ok:true})}catch(e){checks.push({name:n,ok:false,error:e.message})}}
c('import gate',()=>assert(s.includes("const tennisPrematchCaptureGate = require('./tennisPrematchCaptureGate');")));
c('capture timestamp condiviso',()=>assert(s.includes('capturedAt: captureAt')));
c('gate prima snapshot',()=>assert(s.indexOf('PREMATCH_CAPTURE_GATE_START')<s.indexOf('capturePredictionSnapshot(db, persistedRow')));
c('gate persiste audit columns',()=>assert(s.includes('prematch_capture_gate_version=?')&&s.includes('prematch_capture_gate_lead_ms=?')));
c('block code specifico',()=>assert(s.includes("'BLOCKED_PATCH29_R3_PREMATCH_CAPTURE_GATE'")));
c('semantic health runtime',()=>assert(s.includes('buildComponentHealthSemantics(components)')));
c('optional/raw components non usati per status globale',()=>assert(!s.includes("const hasError = componentValues.some")));
c('endpoint health gate',()=>assert(s.includes("router.get('/prematch-capture-gate-health'")));
c('health check R3',()=>assert(s.includes("TENNIS_RUNTIME_HEALTH_CONTRACT_V2_PATCH29_R3")));
const bad=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks,passed:checks.length-bad.length,failed:bad.length},null,2));process.exit(bad.length?1:0);
