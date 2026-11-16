#!/usr/bin/env node
'use strict';
const path=require('path');
const {performance}=require('perf_hooks');
const ROOT=path.resolve(process.argv[process.argv.indexOf('--root')+1]||path.join(__dirname,'..'));
const mod=require(path.join(ROOT,'backend','calcioHistoricalStatsSnapshotCacheAudit16b.js'));
function parseDate(v){const [y,m,d]=String(v).split('-').map(Number);return new Date(y,m-1,d);}
function updateElo(h,a,hg,ag,k){const r=hg===ag?.5:hg>ag?1:0,e=1/(1+10**((a-h)/400)),d=k*(r-e);return{newHome:h+d,newAway:a-d};}
const idx={d:0,h:1,a:2,hg:3,ag:4,hst:5,ast:6,hs:7,as:8};const teams=Array.from({length:24},(_,i)=>'T'+i),rows=[];
for(let i=0;i<760;i++){const d=new Date(2024,0,1+i);const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;rows.push([ds,teams[i%24],teams[(i+7)%24],String(i%5),String((i+2)%4),String(2+i%7),String(1+i%6),String(7+i%10),String(6+i%9)]);}
let legacyParses=0;function legacy(c){const hist=rows.filter(r=>{legacyParses++;const d=parseDate(r[0]);return d<c;});return hist.length;}
const cutoffs=[];for(let i=0;i<120;i++){const slot=i%8;cutoffs.push(new Date(2026,0,10+Math.floor(slot/2),slot%2?20:15));}
let t=performance.now();let legacyRows=0;for(const c of cutoffs)legacyRows+=legacy(c);const legacyMs=performance.now()-t;
let parses=0;const b=mod.createBuilder({rows,indexes:idx,parseDate:v=>{parses++;return parseDate(v);},useAdvancedMetrics:true,updateElo,eloK:20});t=performance.now();let newRows=0;for(const c of cutoffs)newRows+=b.build(c).historicalRowsCount;const newMs=performance.now()-t;const d=b.diagnostics();
const out={success:legacyRows===newRows&&parses===rows.length&&d.cacheHits>0,patch:'AUDIT16B',readOnly:true,rows:rows.length,calls:cutoffs.length,legacy:{ms:Number(legacyMs.toFixed(2)),dateParses:legacyParses},audit16b:{ms:Number(newMs.toFixed(2)),dateParses:parses,...d},sameHistoricalRowCount:legacyRows===newRows,parseReductionPct:Number((100*(1-parses/legacyParses)).toFixed(2))};
console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
