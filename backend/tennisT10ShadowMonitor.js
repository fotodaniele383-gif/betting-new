'use strict';

const crypto = require('crypto');
const t9Maturity = require('./tennisEvidenceMaturityT9');

const VERSION = 'AUDIT16D_R3_T10_R1_SHADOW_MONITOR_V1';
const FREEZE_VERSION = 'AUDIT16D_R3_T10_SHADOW';
const FREEZE_REPORT_HASH = 'f4616c98f473e17c2081b092d16f910d76a6941976720a3db3f0c2dcdc60ac82';
const FREEZE_HOLDOUT = 50;
const INTERIM_HOLDOUT = 75;
const PREFERRED_HOLDOUT = 100;
const BOOTSTRAP_REPS = 2000;

const FROZEN_CANDIDATES = Object.freeze({
  LOGIT_SHRINKAGE_V1: Object.freeze({
    type: 'LOGIT_SHRINKAGE',
    intercept: 0,
    slope: 0.65935936,
    lambda: 0.01,
    source: 'T10_SHADOW_HOLDOUT50_FREEZE'
  }),
  PLATT_LOGIT_V1: Object.freeze({
    type: 'PLATT_LOGIT',
    intercept: -0.18718768,
    slope: 0.80498062,
    lambda: 0.01,
    source: 'T10_SHADOW_HOLDOUT50_FREEZE'
  })
});

const FREEZE_BASELINE = Object.freeze({
  holdout: 50,
  identity: Object.freeze({ brier: 0.270545, logLoss: 0.75515, calibrationBiasPp: 13.96, ece10: 0.196304 }),
  market: Object.freeze({ brier: 0.252015, logLoss: 0.700483, calibrationBiasPp: 2.68, ece10: 0.118116 }),
  logit: Object.freeze({ brier: 0.251813, logLoss: 0.700625, calibrationBiasPp: 6.92, ece10: 0.10082 }),
  platt: Object.freeze({ brier: 0.253699, logLoss: 0.705019, calibrationBiasPp: 6.16, ece10: 0.122418 })
});

