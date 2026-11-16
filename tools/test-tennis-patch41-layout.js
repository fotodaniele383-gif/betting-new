#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:'.');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const index=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const checks=[];function check(ok,name,details={}){checks.push({name,ok:Boolean(ok),details});if(!ok)process.exitCode=1;}
check(app.includes('PATCH41_TRADING_DASHBOARD_READABILITY_RESPONSIVE_TABLES'),'marker app');
check(index.includes('PATCH41_TRADING_DASHBOARD_READABILITY_RESPONSIVE_TABLES'),'marker index');
check(index.includes('grid-template-areas:')&&index.includes('"deepscan deepscan"')&&index.includes('"quality quality"'),'DeepScan e Quality full width');
check(app.includes('step41-performance-table')&&app.includes('Segnale W/L')&&app.includes('Operativo W/L'),'matrice performance orizzontale');
check(app.includes('step41-rolling-table')&&app.includes('Ultime 200 righe attive')&&app.includes('CLV verificato'),'ultime 200 tabella unica');
check(app.includes('step41-calibration-card')&&app.includes('step41-league-card'),'calibrazione e campionato verticali');
check(app.indexOf('${rollingHtml}${calibrationHtml}${leagueHtml}${dsHtml}${qualityHtml}')>0,'ordine informativo');
check(app.includes('step41-audit-chip')&&!app.includes('Counterfactual/Audit: ${stakeZero} match'),'warning audit compresso');
check(index.includes('@media (max-width: 900px)')&&index.includes('"calibration"')&&index.includes('"league"'),'responsive stack');
check(index.includes('overflow-x:auto')&&app.includes('tabindex="0"'),'overflow accessibile');
check(index.includes('app.js?v=patch41-trading-dashboard-readability-responsive-tables')||index.includes('app.js?v=patch42-trading-accordion-icon-disclosure'),'cache buster Patch41 o successore Patch42');
check(!index.includes('app.js?v=patch40-deepscan-taxonomy-reporting-truth-h2h-roi-ui'),'cache buster Patch40 non attivo');
console.log(JSON.stringify({success:checks.every(x=>x.ok),patch:'TENNIS_PATCH_41_TRADING_DASHBOARD_READABILITY_RESPONSIVE_TABLES',checks},null,2));
if(process.exitCode)process.exit(process.exitCode);
