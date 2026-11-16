#!/usr/bin/env node
'use strict';
const path=require('path'),fs=require('fs'),assert=require('assert');
const ROOT=path.resolve(process.argv[process.argv.indexOf('--root')+1]||path.join(__dirname,'..'));
const mod=require(path.join(ROOT,'backend','calcioHistoricalStatsSnapshotCacheAudit16b.js'));
const checks=[];const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
function parseDate(v){const [y,m,d]=String(v).split('-').map(Number);return new Date(y,m-1,d);}
function updateElo(h,a,hg,ag,k){const res=hg===ag?.5:hg>ag?1:0;const eh=1/(1+Math.pow(10,(a-h)/400));const delta=k*(res-eh);return{newHome:h+delta,newAway:a-delta};}
function legacy(rows,idx,candidateDate,useAdvanced=true,eloK=20){
 const historicalRows=rows.filter(row=>{const d=parseDate(row[idx.d]);return d&&candidateDate instanceof Date&&!Number.isNaN(candidateDate.getTime())&&d<candidateDate;});
 const teamStats={};
 for(const cols of historicalRows){
  const h=cols[idx.h].trim(),a=cols[idx.a].trim(); const hg=parseInt(cols[idx.hg])||0,ag=parseInt(cols[idx.ag])||0;
  const hst=idx.hst>-1?(parseInt(cols[idx.hst])||0):0,ast=idx.ast>-1?(parseInt(cols[idx.ast])||0):0,hs=idx.hs>-1?(parseInt(cols[idx.hs])||0):0,ass=idx.as>-1?(parseInt(cols[idx.as])||0):0;
  const empty=()=>({hp:0,hs:0,hc:0,hsot:0,hcot:0,ap:0,as:0,ac:0,asot:0,acot:0,recS:[],recC:[],elo:1500,matches:[]});
  if(!teamStats[h])teamStats[h]=empty(); if(!teamStats[a])teamStats[a]=empty();
  if(useAdvanced){const e=updateElo(teamStats[h].elo,teamStats[a].elo,hg,ag,eloK);teamStats[h].elo=e.newHome;teamStats[a].elo=e.newAway;}
  teamStats[h].hp++;teamStats[h].hs+=hg;teamStats[h].hc+=ag;teamStats[h].hsot+=hst;teamStats[h].hcot+=ast;
  teamStats[a].ap++;teamStats[a].as+=ag;teamStats[a].ac+=hg;teamStats[a].asot+=ast;teamStats[a].acot+=hst;
  teamStats[h].recS.push(hg);teamStats[h].recC.push(ag);teamStats[a].recS.push(ag);teamStats[a].recC.push(hg);
  teamStats[h].matches.push({goalsFor:hg,goalsAgainst:ag,shots:hs,shotsOnTarget:hst,shotsAgainst:ass,shotsOnTargetAgainst:ast});
  teamStats[a].matches.push({goalsFor:ag,goalsAgainst:hg,shots:ass,shotsOnTarget:ast,shotsAgainst:hs,shotsOnTargetAgainst:hst});
  if(teamStats[h].recS.length>10){teamStats[h].recS.shift();teamStats[h].recC.shift();teamStats[h].matches.shift();}
  if(teamStats[a].recS.length>10){teamStats[a].recS.shift();teamStats[a].recC.shift();teamStats[a].matches.shift();}
 }
 return{teamStats,historicalRowsCount:historicalRows.length};
}
try{
 const idx={d:0,h:1,a:2,hg:3,ag:4,hst:5,ast:6,hs:7,as:8};
 const teams=['Alpha','Beta','Gamma','Delta','Epsilon','Zeta']; const rows=[];
 for(let day=1;day<=120;day++){const d=new Date(2026,0,day);const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const h=teams[day%teams.length],a=teams[(day+1)%teams.length];rows.push([ds,h,a,String(day%4),String((day+2)%3),String(3+day%5),String(2+day%4),String(8+day%8),String(7+day%7)]);}
 let parseCalls=0; const builder=mod.createBuilder({rows,indexes:idx,parseDate:v=>{parseCalls++;return parseDate(v);},useAdvancedMetrics:true,updateElo,eloK:20});
 const cutoff=new Date(2026,3,20,15,0,0); const legacyOut=legacy(rows,idx,cutoff,true,20); const first=builder.build(cutoff);
 add('Version',mod.VERSION==='AUDIT16B_CALCIO_HISTORICAL_STATS_CACHE_V1');
 add('First build equals legacy output',JSON.stringify({teamStats:first.teamStats,historicalRowsCount:first.historicalRowsCount})===JSON.stringify(legacyOut));
 const originalAlpha=first.teamStats.Alpha?first.teamStats.Alpha.hp:null; if(first.teamStats.Alpha) first.teamStats.Alpha.hp=9999;
 const second=builder.build(new Date(cutoff.getTime()));
 add('Repeated cutoff served from cache',second.cacheHit===true);
 add('Cached snapshot isolated from downstream mutation',!second.teamStats.Alpha||second.teamStats.Alpha.hp===originalAlpha,{originalAlpha,returned:second.teamStats.Alpha?.hp});
 const diag=builder.diagnostics();
 add('CSV dates parsed exactly once',parseCalls===rows.length && diag.dateParseCount===rows.length,{parseCalls,rows:rows.length});
 add('Cache diagnostics count hit',diag.cacheHits===1&&diag.buildCount===1&&diag.uniqueCutoffs===1,diag);
 const server=fs.readFileSync(path.join(ROOT,'backend','server.js'),'utf8');
 add('Server uses AUDIT16B builder',server.includes("calcioHistoricalStatsSnapshotCacheAudit16b.createBuilder"));
 add('Legacy per-candidate parse filter removed',!server.includes("const historicalRows = allCsvRows.filter(row => {\n                    const rowDate = idxD > -1 ? parseFootballDataDate(row[idxD]) : null;"));
 add('Performance diagnostics exposed',server.includes('diagnostics.performance.historicalStatsCache'));
}catch(e){add('Unhandled test exception',false,{message:e.message,stack:e.stack});}
const failures=checks.filter(x=>!x.ok);const out={success:failures.length===0,patch:'AUDIT16B',checks:checks.length,failures,details:checks};console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