function upper(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
function finite(v) { return Number.isFinite(Number(v)); }
function clamp(x, a=.001, b=.999) { return Math.max(a, Math.min(b, Number(x))); }
function round(x, d=6) { return finite(x) ? Number(Number(x).toFixed(d)) : null; }
function sigmoid(z) { return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); }
function logit(p) { p=clamp(p); return Math.log(p/(1-p)); }
function yOf(r) { return upper(r.status) === 'WON' ? 1 : 0; }
function tableExists(db, table) {
  try { return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
  catch (_) { return false; }
}
function qtile(arr,q){
  if(!arr.length) return null;
  const s=[...arr].sort((a,b)=>a-b), p=(s.length-1)*q, i=Math.floor(p), f=p-i;
  return s[i+1] !== undefined ? s[i] + f*(s[i+1]-s[i]) : s[i];
}
function identityPredict(r){ return clamp(Number(r.model_probability_pct)/100); }
function marketPredict(r){ return clamp(Number(r.market_probability_pct)/100); }
function frozenPredict(model){
  return r => sigmoid(Number(model.intercept||0) + Number(model.slope)*logit(Number(r.model_probability_pct)/100));
}
function metrics(rows,predict){
  if(!rows.length) return {n:0};
  let sb=0, sl=0, wins=0, ps=[];
  for(const r of rows){
    const y=yOf(r), p=clamp(predict(r));
    sb+=(p-y)**2; sl+=-(y*Math.log(p)+(1-y)*Math.log(1-p)); wins+=y; ps.push({p,y});
  }
  const n=rows.length, avg=ps.reduce((a,x)=>a+x.p,0)/n, actual=wins/n;
  let ece=0;
  for(let lo=.4;lo<1;lo+=.1){
    const b=ps.filter(x=>x.p>=lo&&x.p<lo+.1);
    if(!b.length) continue;
    const ap=b.reduce((a,x)=>a+x.p,0)/b.length, ar=b.reduce((a,x)=>a+x.y,0)/b.length;
    ece += b.length/n * Math.abs(ap-ar);
  }
  return {
    n,wins,hitRatePct:round(100*wins/n,2),brier:round(sb/n),logLoss:round(sl/n),
    avgProbabilityPct:round(100*avg,2),actualWinRatePct:round(100*actual,2),
    calibrationBiasPp:round(100*(avg-actual),2),ece10:round(ece)
  };
}
function pairedBootstrap(rows,pA,pB,reps,seedText){
  if(rows.length < 10) return null;
  let s=parseInt(crypto.createHash('sha256').update(seedText).digest('hex').slice(0,8),16)>>>0;
  if(!s) s=1;
  const rnd=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};
  const bd=[],ld=[],n=rows.length;
  for(let z=0;z<reps;z++){
    let b=0,l=0;
    for(let i=0;i<n;i++){
      const r=rows[Math.floor(rnd()*n)], y=yOf(r), a=clamp(pA(r)), c=clamp(pB(r));
      b += (c-y)**2 - (a-y)**2;
      l += (-(y*Math.log(c)+(1-y)*Math.log(1-c))) - (-(y*Math.log(a)+(1-y)*Math.log(1-a)));
    }
    bd.push(b/n); ld.push(l/n);
  }
  return {
    reps,
    brierImprovement95:[round(qtile(bd,.025)),round(qtile(bd,.975))],
    logLossImprovement95:[round(qtile(ld,.025)),round(qtile(ld,.975))]
  };
}
function trend(current, frozen){
  return {
    brierDelta: round(current.brier - frozen.brier),
    logLossDelta: round(current.logLoss - frozen.logLoss),
    calibrationBiasDeltaPp: round(current.calibrationBiasPp - frozen.calibrationBiasPp,2),
    ece10Delta: round(current.ece10 - frozen.ece10)
  };
}
function candidateState(name, holdoutN, candidate, identity, bootstrap){
  const improvesBoth = candidate.brier < identity.brier && candidate.logLoss < identity.logLoss;
  const reducesBias = Math.abs(candidate.calibrationBiasPp) < Math.abs(identity.calibrationBiasPp);
  const robust = Boolean(bootstrap && bootstrap.brierImprovement95[0] > 0 && bootstrap.logLossImprovement95[0] > 0);
  let state = improvesBoth && reducesBias ? 'SHADOW_SIGNAL_STABLE' : 'SHADOW_SIGNAL_NOT_CONFIRMED';
  if(holdoutN >= INTERIM_HOLDOUT) state = robust ? 'INTERIM_ROBUST_SIGNAL' : (improvesBoth && reducesBias ? 'INTERIM_SIGNAL' : 'INTERIM_NO_SIGNAL');
  if(holdoutN >= PREFERRED_HOLDOUT) state = robust ? 'PREFERRED_SAMPLE_ROBUST_REVIEW_SIGNAL' : (improvesBoth && reducesBias ? 'PREFERRED_SAMPLE_SIGNAL_NOT_ROBUST' : 'PREFERRED_SAMPLE_NO_SIGNAL');
  return {name,state,improvesIdentityBothProperScores:improvesBoth,reducesAbsoluteCalibrationBias:reducesBias,bootstrapBothLowerBoundsAboveZero:robust};
}
function inspect(db){
  if(!db || typeof db.prepare !== 'function') throw new Error('T10_R1_DB_REQUIRED');
  const required=['ai_forward_test','tennis_prediction_snapshots','tennis_forward_cohort_members'];
  const missing=required.filter(t=>!tableExists(db,t));
  if(missing.length) return {success:false,status:'DATA_QUALITY_BLOCKED',missingTables:missing,version:VERSION,readOnly:true};

  const maturity=t9Maturity.inspect(db);
  if(maturity.success===false) return {success:false,status:'DATA_QUALITY_BLOCKED',version:VERSION,readOnly:true,maturity};

  const rows=db.prepare(`SELECT s.bet_id,s.model_probability_pct,s.market_probability_pct,s.snapshot_hash,s.snapshot_id,
      f.status,f.settlement_contract_status,c.cohort_role,c.holdout_locked,c.maturity_status,c.leakage_status
    FROM tennis_prediction_snapshots s
    JOIN ai_forward_test f ON f.id=s.bet_id
    JOIN tennis_forward_cohort_members c ON c.bet_id=s.bet_id
    WHERE s.is_calibration_anchor=1
      AND UPPER(COALESCE(s.snapshot_status,''))='VALID_PREMATCH'
      AND UPPER(COALESCE(f.status,'')) IN ('WON','LOST')
      AND UPPER(COALESCE(f.settlement_contract_status,''))='VERIFIED'
      AND UPPER(COALESCE(c.leakage_status,''))='CLEAR'
      AND s.model_probability_pct IS NOT NULL
      AND s.market_probability_pct IS NOT NULL`).all();
  const holdout=rows.filter(r=>upper(r.cohort_role)==='HOLDOUT');
  if(holdout.length < FREEZE_HOLDOUT) return {success:false,status:'HOLDOUT_BELOW_T10_FREEZE',version:VERSION,readOnly:true,holdout:holdout.length,maturity};

  const pLogit=frozenPredict(FROZEN_CANDIDATES.LOGIT_SHRINKAGE_V1);
  const pPlatt=frozenPredict(FROZEN_CANDIDATES.PLATT_LOGIT_V1);
  const identity=metrics(holdout,identityPredict), market=metrics(holdout,marketPredict), logitM=metrics(holdout,pLogit), plattM=metrics(holdout,pPlatt);
  const logitBoot=pairedBootstrap(holdout,pLogit,identityPredict,BOOTSTRAP_REPS,`${VERSION}|LOGIT|${holdout.length}`);
  const plattBoot=pairedBootstrap(holdout,pPlatt,identityPredict,BOOTSTRAP_REPS,`${VERSION}|PLATT|${holdout.length}`);
  const logitVsMarket=pairedBootstrap(holdout,pLogit,marketPredict,BOOTSTRAP_REPS,`${VERSION}|LOGIT|MARKET|${holdout.length}`);
  const plattVsMarket=pairedBootstrap(holdout,pPlatt,marketPredict,BOOTSTRAP_REPS,`${VERSION}|PLATT|MARKET|${holdout.length}`);

  const preferredProgressPct=round(Math.min(100,100*holdout.length/PREFERRED_HOLDOUT),1);
  const postFreezeProgressPct=round(Math.min(100,100*Math.max(0,holdout.length-FREEZE_HOLDOUT)/(PREFERRED_HOLDOUT-FREEZE_HOLDOUT)),1);
  const state=holdout.length>=PREFERRED_HOLDOUT?'PREFERRED_REVIEW_READY':holdout.length>=INTERIM_HOLDOUT?'INTERIM_MONITORING':'MONITORING_50_TO_74';
  const logitState=candidateState('LOGIT_SHRINKAGE_V1',holdout.length,logitM,identity,logitBoot);
  const plattState=candidateState('PLATT_LOGIT_V1',holdout.length,plattM,identity,plattBoot);

  return {
    success:true, version:VERSION, readOnly:true, shadowOnly:true, generatedAt:new Date().toISOString(), state,
    freeze:{version:FREEZE_VERSION,reportHash:FREEZE_REPORT_HASH,holdoutAtFreeze:FREEZE_HOLDOUT,developmentAtFreeze:239,candidates:FROZEN_CANDIDATES},
    progress:{
      holdoutSettled:holdout.length,
      newHoldoutSinceFreeze:Math.max(0,holdout.length-FREEZE_HOLDOUT),
      minimumAudit:FREEZE_HOLDOUT,
      interimReview:INTERIM_HOLDOUT,
      preferredReview:PREFERRED_HOLDOUT,
      remainingTo75:Math.max(0,INTERIM_HOLDOUT-holdout.length),
      remainingTo100:Math.max(0,PREFERRED_HOLDOUT-holdout.length),
      preferredProgressPct,postFreezeProgressPct
    },
    evidence:{clv:maturity.clv,schedule:maturity.schedule,normalization:maturity.normalization},
    current:{
      identity:{metrics:identity,trendVsFreeze:trend(identity,FREEZE_BASELINE.identity)},
      market:{metrics:market,trendVsFreeze:trend(market,FREEZE_BASELINE.market)},
      logitV1:{metrics:logitM,trendVsFreeze:trend(logitM,FREEZE_BASELINE.logit),bootstrapVsIdentity:logitBoot,bootstrapVsMarket:logitVsMarket,signal:logitState},
      plattV1:{metrics:plattM,trendVsFreeze:trend(plattM,FREEZE_BASELINE.platt),bootstrapVsIdentity:plattBoot,bootstrapVsMarket:plattVsMarket,signal:plattState}
    },
    authority:{modelChange:false,probabilityChange:false,deepScanChange:false,qualityGateChange:false,stakeChange:false,settlementChange:false,clvChange:false,scheduleBlocking:false,automaticPromotion:false},
    nextAction: holdout.length < INTERIM_HOLDOUT ? 'CONTINUE_FROZEN_SHADOW_TO_75'
      : holdout.length < PREFERRED_HOLDOUT ? 'INTERIM_SHADOW_REVIEW_CONTINUE_TO_100'
      : 'SEPARATE_GOVERNANCE_REVIEW_REQUIRED_NO_AUTOMATIC_MODEL_CHANGE'
  };
}

module.exports={VERSION,FREEZE_VERSION,FREEZE_REPORT_HASH,FREEZE_HOLDOUT,INTERIM_HOLDOUT,PREFERRED_HOLDOUT,BOOTSTRAP_REPS,FROZEN_CANDIDATES,FREEZE_BASELINE,inspect,metrics,frozenPredict,pairedBootstrap};
