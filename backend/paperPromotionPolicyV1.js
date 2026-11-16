'use strict';
/** Prospective, fail-closed PAPER policy. No SQL mutation and no real-money execution. */
const crypto = require('node:crypto');
const clvEvidence = require('./certifiedClvEvidenceGateAudit09');
const VERSION = 'PAPER_PROMOTION_POLICY_V1_20261016';
const RULES = Object.freeze({minStudio:100,window:50,minSpanDays:28,maxAgeDays:21,minClvCoverage:.80,minMeanClv:0,maxCalibrationGap:.08,cooldownDays:14,maxStake:10,minStake:2});
const dayMs=86400000;
const h=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function n(x){if(x===null||x===undefined||x==='')return null; const k=Number(x);return Number.isFinite(k)?k:null;}
const s=x=>String(x??'').trim();
const norm=x=>s(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
function when(x){if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(x))return null;let t=Date.parse(x);if(!Number.isFinite(t))return null;const z=x.slice(0,10); // strict round-trip in UTC only if UTC offset is explicit Z
if(x.endsWith('Z')&&new Date(t).toISOString().slice(0,10)!==z)return null;return t;}
function first(...x){for(const v of x){if(s(v))return s(v);}return '';}


function safeTennisTime(r){
 const c=s(r.canonical_event_time_canonical_utc);
 const z=s(r.canonical_event_time_safety_utc);
 if(!c||!z||when(c)===null||when(z)===null||when(z)>when(c))return '';
 if(!norm(r.canonical_event_time_quality_status).startsWith('CERTIFIED'))return '';
 if(norm(r.prematch_capture_gate_status)!=='ALLOW_CERTIFIED_PREMATCH')return '';
 if(!s(r.official_schedule_receipt_id))return '';
 return z;
}
function officialTennisCapture(r){
 if(norm(r.sport_type)!=='TENNIS')return true;
 return !!safeTennisTime(r)
 &&['SCHEDULED','RESUMED'].includes(norm(r.official_schedule_status))
 &&norm(r.official_schedule_capture_disposition)==='ALLOW'
 &&['OFFICIAL_TOUR','OFFICIAL_TOURNAMENT','PRIMARY_EVENT_PROVIDER'].includes(norm(r.official_schedule_source_kind));
}
function officialTennisSettled(r){
 if(norm(r.sport_type)!=='TENNIS')return true;
 return !!safeTennisTime(r)
 &&['SCHEDULED','RESUMED','COMPLETED'].includes(norm(r.official_schedule_status))
 &&['OFFICIAL_TOUR','OFFICIAL_TOURNAMENT','PRIMARY_EVENT_PROVIDER'].includes(norm(r.official_schedule_source_kind))
 &&!!s(r.official_schedule_receipt_id);
}
function certifiedPromotionClv(r){
 if(n(r.clv_verified)!==1||n(r.clv_pct)===null)return false;
 try{return clvEvidence.evaluateRow(r).certified===true;}
 catch{return false;}
}
function identity(r){const sport=norm(r.sport_type);const league=norm(r.league);const strategy=norm(r.strategy_tag);const market=norm(first(r.market_type,r.strategy_tag));const model=norm(r.model_version);const st=sport==='TENNIS'?safeTennisTime(r):first(r.match_start_at,r.match_date); const stake=n(r.stake);return {id:r.id,sport,league,market,strategy,model,start:st,home:norm(r.home_team),away:norm(r.away_team),prediction:norm(r.prediction),odd:n(r.odd),prob:n(r.estimated_prob),scope:stake===0?'STUDIO':stake!==null&&stake>0?'TRADING':'INVALID',stake};}
function cell(i){return JSON.stringify([i.sport,i.league,i.market,i.strategy,i.model]);}
function match(i){return JSON.stringify([i.sport,i.start.slice(0,10),[i.home,i.away].sort()]);}
function active(r){return ['CURRENT','CURRENT_BOOTSTRAP'].includes(norm(r.data_quality))&&n(r.paper_result_active??1)===1&&n(r.paper_result_conflict??0)===0;}
function prospective(i,now){return Number.isSafeInteger(i.id)&&i.id>0&&['CALCIO','TENNIS'].includes(i.sport)&&i.league&&i.market&&i.strategy&&i.model&&i.home&&i.away&&i.prediction&&i.scope!=='INVALID'&&when(i.start)!==null&&when(i.start)>now&&i.odd>1&&i.prob>0&&i.prob<100;}
function certified(r){return ['WON','LOST'].includes(norm(r.status))&&norm(r.settlement_contract_status)==='VERIFIED'&&!!first(r.settlement_source,r.settlement_contract_source,r.result_source)&&!!s(r.settlement_evidence_hash)&&!!s(r.settlement_source_event_id)&&officialTennisSettled(r);}
function immutableSnapshot(r,now){const i=identity(r);const payload={identity:i,capturedAt:new Date(now).toISOString()};return {payload,sha256:h(payload)};}
function empty(){return {version:VERSION,anchors:{},groups:{},transitions:[],updatedAt:null};}
function validateState(state){if(!state||state.version!==VERSION||!state.anchors||!state.groups||!Array.isArray(state.transitions))throw Error('POLICY_STATE_INVALID');}
function ciLower(xs){if(xs.length<2)return null;const avg=xs.reduce((a,b)=>a+b,0)/xs.length;const v=xs.reduce((a,b)=>a+(b-avg)**2,0)/(xs.length-1);return avg-1.96*Math.sqrt(v/xs.length);}
function stats(xs){if(!xs.length)return {n:0};const w=xs.filter(x=>x.won).length;const u=xs.map(x=>x.unitReturn);const clvs=xs.map(x=>x.clv).filter(x=>x!==null);return {n:xs.length,wins:w,roiPct:+(100*u.reduce((a,b)=>a+b,0)/u.length).toFixed(2),roiLower95:ciLower(u),clvCoverage:clvs.length/xs.length,meanClv:clvs.length?clvs.reduce((a,b)=>a+b,0)/clvs.length:null,brier:xs.reduce((a,b)=>a+b.brier,0)/xs.length,marketBrier:xs.reduce((a,b)=>a+b.marketBrier,0)/xs.length,calibrationGap:Math.abs(xs.reduce((a,b)=>a+(b.prob-b.won),0)/xs.length)};}
function goodWindow(xs,rules){const m=stats(xs);return m.n>=rules.window&&m.roiLower95!==null&&m.roiLower95>0&&m.clvCoverage>=rules.minClvCoverage&&m.meanClv!==null&&m.meanClv>rules.minMeanClv&&m.brier<m.marketBrier&&m.calibrationGap<=rules.maxCalibrationGap;}
function qualifies(studio,now,rules){if(studio.length<rules.minStudio)return {pass:false,why:'INSUFFICIENT_FORWARD_STUDIO'};const last=studio.slice(-rules.minStudio);const span=(last.at(-1).time-last[0].time)/dayMs;const age=(now-last.at(-1).time)/dayMs;if(span<rules.minSpanDays)return {pass:false,why:'INSUFFICIENT_TIME_SPAN'};if(age>rules.maxAgeDays)return {pass:false,why:'STALE_EVIDENCE'};if(!goodWindow(last.slice(0,rules.window),rules)||!goodWindow(last.slice(-rules.window),rules))return {pass:false,why:'STATISTICAL_GATES_NOT_PASSED'};return {pass:true,why:'TWO_PROSPECTIVE_WINDOWS_QUALIFIED'};}
function run(rows,input,now=Date.now(),rules=RULES){validateState(input);if(!Number.isFinite(now))throw Error('INVALID_CLOCK');const state=JSON.parse(JSON.stringify(input));const grouped=new Map();const excluded={noAnchor:0,drift:0,uncertified:0,time:0,duplicateEvent:0,invalid:0};
for(const r of rows){const i=identity(r);if(!['CALCIO','TENNIS'].includes(i.sport)||!active(r)||norm(r.bet_type).includes('MULTI')||i.scope==='INVALID')continue;
 if(norm(r.status)==='PENDING'&&prospective(i,now)&&officialTennisCapture(r)&&!state.anchors[i.id])state.anchors[i.id]=immutableSnapshot(r,now);
 if(!['WON','LOST'].includes(norm(r.status)))continue;
 const seal=state.anchors[i.id];if(!seal){excluded.noAnchor++;continue;}if(h(seal.payload)!==seal.sha256)throw Error('ANCHOR_HASH_BROKEN');if(h(identity(r))!==h(seal.payload.identity)){excluded.drift++;continue;}if(!certified(r)){excluded.uncertified++;continue;}
 const cap=when(seal.payload.capturedAt),st=when(i.start);if(cap===null||st===null||cap>=st||st>now||st>now){excluded.time++;continue;}
 const y=norm(r.status)==='WON'?1:0,p=i.prob/100;const clv=n(r.clv_pct);const clvVal=certifiedPromotionClv(r)?clv:null;
 const sample={id:i.id,scope:i.scope,match:match(i),time:st,won:y,prob:p,unitReturn:y?i.odd-1:-1,brier:(p-y)**2,marketBrier:(1/i.odd-y)**2,clv:clvVal};const k=cell(i);if(!grouped.has(k))grouped.set(k,{identity:{sport:i.sport,league:i.league,market:i.market,strategy:i.strategy,model:i.model},items:[]});grouped.get(k).items.push(sample);
}
const newGroups={};const allKeys=new Set([...Object.keys(state.groups),...grouped.keys()]);for(const k of [...allKeys].sort()){
 const group=grouped.get(k),prior=state.groups[k];let unique=[];if(group){const count=new Map();for(const x of group.items)count.set(x.match,(count.get(x.match)||0)+1);unique=group.items.filter(x=>count.get(x.match)===1).sort((a,b)=>a.time-b.time||a.id-b.id);excluded.duplicateEvent+=group.items.length-unique.length;}
 const studio=unique.filter(x=>x.scope==='STUDIO'),trading=unique.filter(x=>x.scope==='TRADING');const readiness=qualifies(studio,now,rules);const tradingLatest=trading.slice(-rules.window);const identity=group?.identity||prior?.identity;let status=prior?.status==='TRADING'?'TRADING':'STUDIO',reason='INSUFFICIENT_EVIDENCE';
 if(prior?.status==='TRADING'){
  const age=unique.length?(now-unique.at(-1).time)/dayMs:Infinity;
  if(age>rules.maxAgeDays||!unique.length){status='STUDIO';reason='DEMOTED_STALE_OR_MISSING_EVIDENCE';}
  else if(tradingLatest.length>=rules.window){const m=stats(tradingLatest);if(m.roiLower95!==null&&m.roiLower95<0||m.meanClv!==null&&m.meanClv<0||m.brier>m.marketBrier){status='STUDIO';reason='DEMOTED_PERFORMANCE_REGRESSION';}else{reason='TRADING_OBSERVATION_CONTINUES';}}
  else reason='TRADING_MONITORING_SAMPLE_PENDING';
 }else if(readiness.pass){const elapsed=prior?.demotedAt?((now-when(prior.demotedAt))/dayMs):Infinity;
  if(prior?.demotedAt&&(!Number.isFinite(elapsed)||elapsed<rules.cooldownDays)){reason='COOLDOWN';}else{status='TRADING';reason='PROMOTED_PROSPECTIVE_EVIDENCE';}
 }else reason=readiness.why;
 const changed=status!==(prior?.status||'STUDIO');const summary={identity,status,reason,studio:stats(studio),trading:stats(trading),firstSeenAt:prior?.firstSeenAt||new Date(now).toISOString(),lastEvidenceAt:unique.length?new Date(unique.at(-1).time).toISOString():null,updatedAt:new Date(now).toISOString(),demotedAt:changed&&status==='STUDIO'?new Date(now).toISOString():prior?.demotedAt||null,policyVersion:VERSION};newGroups[k]=summary;
 if(changed)state.transitions.push({key:k,identity,from:prior?.status||'STUDIO',to:status,reason,at:new Date(now).toISOString()});
}
state.groups=newGroups;state.updatedAt=new Date(now).toISOString();state.exclusions=excluded;state.anchorCount=Object.keys(state.anchors).length;return state;
}
/** Only for *future* PAPER decisions, invoked after existing hard gates and batch/risk caps. */
function decideFutureStake(state,signal,authority={},opts={}){validateState(state);const i=identity(signal);const key=cell(i);const g=state.groups[key];const now=Number.isFinite(opts.now)?opts.now:Date.now();const disabled=opts.enabled!==true;const zero=(reason)=>({stake:0,scope:'STUDIO',reason,key,policyVersion:VERSION,paperOnly:true});
 if(disabled)return {stake:n(authority.authorizedStake)??0,scope:'UNCHANGED',reason:'POLICY_DISABLED',key,policyVersion:VERSION,paperOnly:true};
 if(!g||g.status!=='TRADING'||!g.lastEvidenceAt||now-when(g.lastEvidenceAt)>RULES.maxAgeDays*dayMs)return zero('NO_VALID_PROMOTION');
 if(authority.paperOnly!==true||authority.hardGatesPassed!==true||authority.qualityGatePassed!==true||authority.portfolioCapPassed!==true||authority.prematchIdentityPassed!==true)return zero('HARD_GATES_NOT_PASSED');
 const p=n(authority.calibratedProbability),odd=n(signal.odd),base=n(authority.authorizedStake);
 if(p===null||p<=0||p>=1||odd===null||odd<=1||p*odd-1<=0)return zero('NO_VERIFIED_VALUE');
 // Never invent stake. Baseline has to be independently granted by final authority.
 if(base===null||base<RULES.minStake)return zero('UPSTREAM_STAKE_UNAUTHORIZED');
 const b=n(authority.bankrollAvailable),cap=n(authority.portfolioRemaining);if(b===null||cap===null||b<=0||cap<RULES.minStake)return zero('PORTFOLIO_CAP_UNVERIFIED');
 const stake=Math.floor(Math.min(base,b,cap,RULES.maxStake)*100)/100;if(stake<RULES.minStake)return zero('BELOW_MINIMUM_STAKE');
 return {stake,scope:'TRADING',reason:'PROMOTED_AND_ALL_HARD_GATES_PASSED',key,policyVersion:VERSION,paperOnly:true};
}
module.exports={VERSION,RULES,identity,cell,match,when,stats,goodWindow,qualifies,empty,run,decideFutureStake,immutableSnapshot,certified};
