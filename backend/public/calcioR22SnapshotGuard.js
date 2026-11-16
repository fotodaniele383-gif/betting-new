/* R22 read-only snapshot validation and DeepScan comparison; no monetary authority. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.CalcioR22SnapshotGuard=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const s=x=>String(x??'').trim();
  const n=x=>x===null||x===undefined||x===''?NaN:Number(x);
  const okNumber=x=>Number.isFinite(n(x));
  const near=(a,b)=>Number.isFinite(n(a))&&Number.isFinite(n(b))&&Math.abs(n(a)-n(b))<=0.005;
  const eventKey=b=>s(b?.match_exposure_key||b?.calcio_event_key||b?.event_key||b?.eventKey||b?.extData?.eventIdentity?.eventKey);
  const diag=x=>{if(!x)return null;if(typeof x==='object')return x;try{return JSON.parse(x)}catch{return null}};
  function verify(bet={},snapshot={},batchId=''){
    const errors=[];const row=snapshot.row||{},result=snapshot.result||{};
    const key=eventKey(bet),received=s(snapshot.eventKey),batch=s(batchId);
    if(!key||!received||key!==received)errors.push('EVENT_IDENTITY_MISMATCH');
    if(bet.id!==undefined&&bet.id!==null&&row.id!==undefined&&row.id!==null&&String(bet.id)!==String(row.id))errors.push('ROW_ID_MISMATCH');
    if(!s(row.calcio_analysis_batch_id)|| (batch && s(row.calcio_analysis_batch_id)!==batch))errors.push('BATCH_ID_MISMATCH');
    if(s(bet.calcio_analysis_batch_id)&&s(bet.calcio_analysis_batch_id)!==s(row.calcio_analysis_batch_id))errors.push('BET_BATCH_ID_MISMATCH');
    if(s(row.calcio_portfolio_batch_status)!=='COMMITTED_BATCH'||Number(row.calcio_portfolio_batch_certified)!==1)errors.push('NOT_COMMITTED');
    if(!okNumber(row.calcio_operational_stake)||n(row.calcio_operational_stake)<0)errors.push('INVALID_OPERATIONAL_STAKE');
    if(okNumber(row.calcio_portfolio_post_cap_stake)&&!near(row.calcio_portfolio_post_cap_stake,row.calcio_operational_stake))errors.push('PORTFOLIO_STAKE_MISMATCH');
    if(result.finalMarket){
      if(s(result.finalMarket.prediction)!==s(row.prediction))errors.push('RESULT_MARKET_MISMATCH');
      if(!near(result.finalMarket.odd,row.odd))errors.push('RESULT_ODD_MISMATCH');
    }
    const final=diag(row.calcio_final_market_snapshot);
    if(final){
      if(s(final.prediction)&&s(final.prediction)!==s(row.prediction))errors.push('FINAL_DIAGNOSTIC_MARKET_MISMATCH');
      if(okNumber(final.odd)&&!near(final.odd,row.odd))errors.push('FINAL_DIAGNOSTIC_ODD_MISMATCH');
    }
    return {ok:errors.length===0,errors};
  }
  function validateBatch(bets=[],payload={},batchId=''){
    const errors=[];const rows=Array.isArray(payload.rows)?payload.rows:[];
    const byKey=new Map();
    for(const snap of rows){const key=s(snap.eventKey);if(!key||byKey.has(key))errors.push('DUPLICATE_OR_MISSING_SNAPSHOT_KEY');else byKey.set(key,snap)}
    if(rows.length!==bets.length)errors.push('BATCH_ROW_COUNT_MISMATCH');
    const seen=new Set();
    for(const bet of bets){const key=eventKey(bet);if(!key||seen.has(key)){errors.push('DUPLICATE_OR_MISSING_BET_KEY');continue}seen.add(key);
      const snap=byKey.get(key);if(!snap){errors.push('MISSING_BET_SNAPSHOT');continue}
      const valid=verify(bet,snap,batchId);for(const e of valid.errors)errors.push(e+':'+key);
    }
    for(const key of byKey.keys())if(!seen.has(key))errors.push('FOREIGN_SNAPSHOT:'+key);
    return {ok:errors.length===0,errors};
  }
  function capture(bet={}){
    const pick=(...xs)=>{for(const x of xs)if(okNumber(x))return Number(x);return null};
    return {
      market:s(bet.prediction),odd:pick(bet.odd),
      probabilityPct:pick(bet.estimatedProb,bet.estimated_prob,bet.rawProb),
      edgePp:pick(bet.edge_pp,bet.edge),evPct:pick(bet.ev_pct),
      reliabilityScore:pick(bet.prediction_reliability_score,bet.predictionReliability?.score),
      qualityScore:pick(bet.calcio_data_quality_score,bet.dataQualityAuthority?.score),
      paperStake:pick(bet.calcio_operational_stake,bet.operationalStake,bet.invested),
      batchStatus:s(bet.calcio_portfolio_batch_status),
      evidenceMode:s(bet.xgEvidenceMode||bet.extData?.xgEvidenceMode)
    };
  }
  function compare(before={},after={}){
    const changes=[];const findings=[];
    for(const key of ['market','odd','probabilityPct','edgePp','evPct','reliabilityScore','qualityScore','paperStake','batchStatus','evidenceMode']){
      const a=before[key],b=after[key];if(a===undefined||a===null||b===undefined||b===null)continue;
      if(typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<0.005)continue;
      if(a===b)continue;
      changes.push({field:key,before:a,after:b});
      if(['reliabilityScore','qualityScore','probabilityPct','evPct'].includes(key)&&typeof a==='number'&&typeof b==='number'&&b<a)findings.push('LOWER_'+key.toUpperCase());
    }
    return {changes,findings,hasDowngrade:findings.length>0};
  }
  return Object.freeze({version:'R22_SNAPSHOT_IDENTITY_AND_COMPARISON_V1',eventKey,verify,validateBatch,capture,compare});
});
