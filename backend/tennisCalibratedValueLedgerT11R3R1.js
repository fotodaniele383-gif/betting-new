'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = 'AUDIT16D_R3_T11_R3_R1_DURABLE_CALIBRATED_LEDGER_V1';
const MODE = 'DURABLE_CALIBRATED_VALUE_LEDGER_NO_PRODUCTION_AUTHORITY';
const MAX_EVENTS = 2500;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
let ledgerPathOverride = null;
const sessionId = `T11R3R1_${process.pid}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

function finite(v, f=null) { const n=Number(v); return Number.isFinite(n)?n:f; }
function round(v,d=4){const n=finite(v,null);if(n===null)return null;const m=10**d;return Math.round(n*m)/m;}
function text(v){return v==null?'':String(v);}
function norm(v){return text(v).trim().toUpperCase().replace(/\s+/g,' ');}
function sha256(v){return crypto.createHash('sha256').update(String(v)).digest('hex');}
function defaultLedgerPath(){return path.join(__dirname,'audit_runtime','t11_r3_calibrated_value.jsonl');}
function getLedgerPath(){return ledgerPathOverride || defaultLedgerPath();}
function setLedgerPathForTests(p=null){ledgerPathOverride=p||null;}
function ensureDir(){fs.mkdirSync(path.dirname(getLedgerPath()),{recursive:true});}
function safeStat(){try{const s=fs.statSync(getLedgerPath());return{exists:true,sizeBytes:s.size,mtime:s.mtime.toISOString()};}catch(_){return{exists:false,sizeBytes:0,mtime:null};}}
function parseLedger(){
  const stat=safeStat(); const out={...stat,path:getLedgerPath(),linesRead:0,parseErrors:0,events:[]};
  if(!stat.exists)return out;
  try{
    const lines=fs.readFileSync(getLedgerPath(),'utf8').split(/\r?\n/).filter(Boolean);
    out.linesRead=lines.length;
    for(const line of lines){try{out.events.push(JSON.parse(line));}catch(_){out.parseErrors++;}}
  }catch(e){out.readError=e.message;}
  return out;
}
function rotateIfNeeded(){
  const s=safeStat(); if(!s.exists||s.sizeBytes<=MAX_FILE_BYTES)return;
  const parsed=parseLedger(); const keep=parsed.events.slice(-MAX_EVENTS);
  ensureDir(); fs.writeFileSync(getLedgerPath(),keep.map(JSON.stringify).join('\n')+(keep.length?'\n':''),'utf8');
}
function appendEvent(event){
  const now=new Date().toISOString();
  const base={version:VERSION,mode:MODE,sessionId,pid:process.pid,recordedAt:now,...event};
  base.recordHash=sha256(JSON.stringify({...base,recordHash:undefined}));
  try{ensureDir();rotateIfNeeded();fs.appendFileSync(getLedgerPath(),JSON.stringify(base)+'\n','utf8');return{written:true,path:getLedgerPath(),recordHash:base.recordHash,event:base};}
  catch(e){return{written:false,path:getLedgerPath(),error:e.message,event:base};}
}
function compactApi(api={}){
  return {sportsCatalogFetched:finite(api.sportsCatalogFetched,0),tournamentsFound:finite(api.tournamentsFound,0),tournamentsProcessed:finite(api.tournamentsProcessed,0),tournamentsSkippedNotAllowed:finite(api.tournamentsSkippedNotAllowed,0),oddsRequests:finite(api.oddsRequests,0),oddsEvents:finite(api.oddsEvents,0),oddsErrors:finite(api.oddsErrors,0),errorSamples:Array.isArray(api.errorSamples)?api.errorSamples.slice(0,8):[]};
}
function rowKey(row={}){return `${norm(row.match||`${row.home||row.home_team||''} - ${row.away||row.away_team||''}`)}|${norm(row.prediction)}|${norm(row.match_date||row.date||'')}`;}
function looseKey(row={}){return `${norm(row.match||`${row.home||row.home_team||''} - ${row.away||row.away_team||''}`)}|${norm(row.prediction)}`;}
function recordAnalysisRun(input={}){
  const bets=(Array.isArray(input.valueBets)?input.valueBets:[]).map(b=>({betId:finite(b.id??b.betId,null),match:text(b.match||`${b.home||b.home_team||''} - ${b.away||b.away_team||''}`).trim(),prediction:text(b.prediction).trim(),matchDate:b.match_date||b.date||null,league:b.league||b.tournament||null,marketType:b.market_type||b.marketType||null,odd:finite(b.odd,null),key:rowKey(b),looseKey:looseKey(b)}));
  const partial=input.partialProviderResult===true || finite(input.api?.oddsErrors,0)>0;
  return appendEvent({eventType:'ANALYSIS_RUN',operationId:input.operationId||null,providerCompleteness:partial?'PARTIAL_PROVIDER_RESULT':'FULL_PROVIDER_RESULT',partialProviderResult:partial,warning:input.warning||null,api:compactApi(input.api||{}),betCount:bets.length,bets});
}
function latestAnalysisContextFor(trace={}){
  const parsed=parseLedger(); const k=rowKey(trace),lk=looseKey(trace);
  const runs=parsed.events.filter(e=>e.eventType==='ANALYSIS_RUN').sort((a,b)=>String(b.recordedAt).localeCompare(String(a.recordedAt)));
  for(const run of runs){const bets=Array.isArray(run.bets)?run.bets:[];const exact=bets.find(b=>b.key===k);const loose=exact||bets.find(b=>b.looseKey===lk);if(loose)return{analysisOperationId:run.operationId||null,providerCompleteness:run.providerCompleteness||'UNKNOWN_PROVIDER_CONTEXT',partialProviderResult:run.partialProviderResult===true,providerApi:run.api||null,matchedBet:loose,analysisRecordedAt:run.recordedAt||null};}
  return{analysisOperationId:null,providerCompleteness:'UNKNOWN_PROVIDER_CONTEXT',partialProviderResult:null,providerApi:null,matchedBet:null,analysisRecordedAt:null};
}
function recordDecision(input={}){
  const trace=input.trace||{}; const value=input.calibratedValue||{}; const provider=latestAnalysisContextFor({match:input.match||trace.match,prediction:input.prediction||trace.prediction,match_date:trace.matchDate});
  const validationEligibility=provider.providerCompleteness==='FULL_PROVIDER_RESULT'?'ELIGIBLE_FULL_PROVIDER_CONTEXT':provider.providerCompleteness==='PARTIAL_PROVIDER_RESULT'?'EXCLUDED_PARTIAL_PROVIDER_RESULT':'UNKNOWN_PROVIDER_CONTEXT';
  const row={eventType:'CALIBRATED_DECISION',deepScanOperationId:input.deepScanOperationId||null,betId:finite(input.betId??trace.betId,null),match:text(input.match||trace.match).trim(),prediction:text(input.prediction||trace.prediction).trim(),matchDate:trace.matchDate||null,league:trace.league||null,marketType:value.marketType||trace.marketType||null,traceId:trace.traceId||null,traceRecordHash:trace.recordHash||null,providerContext:provider,validationEligibility,comparisonClass:value.comparisonClass||null,comparisonDirection:value.comparisonDirection||null,available:value.available===true,calibratedValue:value,finalExecutableStake:round(value.finalExecutableStake??trace?.analysis?.stakes?.patch46,2),aiReliabilityShadow:trace.aiReliabilityShadow||null,traceDiagnosis:trace?.analysis?.diagnosis||null};
  return appendEvent(row);
}
function latestDecisions(events){
  const map=new Map();
  for(const e of events.filter(x=>x.eventType==='CALIBRATED_DECISION')){
    const key=e.betId!=null?`BET:${e.betId}`:`ROW:${norm(e.match)}|${norm(e.prediction)}`;
    const prev=map.get(key); if(!prev||String(e.recordedAt)>String(prev.recordedAt))map.set(key,e);
  }
  return [...map.values()].sort((a,b)=>String(b.recordedAt).localeCompare(String(a.recordedAt)));
}
function inspect(opts={}){
  const limit=Math.max(1,Math.min(250,finite(opts.limit,50)||50));
  const rawBetId=opts.betId;
  const betId=(rawBetId===null||rawBetId===undefined||(typeof rawBetId==='string'&&rawBetId.trim()===''))?null:finite(rawBetId,null);
  const parsed=parseLedger(); let decisions=latestDecisions(parsed.events); if(betId!==null)decisions=decisions.filter(r=>finite(r.betId,null)===betId); const rows=decisions.slice(0,limit).map(e=>({betId:e.betId,match:e.match,prediction:e.prediction,recordedAt:e.recordedAt,deepScanOperationId:e.deepScanOperationId,traceId:e.traceId,traceRecordHash:e.traceRecordHash,providerContext:e.providerContext,validationEligibility:e.validationEligibility,...(e.calibratedValue||{}),ledgerRecordHash:e.recordHash,traceDiagnosis:e.traceDiagnosis}));
  const available=rows.filter(r=>r.available===true); const c=k=>available.filter(r=>r.comparisonClass===k).length; const pc=s=>rows.filter(r=>r.providerContext?.providerCompleteness===s).length;
  const allDecisions=latestDecisions(parsed.events);
  return{success:true,version:VERSION,mode:MODE,readOnly:true,durable:true,source:'DEDICATED_R3_JSONL_LEDGER',ledger:{path:parsed.path,exists:parsed.exists,sizeBytes:parsed.sizeBytes,mtime:parsed.mtime,linesRead:parsed.linesRead,parseErrors:parsed.parseErrors,readError:parsed.readError||null,sessionId,pid:process.pid,maxEvents:MAX_EVENTS,maxFileBytes:MAX_FILE_BYTES,totalEvents:parsed.events.length,analysisRunEvents:parsed.events.filter(e=>e.eventType==='ANALYSIS_RUN').length,calibratedDecisionEvents:parsed.events.filter(e=>e.eventType==='CALIBRATED_DECISION').length,latestDecisions:allDecisions.length},rows,summary:{total:rows.length,available:available.length,support:c('CALIBRATED_SUPPORT'),neutral:c('CALIBRATED_NEUTRAL'),contradiction:c('CALIBRATED_CONTRADICTION'),totalsOrUnavailable:rows.filter(r=>r.available!==true).length,fullProviderContext:pc('FULL_PROVIDER_RESULT'),partialProviderContext:pc('PARTIAL_PROVIDER_RESULT'),unknownProviderContext:pc('UNKNOWN_PROVIDER_CONTEXT'),forwardValidationEligible:rows.filter(r=>r.validationEligibility==='ELIGIBLE_FULL_PROVIDER_CONTEXT'&&r.available===true).length,excludedPartialProvider:rows.filter(r=>r.validationEligibility==='EXCLUDED_PARTIAL_PROVIDER_RESULT').length},authority:{stakeChange:false,qualityGateChange:false,probabilityProductionChange:false,thresholdProductionChange:false,automaticPromotion:false},policy:'Dedicated durable research ledger only. PARTIAL_PROVIDER_RESULT rows are retained for diagnosis but excluded from future forward-validation eligibility. No production authority.',generatedAt:new Date().toISOString()};
}
function clearForTests(opts={}){if(opts.disk===true)try{fs.rmSync(getLedgerPath(),{force:true})}catch(_){};}
module.exports={VERSION,MODE,MAX_EVENTS,MAX_FILE_BYTES,getLedgerPath,setLedgerPathForTests,recordAnalysisRun,recordDecision,inspect,latestAnalysisContextFor,parseLedger,clearForTests};
