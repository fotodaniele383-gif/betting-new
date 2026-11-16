'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const walk = require('./calcioWalkForwardCalibration');
const teamSnapshot = require('./calcioTeamSnapshot');
const opponentForm = require('./calcioOpponentAdjustedForm');
const quant = require('./calcioQuantEngine');

const CALCIO_HISTORICAL_THRESHOLD_OPTIMIZER_VERSION = 'BETTING_PATCH_12_CALCIO_WALK_FORWARD_THRESHOLD_OPTIMIZER_V1';
const DEFAULT_GRID = Object.freeze({
  edge: Object.freeze([0.5, 1, 1.5, 2, 2.5, 3, 4, 5]),
  probability: Object.freeze([35, 40, 45, 50, 55, 60]),
  maxOdd: Object.freeze([2.2, 2.6, 3, 3.5, 4, 5]),
  marketScopes: Object.freeze(['1X2_ONLY','TOTALS_ONLY','ALL_SUPPORTED'])
});
function num(v,f=null){ const n=Number(v); return Number.isFinite(n)?n:f; }
function round(v,d=4){ const n=num(v,0); return Number(n.toFixed(d)); }
function clamp(v,min,max){ return Math.max(min,Math.min(max,num(v,min))); }
function parseDate(raw){
  const s=String(raw||'').trim(); const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(m){ let y=Number(m[3]); if(y<100)y+=2000; return new Date(Date.UTC(y,Number(m[2])-1,Number(m[1]),12)); }
  const d=new Date(s); return Number.isNaN(d.getTime())?null:d;
}
function eventKey(date,home,away){ return `${date?.toISOString?.().slice(0,10)||''}|${String(home||'').toLowerCase()}|${String(away||'').toLowerCase()}`; }
function readOddsMap(csvPath){
  const lines=fs.readFileSync(csvPath,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
  const headers=teamSnapshot.splitCsvLine(lines.shift()||''); const out=new Map();
  for(const line of lines){
    const vals=teamSnapshot.splitCsvLine(line); const row={}; headers.forEach((h,i)=>row[h]=vals[i]);
    const date=parseDate(row.Date); if(!date||!row.HomeTeam||!row.AwayTeam)continue;
    const h=num(row.AvgCH,num(row.MaxCH,num(row.B365CH,num(row.AvgH,num(row.MaxH,num(row.B365H,null))))));
    const d=num(row.AvgCD,num(row.MaxCD,num(row.B365CD,num(row.AvgD,num(row.MaxD,num(row.B365D,null))))));
    const a=num(row.AvgCA,num(row.MaxCA,num(row.B365CA,num(row.AvgA,num(row.MaxA,num(row.B365A,null))))));
    const over=num(row['AvgC>2.5'],num(row['MaxC>2.5'],num(row['B365C>2.5'],num(row['Avg>2.5'],num(row['B365>2.5'],null)))));
    const under=num(row['AvgC<2.5'],num(row['MaxC<2.5'],num(row['B365C<2.5'],num(row['Avg<2.5'],num(row['B365<2.5'],null)))));
    const odds={source:'FOOTBALL_DATA_CLOSING_AVERAGE'};
    if([h,d,a].every(x=>x>1)) Object.assign(odds,{ '1':h, X:d, '2':a });
    if(over>1&&under>1) Object.assign(odds,{ 'O2.5':over, 'U2.5':under });
    if(Object.keys(odds).length>1) out.set(eventKey(date,row.HomeTeam,row.AwayTeam),odds);
  }
  return out;
}
function actualMarkets(match){ const result=match.homeGoals>match.awayGoals?'1':match.homeGoals<match.awayGoals?'2':'X'; const total=match.homeGoals+match.awayGoals>2?'O2.5':'U2.5'; return {result,total}; }
function candidateGrid(grid=DEFAULT_GRID){ const out=[]; const scopes=grid.marketScopes||DEFAULT_GRID.marketScopes; for(const edge of grid.edge)for(const probability of grid.probability)for(const maxOdd of grid.maxOdd)for(const marketScope of scopes)out.push({edge,probability,maxOdd,minOdd:1.45,marketScope}); return out; }
function prepareEvents(dataset){
  const oddsMap=readOddsMap(dataset.csvPath); const split=walk.makeSplit(dataset.index,{warmupFraction:.2,calibrationFraction:.5,minWarmupMatches:60}); const events=[];
  dataset.index.matches.forEach((match,index)=>{
    if(index<split.warmupEnd)return; const odds=oddsMap.get(eventKey(match.date,match.home,match.away)); if(!odds)return;
    const base=walk.buildBaseExpectedGoals(dataset.index,match,match.date,{basePriorMatches:5});
    const adjustment=opponentForm.buildMatchAdjustment(dataset.index,match.home,match.away,match.date,{priorMatches:6,recencyDecay:.86,adjustmentCap:.08,window:10,evidenceBlend:.65});
    const adjusted=opponentForm.applyToExpectedGoals(base.expHomeGoals,base.expAwayGoals,adjustment);
    const dc=quant.getDixonColesProbabilities(adjusted.expHomeGoals,adjusted.expAwayGoals,-0.10);
    const probabilities={'1':num(dc['1'],0),X:num(dc.X,0),'2':num(dc['2'],0),'O2.5':num(dc['O2.5'],0),'U2.5':num(dc['U2.5'],0)};
    events.push({league:dataset.name,code:dataset.code,index,date:match.date.toISOString(),phase:index<split.calibrationEnd?'CALIBRATION':'HOLDOUT',actual:actualMarkets(match),odds,probabilities});
  });
  return {split,events};
}
function marketsForScope(scope='ALL_SUPPORTED'){
  if(scope==='1X2_ONLY') return ['1','X','2'];
  if(scope==='TOTALS_ONLY') return ['O2.5','U2.5'];
  return ['1','X','2','O2.5','U2.5'];
}
function selectForEvent(event,params){
  const candidates=marketsForScope(params.marketScope).filter(market=>num(event.odds[market],0)>1).map(market=>{
    const odd=num(event.odds[market],0), probability=num(event.probabilities[market],0), edge=probability-(100/odd), ev=((probability/100)*odd-1)*100;
    const family=['O2.5','U2.5'].includes(market)?'TOTALS_2_5':'1X2';
    return {market,family,odd,probability,edge,ev};
  }).filter(x=>x.odd>=params.minOdd&&x.odd<=params.maxOdd&&x.probability>=params.probability&&x.edge>=params.edge&&x.ev>0)
    .sort((a,b)=> (b.edge*Math.sqrt(Math.min(b.odd,3))/Math.max(1,b.odd-1))-(a.edge*Math.sqrt(Math.min(a.odd,3))/Math.max(1,a.odd-1)) || b.probability-a.probability || a.market.localeCompare(b.market));
  return candidates[0]||null;
}
function evaluate(events,params,phase){
  const selected=[]; for(const event of events){ if(event.phase!==phase)continue; const pick=selectForEvent(event,params); if(!pick)continue; const won=pick.family==='TOTALS_2_5' ? pick.market===event.actual.total : pick.market===event.actual.result; selected.push({...pick,won,ret:won?pick.odd-1:-1,league:event.league,date:event.date}); }
  const n=selected.length; const returns=selected.map(x=>x.ret); const roi=n?returns.reduce((a,b)=>a+b,0)/n*100:0; const mean=n?returns.reduce((a,b)=>a+b,0)/n:0;
  const variance=n>1?returns.reduce((a,x)=>a+Math.pow(x-mean,2),0)/(n-1):0; const se=n?Math.sqrt(variance/n)*100:999;
  const leagues={},markets={}; for(const item of selected){ const l=leagues[item.league]||{count:0,profit:0,wins:0}; l.count++; l.profit+=item.ret; if(item.won)l.wins++; leagues[item.league]=l; const m=markets[item.family]||{count:0,profit:0,wins:0}; m.count++;m.profit+=item.ret;if(item.won)m.wins++;markets[item.family]=m; }
  for(const bucket of [leagues,markets]) Object.values(bucket).forEach(l=>{l.roiPct=round(l.profit/Math.max(1,l.count)*100);l.hitRatePct=round(l.wins/Math.max(1,l.count)*100,2);l.profit=round(l.profit);});
  return {sample:n,roiPct:round(roi),hitRatePct:n?round(selected.filter(x=>x.won).length/n*100,2):0,profitUnits:round(returns.reduce((a,b)=>a+b,0)),standardErrorPct:round(se),roiLower95Pct:round(roi-1.96*se),roiUpper95Pct:round(roi+1.96*se),leagues,markets,selected};
}
function digest(value){ return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20); }
function run(root=path.resolve(__dirname,'..'),options={}){
  const loaded=walk.loadLeagueDatasets(root,options); const prepared=loaded.datasets.map(ds=>({dataset:ds,...prepareEvents(ds)})); const events=prepared.flatMap(x=>x.events); const grid=candidateGrid(options.grid||DEFAULT_GRID); const minimumCalibration=Math.max(60,num(options.minimumCalibration,100));
  const ranked=[]; let evaluatedWithSample=0; for(const params of grid){ const calibration=evaluate(events,params,'CALIBRATION'); if(calibration.sample<minimumCalibration)continue; evaluatedWithSample++; if(calibration.roiPct<=0)continue; const score=calibration.roiLower95Pct + Math.min(6,Math.log10(calibration.sample)*2); ranked.push({params,calibration,score:round(score)}); }
  ranked.sort((a,b)=>b.score-a.score||b.calibration.sample-a.calibration.sample); const best=ranked[0]||null; const holdout=best?evaluate(events,best.params,'HOLDOUT'):null;
  const severeLeagues=holdout?Object.entries(holdout.leagues).filter(([,v])=>v.count>=20&&v.roiPct<=-15).map(([k])=>k):[];
  const status=!best?'INSUFFICIENT_SAMPLE':holdout.sample<80?'HOLD_SHADOW':(holdout.roiPct>0&&holdout.roiLower95Pct>-5&&severeLeagues.length===0?'ELIGIBLE_FOR_EXPLICIT_APPLY':'HOLD_SHADOW');
  const recommendationId=digest({version:CALCIO_HISTORICAL_THRESHOLD_OPTIMIZER_VERSION,params:best?.params,holdout:holdout&&{sample:holdout.sample,roi:holdout.roiPct},datasets:loaded.datasets.map(x=>x.metadata?.sha256||x.code)});
  const report={success:Boolean(best),version:CALCIO_HISTORICAL_THRESHOLD_OPTIMIZER_VERSION,generatedAt:new Date().toISOString(),dataMode:'FOOTBALL_DATA_LOCAL_CLOSING_ODDS_1X2_TOTALS_WALK_FORWARD',recommendationOnly:true,status,recommendationId,candidateCount:grid.length,evaluatedCandidates:evaluatedWithSample,positiveCalibrationCandidates:ranked.length,datasets:loaded.datasets.map(x=>({code:x.code,league:x.name,matches:x.index.matches.length})),errors:loaded.errors,marketScope:['1X2','TOTALS_2_5'],splitPolicy:'20% warmup; 40% calibration; 40% untouched holdout per league',selectionMetric:'CALIBRATION_ROI_LOWER_95_WITH_SAMPLE_BONUS',recommended:best?{baseEdge:best.params.edge,baseProb:best.params.probability,maxOdd:best.params.maxOdd,minOdd:best.params.minOdd,marketScope:best.params.marketScope,calibration:{...best.calibration,selected:undefined},holdout:{...holdout,selected:undefined}}:null,severeRegressionLeagues:severeLeagues,safeguards:{asOfSafeModelInputs:true,holdoutExcludedFromSelection:true,flatUnitStake:true,closingOddsEvaluation:true,noAutomaticSettingsMutation:true,noNewApiCalls:true}};
  const reportDir=path.join(root,'audit_calcio_patch12'); fs.mkdirSync(reportDir,{recursive:true}); fs.writeFileSync(path.join(reportDir,'calcio_patch12_threshold_optimizer_report.json'),JSON.stringify(report,null,2)); return report;
}
module.exports={CALCIO_HISTORICAL_THRESHOLD_OPTIMIZER_VERSION,DEFAULT_GRID,candidateGrid,readOddsMap,prepareEvents,marketsForScope,selectForEvent,evaluate,run};
