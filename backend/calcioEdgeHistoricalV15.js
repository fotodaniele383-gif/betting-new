'use strict';
// Historical probability calibration: VERIFIED forward observations only, as-of before the decision.
// Never promote legacy DS×Gate counts or post-decision outcomes into current evidence.
const VERSION = 'CALCIO_EDGE_KELLY_V15_HISTORICAL_ASOF_1';
const finite = x => x === '' || x === undefined || x === null || !Number.isFinite(Number(x)) ? null : Number(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round = (x, n=3) => Number(x.toFixed(n));
function family(sel) { const s=String(sel||'').toUpperCase().replace(/\s+/g,''); return s==='O2.5'||s==='U2.5'?s:['1','X','2'].includes(s)?'1X2':null; }
function build(rows = [], {prediction, probabilityPct, asOf, eventKey}={}) {
  const f=family(prediction), p=finite(probabilityPct), asOfMs=Date.parse(asOf || '');
  if(!f || p === null || p <= 0 || p >= 100 || !Number.isFinite(asOfMs)) return {version:VERSION,status:'NO_MATCHABLE_HISTORY',sample:0,calibrationAdjustmentPp:0};
  const results=[], seen=new Set();
  for(const r of rows) {
    if (String(r.sport_type||'').toUpperCase()!=='CALCIO') continue;
    if (!['WON','LOST'].includes(String(r.status||'').toUpperCase())) continue;
    if (Number(r.paper_result_active)!==1 || Number(r.paper_result_conflict)!==0) continue;
    if (r.calcio_output_coherence_status!=='OUTPUT_COHERENCE_CERTIFIED') continue;
    if (!r.settlement_source || !r.calcio_analysis_batch_id) continue;
    if (!String(r.model_version||'').includes('FOOTBALL_XG_DIXON_COLES_PROBABILITY_INTEGRITY')) continue;
    const settle=Date.parse(r.settled_at || '');
    if(!Number.isFinite(settle) || settle >= asOfMs) continue;
    const recordP=finite(r.estimated_prob);
    if (recordP===null || Math.abs(recordP-p)>7.5) continue;
    if(family(r.prediction)!==f) continue;
    const key=String(r.calcio_event_key || r.id||'') + '|' + String(r.prediction||'');
    if(!key.trim() || key===String(eventKey||'')+'|'+String(prediction||'') || seen.has(key)) continue;
    seen.add(key); results.push({predicted:recordP,won:r.status==='WON'?1:0});
  }
  const sample=results.length;
  if(!sample) return {version:VERSION,status:'NO_MATCHABLE_HISTORY',sample:0,calibrationAdjustmentPp:0,confidence:'UNAVAILABLE'};
  const meanModel=results.reduce((s,r)=>s+r.predicted,0)/sample;
  const winRate=100*results.reduce((s,r)=>s+r.won,0)/sample;
  const brier=results.reduce((s,r)=>s+(r.predicted/100-r.won)**2,0)/sample;
  const diff=winRate-meanModel;
  // Only negative historical drift is allowed to reduce risk. NEVER amplify probability from short samples.
  const adjustment=sample>=30 ? clamp(Math.min(0,diff)*Math.min(sample/80,1),-8,0) : 0;
  return {version:VERSION,status:sample>=30?'OBSERVED_STRATIFIED_HISTORY':'SMALL_SAMPLE_DIAGNOSTIC_ONLY',sample,meanPredictedPct:round(meanModel),empiricalWinPct:round(winRate),brier:round(brier,4),calibrationGapPp:round(diff),calibrationAdjustmentPp:round(adjustment),confidence:sample>=80?'MODERATE':sample>=30?'LIMITED':'LOW',note:'Settled as-of, current model family, active conflict-free forward rows; no claims of independent model calibration.'};
}
function resolve(db, options={}) {
  if (!db || typeof db.prepare!=='function') return build([] ,options);
  // All fields used by strict filter are explicitly selected. Read-only SELECT, no schema mutations.
  const rows=db.prepare(`SELECT id,sport_type,status,settlement_source,settled_at,calcio_analysis_batch_id,calcio_event_key,prediction,estimated_prob,model_version,paper_result_active,paper_result_conflict,calcio_output_coherence_status
     FROM ai_forward_test WHERE sport_type='CALCIO' AND status IN ('WON','LOST') AND paper_result_active=1 AND paper_result_conflict=0 AND calcio_output_coherence_status='OUTPUT_COHERENCE_CERTIFIED' AND settled_at < ?`).all(options.asOf);
  return build(rows,options);
}
module.exports={VERSION,family,build,resolve};
