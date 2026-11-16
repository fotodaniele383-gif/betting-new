'use strict';
// AUDIT16D - prospective adaptive-learning SHADOW only.
// This module never changes production probabilities, DeepScan weights, stake, settlement or Trading scope.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const A = require('./public/portfolioAccounting');

const VERSION = 'AUDIT16D_ADAPTIVE_LEARNING_SHADOW_V1';
const POLICY_VERSION = 'AUDIT16D_PROSPECTIVE_WEIGHT_CHALLENGER_POLICY_V1';
const PROFILES = Object.freeze([
  Object.freeze({id:'ANALYSIS_ONLY', analysisWeight:1.00, deepScanWeight:0.00, threshold:0.30}),
  Object.freeze({id:'ANALYSIS_80_DEEPSCAN_20', analysisWeight:0.80, deepScanWeight:0.20, threshold:0.30}),
  Object.freeze({id:'ANALYSIS_65_DEEPSCAN_35', analysisWeight:0.65, deepScanWeight:0.35, threshold:0.30}),
  Object.freeze({id:'BALANCED_50_50', analysisWeight:0.50, deepScanWeight:0.50, threshold:0.30}),
  Object.freeze({id:'ANALYSIS_35_DEEPSCAN_65', analysisWeight:0.35, deepScanWeight:0.65, threshold:0.30})
]);
const POLICY = Object.freeze({
  version: POLICY_VERSION,
  mode: 'PROSPECTIVE_SHADOW_ONLY_FAIL_CLOSED',
  minimumAccepted: 100,
  halfWindow: 50,
  minimumSpanDays: 28,
  minimumClvCoverage: 0.80,
  minimumHitRateDeltaPpVsAnalysisOnly: 1.0,
  maximumRoiRegressionPpVsAnalysisOnly: 1.0,
  profiles: PROFILES
});
const AUTHORITY = Object.freeze({
  databaseMutation:false,
  probabilityMutation:false,
  deepScanWeightMutation:false,
  matchAnalysisWeightMutation:false,
  stakeMutation:false,
  settlementMutation:false,
  tradingPromotion:false,
  tradingDemotion:false,
  automaticProductionActivation:false,
  productionAuthorized:false
});
function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function clamp(v,lo=0,hi=1){const x=n(v);return x===null?lo:Math.min(hi,Math.max(lo,x));}
function norm(v,lo,hi,fallback=0.5){const x=n(v);if(x===null||!(hi>lo))return fallback;return clamp((x-lo)/(hi-lo));}
function text(v){return String(v??'').trim();}
function upper(v){return text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();}
function sha(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function utc(v){if(typeof v!=='string'||!/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(v))return null;const t=Date.parse(v);return Number.isFinite(t)?t:null;}
function firstNumber(...vs){for(const v of vs){const x=n(v);if(x!==null)return x;}return null;}
function single(r){return !upper(r.bet_type).includes('MULTI');}
function active(r,sport){try{return A.active(r,sport);}catch(_){return !['0','FALSE','INACTIVE'].includes(upper(r.paper_result_active))&&!r.paper_result_conflict;}}
function scope(r){const s=n(r.stake);return s===0?'STUDIO':s>0?'TRADING':'UNKNOWN';}
function actionQuality(action){
  const a=upper(action);
  if(!a||a.includes('NO_DEEPSCAN')||a==='UNKNOWN')return 0.50;
  if(a.includes('SUPER VALUE')||a.includes('VALUE_CONFIRMED')||a.includes('VALUE CONFERMATO')||a.includes('VIA LIBERA')||a.includes('TECHNICAL_EDGE')||a.includes('EDGE TECNICO')||a.includes('APPROVE'))return 0.95;
  if(a.includes('WATCHLIST'))return 0.58;
  if(a.includes('MODEL_RISK')||a.includes('RISCHIO MODELLO')||a.includes('SOFT'))return 0.32;
  if(a.includes('HIGH_RISK')||a.includes('ALTO RISCHIO')||a.includes('BLOCK'))return 0.12;
  return 0.50;
}
function deepScanAction(r,sport){return sport==='CALCIO'
  // AUDIT16D_R2: il learner SHADOW misura il segnale DeepScan pre-gate; il gate operativo resta un feature separato.
  ? (r.calcio_deepscan_raw_action||r.calcio_deepscan_signal_action||r.analysis_current_deepscan||r.calcio_deepscan_final_state_action||r.calcio_deepscan_unified_action||r.deepscan_gate_status||'')
  : (r.tennis_deepscan_canonical_action||r.analysis_current_deepscan||r.deepscan_gate_status||'');}
function deepScanOperationalAction(r,sport){return sport==='CALCIO'
  ? (r.calcio_deepscan_final_state_action||r.calcio_deepscan_unified_action||r.ds_action||'')
  : (r.tennis_deepscan_canonical_action||r.ds_action||'');}
function featureVector(r){
  const sport=upper(r.sport_type);
  const edge=firstNumber(r.edge_pp,r.edge);
  const ev=firstNumber(r.calcio_robust_ev_pct,r.ev_pct);
  const confidence=firstNumber(r.calcio_prediction_confidence_score,r.calcio_forecast_confidence_score,r.model_confidence_score,r.confidence);
  const maturity=firstNumber(r.calcio_analysis_maturity_score,r.tennis_canonical_player_evidence_score);
  const analysisQuality=clamp(
    0.35*norm(edge,-2,10)+
    0.30*norm(ev,-5,20)+
    0.20*norm(confidence,0,100)+
    0.15*norm(maturity,0,100)
  );
  const action=deepScanAction(r,sport);
  const risk=firstNumber(r.calcio_deepscan_final_state_score,r.deep_scan_risk_score);
  const gate=firstNumber(r.deepscan_gate_multiplier,r.calcio_reliability_stake_multiplier);
  const deepQuality=clamp(0.55*actionQuality(action)+0.35*(risk===null?0.50:clamp(1-risk/100))+0.10*(gate===null?0.50:clamp(gate)));
  return {
    version:VERSION,
    analysisQuality:Number(analysisQuality.toFixed(6)),
    deepScanQuality:Number(deepQuality.toFixed(6)),
    edgePp:edge,
    evPct:ev,
    confidenceScore:confidence,
    maturityScore:maturity,
    deepScanAction:text(action),
    deepScanOperationalAction:text(deepScanOperationalAction(r,sport)),
    deepScanRiskScore:risk,
    deepScanGateMultiplier:gate
  };
}
function profileDecisions(features){
  const out={};
  for(const p of PROFILES){
    const score=clamp(p.analysisWeight*features.analysisQuality+p.deepScanWeight*features.deepScanQuality);
    out[p.id]={score:Number(score.toFixed(6)),accepted:score>=p.threshold,analysisWeight:p.analysisWeight,deepScanWeight:p.deepScanWeight,threshold:p.threshold};
  }
  return out;
}
function identity(r){
  const sport=upper(r.sport_type), st=scope(r), start=r.match_start_at||r.match_date;
  return {id:r.id,sport,scope:st,strategy:text(r.strategy_tag),league:text(r.league),market:text(r.market_type||r.strategy_tag),model:text(r.model_version),home:text(r.home_team),away:text(r.away_team),selection:text(r.prediction),start,odd:n(r.odd),prob:n(r.estimated_prob)};
}
function eventKey(i){const day=String(i.start||'').slice(0,10);return JSON.stringify([i.sport,day,[i.home.toLowerCase(),i.away.toLowerCase()].sort()]);}
function canCapture(r,now){const i=identity(r);return ['CALCIO','TENNIS'].includes(i.sport)&&active(r,i.sport)&&single(r)&&i.scope!=='UNKNOWN'&&r.status==='PENDING'&&utc(i.start)!==null&&utc(i.start)>now&&i.home&&i.away&&i.selection&&i.model&&i.odd>1&&i.prob>0&&i.prob<100;}
function settlementCertified(r){return ['WON','LOST'].includes(upper(r.status))&&upper(r.settlement_contract_status)==='VERIFIED'&&text(r.settlement_source||r.settlement_contract_source||r.result_source)&&text(r.settlement_evidence_hash)&&text(r.settlement_source_event_id);}
function verifiedClv(r){if(Number(r.clv_verified)!==1)return null;const v=firstNumber(r.clv_pct,r.clv);return v===null?null:v;}
function fresh(){return {version:VERSION,policyVersion:POLICY_VERSION,createdAt:new Date().toISOString(),anchors:{},segments:{},transitions:[],authority:{...AUTHORITY}};}
function capturePayload(r,now){const i=identity(r),features=featureVector(r);return {identity:i,eventKey:eventKey(i),capturedAt:new Date(now).toISOString(),features,profiles:profileDecisions(features)};}
function anchorBasis(payload){return {identity:payload.identity,eventKey:payload.eventKey,features:payload.features,profiles:payload.profiles};}
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;}
function logLoss(p,y){const q=Math.min(0.999999,Math.max(0.000001,p));return -(y*Math.log(q)+(1-y)*Math.log(1-q));}
function metrics(samples){
  const n=samples.length;if(!n)return {n:0,wins:0,hitRatePct:null,avgOdd:null,roiPct:null,marketImpliedHitPct:null,marketExcessWinPp:null,brier:null,marketBrier:null,brierImprovement:null,logLoss:null,clvCoveragePct:0,meanClv:null,spanDays:0};
  const wins=samples.reduce((s,x)=>s+x.won,0),hit=wins/n,ret=samples.reduce((s,x)=>s+x.unitReturn,0)/n;
  const implied=mean(samples.map(x=>1/x.odd));
  const brier=mean(samples.map(x=>(x.prob-x.won)**2));const marketBrier=mean(samples.map(x=>(1/x.odd-x.won)**2));
  const ll=mean(samples.map(x=>logLoss(x.prob,x.won)));const clvs=samples.map(x=>x.clv).filter(x=>x!==null);
  const times=samples.map(x=>x.time).sort((a,b)=>a-b);const span=times.length>1?(times.at(-1)-times[0])/86400000:0;
  return {n,wins,hitRatePct:Number((hit*100).toFixed(2)),avgOdd:Number(mean(samples.map(x=>x.odd)).toFixed(3)),roiPct:Number((ret*100).toFixed(2)),marketImpliedHitPct:Number((implied*100).toFixed(2)),marketExcessWinPp:Number(((hit-implied)*100).toFixed(2)),brier:Number(brier.toFixed(6)),marketBrier:Number(marketBrier.toFixed(6)),brierImprovement:Number((marketBrier-brier).toFixed(6)),logLoss:Number(ll.toFixed(6)),clvCoveragePct:Number((clvs.length/n*100).toFixed(2)),meanClv:clvs.length?Number(mean(clvs).toFixed(6)):null,spanDays:Number(span.toFixed(1))};
}
function windowPass(samples){if(samples.length<POLICY.halfWindow)return false;const m=metrics(samples);return m.marketExcessWinPp>0&&m.roiPct>=0&&m.brierImprovement>=0&&m.clvCoveragePct>=POLICY.minimumClvCoverage*100&&m.meanClv!==null&&m.meanClv>=0;}
function profileQualified(samples){if(samples.length<POLICY.minimumAccepted)return false;const m=metrics(samples);const recent=samples.slice(-POLICY.minimumAccepted);if(m.spanDays<POLICY.minimumSpanDays||m.clvCoveragePct<POLICY.minimumClvCoverage*100||m.meanClv===null||m.meanClv<0||m.roiPct<0||m.marketExcessWinPp<=0||m.brierImprovement<0)return false;return windowPass(recent.slice(0,POLICY.halfWindow))&&windowPass(recent.slice(-POLICY.halfWindow));}
function buildSegment(samples,prior){
  const profileResults={};
  for(const p of PROFILES){const accepted=samples.filter(x=>x.profiles[p.id]?.accepted);profileResults[p.id]={profile:p,metrics:metrics(accepted),qualified:profileQualified(accepted)};}
  const control=profileResults.ANALYSIS_ONLY;
  const challengers=Object.values(profileResults).filter(x=>x.profile.id!=='ANALYSIS_ONLY'&&x.qualified&&control.metrics.n>=POLICY.minimumAccepted&&x.metrics.hitRatePct>=control.metrics.hitRatePct+POLICY.minimumHitRateDeltaPpVsAnalysisOnly&&x.metrics.marketExcessWinPp>=control.metrics.marketExcessWinPp&&x.metrics.roiPct>=control.metrics.roiPct-POLICY.maximumRoiRegressionPpVsAnalysisOnly).sort((a,b)=>b.metrics.hitRatePct-a.metrics.hitRatePct||b.metrics.marketExcessWinPp-a.metrics.marketExcessWinPp||b.metrics.roiPct-a.metrics.roiPct||a.profile.deepScanWeight-b.profile.deepScanWeight);
  const leader=challengers[0]||null;
  const status=leader?'SHADOW_LEADER_IDENTIFIED':'COLLECTING_PROSPECTIVE_EVIDENCE';
  return {status,reason:leader?`Profilo ${leader.profile.id} migliore in shadow; nessuna autorità production.`:'Campione prospettico certificato insufficiente o nessun challenger supera i guardrail.',resolvedForward:samples.length,control:control.metrics,profiles:profileResults,shadowLeader:leader?{profile:leader.profile,metrics:leader.metrics}:null,promotionEligible:false,productionAuthorized:false,updatedAt:new Date().toISOString(),priorStatus:prior?.status||null};
}
function advance(rows,input,now=Date.now()){
  if(!input||input.version!==VERSION)throw new Error('AUDIT16D_STATE_VERSION');
  const state=JSON.parse(JSON.stringify(input));
  const resolved=[];const excluded={noAnchor:0,anchorDrift:0,uncertifiedSettlement:0,timeInvalid:0,duplicates:0};
  for(const r of rows){const i=identity(r);if(!['CALCIO','TENNIS'].includes(i.sport)||!active(r,i.sport)||!single(r)||i.scope==='UNKNOWN')continue;
    if(canCapture(r,now)){
      const candidate=capturePayload(r,now),existing=state.anchors[r.id];
      if(!existing){state.anchors[r.id]={payload:candidate,hash:sha(candidate),revisions:[]};}
      else{
        if(sha(existing.payload)!==existing.hash)throw new Error('AUDIT16D_ANCHOR_HASH_INVALID');
        if(sha(anchorBasis(existing.payload))!==sha(anchorBasis(candidate))){
          const revisions=Array.isArray(existing.revisions)?existing.revisions.slice(-9):[];
          revisions.push({payload:existing.payload,hash:existing.hash,supersededAt:new Date(now).toISOString()});
          state.anchors[r.id]={payload:candidate,hash:sha(candidate),revisions};
        }
      }
    }
    if(!['WON','LOST'].includes(upper(r.status)))continue;
    const seal=state.anchors[r.id];if(!seal){excluded.noAnchor++;continue;}if(sha(seal.payload)!==seal.hash)throw new Error('AUDIT16D_ANCHOR_HASH_INVALID');
    const current=identity(r);const original=seal.payload.identity;
    if(sha(current)!==sha(original)){excluded.anchorDrift++;continue;}
    if(!settlementCertified(r)){excluded.uncertifiedSettlement++;continue;}
    const captured=utc(seal.payload.capturedAt),start=utc(original.start),settled=utc(r.settled_at||'');if(captured===null||start===null||captured>=start||start>now||(settled!==null&&settled<start)){excluded.timeInvalid++;continue;}
    const won=upper(r.status)==='WON'?1:0;resolved.push({id:r.id,sport:original.sport,scope:original.scope,eventKey:seal.payload.eventKey,time:start,won,odd:original.odd,prob:original.prob/100,unitReturn:won?original.odd-1:-1,clv:verifiedClv(r),profiles:seal.payload.profiles,strategy:original.strategy,league:original.league,market:original.market});
  }
  const counts=new Map();for(const x of resolved)counts.set(x.eventKey,(counts.get(x.eventKey)||0)+1);
  const unique=resolved.filter(x=>counts.get(x.eventKey)===1);excluded.duplicates=resolved.length-unique.length;
  const segments={};
  for(const sport of ['CALCIO','TENNIS'])for(const sc of ['STUDIO','TRADING']){const k=`${sport}:${sc}`,ss=unique.filter(x=>x.sport===sport&&x.scope===sc).sort((a,b)=>a.time-b.time||a.id-b.id),next=buildSegment(ss,state.segments[k]);segments[k]=next;if(state.segments[k]?.status!==next.status)state.transitions.push({at:new Date(now).toISOString(),segment:k,from:state.segments[k]?.status||null,to:next.status,reason:next.reason});}
  state.segments=segments;state.exclusions=excluded;state.anchorCount=Object.keys(state.anchors).length;state.resolvedForward=unique.length;state.updatedAt=new Date(now).toISOString();state.authority={...AUTHORITY};return state;
}
function install(app,db,{directory=path.join(__dirname,'audit16d-runtime'),intervalMs=60000}={}){
  const file=path.join(directory,'adaptive-shadow-state.json');let last=null,error=null;
  function readRows(){const cols=require('./audit07sR4ReadColumns').columns(db);return db.prepare(`SELECT ${cols} FROM ai_forward_test WHERE UPPER(sport_type) IN ('CALCIO','TENNIS')`).all();}
  function tick(){try{let prior=fresh();if(fs.existsSync(file)){const parsed=JSON.parse(fs.readFileSync(file,'utf8'));if(parsed.version===VERSION)prior=parsed;}const next=advance(readRows(),prior);fs.mkdirSync(directory,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next));fs.renameSync(tmp,file);last=next;error=null;}catch(e){error=e.message;console.error('[AUDIT16D_ADAPTIVE_SHADOW]',error);}}
  app.get('/api/adaptive-learning/shadow',(req,res)=>{const sport=upper(req.query.sport||'');if(!['CALCIO','TENNIS'].includes(sport))return res.status(400).json({success:false,error:'Sport non valido',authority:AUTHORITY});res.set('Cache-Control','no-store');if(error||!last)return res.status(503).json({success:false,error:error||'Valutazione shadow in avvio',authority:AUTHORITY});const segments=Object.fromEntries(Object.entries(last.segments).filter(([k])=>k.startsWith(sport+':')));return res.json({success:true,version:VERSION,policy:POLICY,sport,updatedAt:last.updatedAt,anchorCount:last.anchorCount,resolvedForward:last.resolvedForward,segments,exclusions:last.exclusions,authority:AUTHORITY});});
  const first=setTimeout(tick,3000);first.unref?.();const timer=setInterval(tick,intervalMs);timer.unref?.();return {tick,stop(){clearTimeout(first);clearInterval(timer);},stateFile:file};
}
module.exports={VERSION,POLICY,AUTHORITY,PROFILES,featureVector,profileDecisions,identity,canCapture,settlementCertified,fresh,advance,metrics,profileQualified,install};
