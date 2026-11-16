#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const i=process.argv.indexOf('--root');
const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const index=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const checks=[];
function check(ok,name,details={}){checks.push({name,ok:Boolean(ok),details});if(!ok)process.exitCode=1;}
check(app.includes('PATCH42_TRADING_ACCORDION_ICON_DISCLOSURE'),'marker app');
check(index.includes('PATCH42_TRADING_ACCORDION_ICON_DISCLOSURE'),'marker index');
check(app.includes('STEP42_TRADING_ACCORDION_STORAGE_KEY'),'stato locale separato');
check(app.includes("details.className = `step42-accordion")&&app.includes("details.dataset.step42Panel"),'details nativi per sezione');
check(app.includes("details.open = state[details.dataset.step42Panel] === true"),'chiuso di default e restore esplicito');
check(app.includes('step42EnhanceTradingDashboard(summaryBox)'),'dashboard trasformata dopo render');
check(app.includes('step42EnhanceAiOutcomePanel(panel)'),'matrice AI comprimibile');
check(index.includes('step42ExpandAllBtn')&&index.includes('step42CollapseAllBtn'),'azioni espandi/comprimi');
check(index.includes('aria-label="Apri Grafici Base"')&&index.includes('aria-label="Esporta CSV"'),'azioni icon-only accessibili');
check(index.includes('details.step42-accordion > summary')&&index.includes('summary::-webkit-details-marker'),'summary compatto');
check(index.includes('.step42-summary-kpis')&&index.includes('@media (max-width:900px)'),'KPI compatti responsive');
check(app.includes("['step55-exposure-card', 'exposure'")&&app.includes("['step41-deepscan-card', 'deepscan'")&&app.includes("['step41-quality-card', 'quality'"),'pannelli principali mappati');
check(app.includes("id: 'market-audit'")&&app.includes("dataset.step42Panel = 'ai-probability-bands'"),'audit e fasce AI inclusi');
check((/app\.js\?v=patch(?:4[2-9]|[5-9]\d+)-/.test(index)),'cache buster Patch42 o successivo');
const patch42Segment=app.slice(app.indexOf('PATCH42_TRADING_ACCORDION_ICON_DISCLOSURE'),app.indexOf('/PATCH42_TRADING_ACCORDION_ICON_DISCLOSURE'));
check(!patch42Segment.includes('<details open')&&!patch42Segment.includes('<details class=\"step42-accordion\" open'),'nessun pannello hardcoded open');
console.log(JSON.stringify({success:checks.every(x=>x.ok),patch:'TENNIS_PATCH_42_TRADING_ACCORDION_ICON_DISCLOSURE',checks},null,2));
if(process.exitCode)process.exit(process.exitCode);
