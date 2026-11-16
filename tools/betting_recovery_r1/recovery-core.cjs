'use strict';
/* BETTINGAPP RECOVERY R1 — pure, deterministic, read-only analysis helpers. */
const N = x => (x === null || x === undefined || (typeof x === 'string' && !x.trim())) ? null : (Number.isFinite(Number(x)) ? Number(x) : null);
const pct = x => N(x) === null ? null : Math.max(0, Math.min(100, Number(x)));
const rt = (x, digits = 3) => x === null || !Number.isFinite(x) ? null : Number(x.toFixed(digits));
const yes = x => x === true || x === 1 || x === '1';
const asText = x => x == null ? '' : String(x);
function json(value) { if (!value) return null; if (typeof value === 'object') return value; try {return JSON.parse(value);} catch {return null;} }
function isoBefore(value, boundary) {
  if (!value || !boundary) return null;
  const t = Date.parse(value), b = Date.parse(boundary);
  return Number.isFinite(t) && Number.isFinite(b) ? t <= b : null;
}
function confidenceCategory(value) {
  const v = pct(value); return v === null ? 'UNKNOWN' : v < 20 ? 'LOW_OBSERVED_COVERAGE' : 'OBSERVED';
}
function evidenceState(row) {
  const assessment = json(row.calcio_data_quality_audit) || {};
  const e = assessment.evidence || {};
  const mode = asText(e.xgEvidenceMode || row.calcio_historical_coverage_status).toUpperCase();
  const sourcePct = pct(e.sourceConfidencePct);
  const sourceState = sourcePct === null ? 'UNKNOWN' : sourcePct === 0 ? 'NO_SOURCE_EVIDENCE' : 'PARTIAL_OR_OBSERVED';
  const xg = mode.includes('REAL_XG') && mode.includes('STRONG') ? 'REAL_DOCUMENTED' : mode.includes('PROXY') || mode.includes('PRIOR') || mode.includes('ESTIMATED') || mode.includes('LKG') ? 'PROXY_OR_MODEL' : 'UNKNOWN';
  const lineup = asText(e.lineupStatus || row.calcio_lineup_status).toUpperCase();
  return {
    quoteDirect: yes(row.calcio_odds_direct), quoteCertified: yes(row.calcio_odds_certified), quoteOperationalEligible: yes(row.calcio_odds_operational_eligible),
    quoteLastUpdate: row.calcio_odds_last_update || null, xg, xgMode: mode || 'UNKNOWN',
    lineup: lineup.includes('CONFIRMED') && !lineup.includes('NOT_') ? 'CONFIRMED' : 'UNKNOWN_OR_PROBABLE',
    sourcePct: rt(sourcePct, 2), sourceState, sourceConfidenceCategory: confidenceCategory(sourcePct),
    qualityStatus: row.calcio_data_quality_status || 'UNKNOWN'
  };
}
function mathAudit(row) {
  const p = pct(row.estimated_prob), q = N(row.odd), qnet=N(row.calcio_net_executable_odd), ev = N(row.ev_pct);
  const robust = pct(row.calcio_robust_probability), rev = N(row.calcio_robust_ev_pct);
  const netOdd = qnet !== null && qnet > 1 ? qnet : q;
  const implied = q !== null && q > 1 ? 100 / q : null;
  const recomputed = p !== null && netOdd !== null && netOdd > 1 ? 100 * (p / 100 * netOdd - 1) : null;
  const robustGross = robust !== null && implied !== null ? 100 * (robust / 100 * q - 1) : null;
  const robustNet = robust !== null && netOdd !== null && netOdd>1 ? 100 * (robust / 100 * netOdd - 1) : null;
  const delta = recomputed !== null && ev !== null ? recomputed - ev : null;
  const robustDelta = robustGross !== null && rev !== null ? robustGross - rev : null;
  const netSignConflict = rev !== null && rev > 0 && robustNet !== null && robustNet <= 0;
  return { modelProbabilityPct: p, odd: q, netExecutableOdd: netOdd, commissionPct:N(row.calcio_exchange_commission_pct), impliedPct: rt(implied), evStoredPct: ev, evRecomputedPct: rt(recomputed), evDifferencePp: rt(delta), evMismatch: delta !== null && Math.abs(delta) > 0.35, robustProbabilityPct: robust, robustEvStoredPct: rev, robustEvGrossRecomputedPct:rt(robustGross), robustEvNetRecomputedPct:rt(robustNet), robustEvDifferencePp: rt(robustDelta), robustEvMismatch: robustDelta !== null && Math.abs(robustDelta) > 0.35,
    netSignConflict, evQuoteBasis: qnet!==null?'NET_EXECUTABLE_ODD':'GROSS_ODD_FALLBACK',
    edgeStatus: 'NOT_CERTIFIED_WITHOUT_INDEPENDENT_CALIBRATION_AND_VALID_SAME_BOOK_MARKET',
    noVigStatus: 'NOT_CERTIFIED_WITHOUT_COMPLETE_SAME_BOOK_SAME_MARKET_TIMESTAMP',
    robustEvStatus: robust !== null && rev !== null ? 'ARITHMETIC_ONLY_NOT_CALIBRATION_CERTIFIED' : 'NOT_ESTIMABLE' };
}
function blockers(row) {
  const audit = json(row.calcio_stake_authority_audit) || {};
  const explicit = Array.isArray(audit.hardVetoes) ? audit.hardVetoes.map(String) : [];
  const structured = [];
  const idx = N(row.calcio_prediction_index_score);
  const reliability = N(row.calcio_prediction_reliability_score);
  const robustEv = N(row.calcio_robust_ev_pct);
  const quality = asText(row.calcio_data_quality_status);
  if (idx !== null && idx < 60) structured.push('IPM_LT_60');
  if (reliability !== null && reliability < 55) structured.push('RELIABILITY_LT_55');
  if (quality === 'DATA_QUALITY_BLOCKED') structured.push('DATA_QUALITY_BLOCKED');
  if (robustEv === null) structured.push('ROBUST_EV_MISSING');
  else if (robustEv <= 0) structured.push('ROBUST_EV_NONPOSITIVE');
  if (!yes(row.calcio_odds_certified) || !yes(row.calcio_odds_direct)) structured.push('QUOTE_PROVENANCE_NOT_CERTIFIED');
  if (asText(row.calcio_portfolio_batch_status).includes('PENDING')) structured.push('PORTFOLIO_BATCH_PENDING');
  return { structured: [...new Set(structured)], explicit, rawReason: asText(row.calcio_stake_authority_reason), authorityStatus: row.calcio_stake_authority_status || 'UNKNOWN',
    finalStake: N(row.calcio_operational_stake ?? row.stake), modelStake: N(row.calcio_stake_authority_model_stake), preCapStake: N(row.calcio_portfolio_pre_cap_stake), postCapStake: N(row.calcio_portfolio_post_cap_stake),
    batchStatus: row.calcio_portfolio_batch_status || 'UNKNOWN',
    policyPriority: 'NO_SINGLE_CAUSE_INFERENCE_WHEN_MULTIPLE_VETOES' };
}
function auditRow(row) {
  const math = mathAudit(row), evidence = evidenceState(row), stake = blockers(row);
  return { id: row.id, date: row.match_date, match: [row.home_team || '?', row.away_team || '?'].join(' - '), selection: row.prediction, status: row.status,
    ipm: N(row.calcio_prediction_index_score), reliability: N(row.calcio_prediction_reliability_score),
    evidence, math, stake, historySample: N(row.historical_combo_resolved), historySource: row.historical_combo_version || null,
    analysisTimestamp: row.analysis_updated_at || null, tradingScope: row.trading_scope || row.paper_trading_scope || null };
}
function calibrationEligibility(row) {
  const reasons=[];
  const status=asText(row.status).toUpperCase();
  if (!['WON','LOST'].includes(status)) reasons.push('NOT_BINARY_SETTLED');
  if (pct(row.estimated_prob) === null || N(row.odd) === null || N(row.odd) <= 1) reasons.push('MISSING_PROBABILITY_OR_ODD');
  if (!yes(row.calcio_odds_certified) || !yes(row.calcio_odds_direct) || !yes(row.calcio_odds_operational_eligible)) reasons.push('UNCERTIFIED_QUOTE');
  if (isoBefore(row.calcio_odds_last_update, row.match_date) !== true) reasons.push('NO_VERIFIED_PREMATCH_QUOTE_TIMESTAMP');
  // analysis_updated_at is required because postmatch model revisions cannot be backtested as prematch.
  if (isoBefore(row.analysis_updated_at, row.match_date) !== true) reasons.push('NO_VERIFIED_PREMATCH_ANALYSIS_TIMESTAMP');
  if (asText(row.calcio_market_finalization_mode).includes('LEGACY')) reasons.push('LEGACY_FINALIZATION');
  return {valid:reasons.length===0,reasons};
}
function calibrationReport(rows) {
  const reasons = {}, eligible=[], dedup = new Set();
  for (const row of rows) {
    const e=calibrationEligibility(row);
    if (!e.valid) {for (const s of e.reasons) reasons[s]=(reasons[s]||0)+1;continue;}
    const key=asText(row.calcio_event_key || row.match_exposure_key || [row.match_date,row.home_team,row.away_team].join('|'))+'|'+asText(row.prediction);
    if (dedup.has(key)) {reasons.DUPLICATE_MARKET_EVENT=(reasons.DUPLICATE_MARKET_EVENT||0)+1;continue;}
    dedup.add(key);eligible.push(row);
  }
  const bs=eligible.reduce((v,r)=>v+Math.pow(pct(r.estimated_prob)/100-(asText(r.status).toUpperCase()==='WON'?1:0),2),0);
  const ll=eligible.reduce((v,r)=>{ const p=Math.min(.999999,Math.max(.000001,pct(r.estimated_prob)/100)); return v-(asText(r.status).toUpperCase()==='WON'?Math.log(p):Math.log(1-p));},0);
  const buckets=Array.from({length:10},(_,i)=>({bucket:`${i*10}-${(i+1)*10}%`,n:0,expected:0,observed:0}));
  for(const row of eligible) {const p=pct(row.estimated_prob),b=buckets[Math.min(9,Math.floor(p/10))];b.n++;b.expected+=p;b.observed+=asText(row.status).toUpperCase()==='WON'?100:0;}
  for(const b of buckets) {b.expectedPct=b.n?rt(b.expected/b.n,2):null;b.observedPct=b.n?rt(b.observed/b.n,2):null;delete b.expected;delete b.observed;}
  return { nTotal:rows.length,nEligible:eligible.length,exclusions:reasons,brier:eligible.length?rt(bs/eligible.length,6):null,logLoss:eligible.length?rt(ll/eligible.length,6):null,buckets,
    calibrationCertified:false,status:'DESCRIPTIVE_ONLY_NOT_OUT_OF_SAMPLE_CERTIFIED',reason:'Snapshot di dati storici e score di produzione non dimostrano calibrazione walk-forward indipendente, assenza leakage o versionamento stabile del modello.' };
}
function summarize(rows) {
  const items=rows.map(auditRow), counts={}, sources={realXg:0,proxyXg:0,unknownXg:0,newsUnknown:0,lineupUnconfirmed:0,oddsCertified:0};
  let nonzero=0, mismatch=0, robustMismatch=0, robustPositive=0,robustNetSignConflict=0;
  for (const r of items) {
    if ((r.stake.finalStake||0)>0) nonzero++;
    if(r.math.evMismatch) mismatch++;
    if(r.math.robustEvMismatch) robustMismatch++;
    if(r.math.netSignConflict)robustNetSignConflict++;
    if((r.math.robustEvStoredPct??-1)>0) robustPositive++;
    for(const b of r.stake.structured) counts[b]=(counts[b]||0)+1;
    if (r.evidence.xg==='REAL_DOCUMENTED') sources.realXg++; else if (r.evidence.xg==='PROXY_OR_MODEL') sources.proxyXg++; else sources.unknownXg++;
    if (r.evidence.sourceState!=='PARTIAL_OR_OBSERVED') sources.newsUnknown++;
    if(r.evidence.lineup!=='CONFIRMED') sources.lineupUnconfirmed++;
    if(r.evidence.quoteCertified&&r.evidence.quoteDirect) sources.oddsCertified++;
  }
  return {records:items.length,nonzeroOperationalStake:nonzero,zeroOperationalStake:items.length-nonzero,evMismatchCount:mismatch,robustEvMismatchCount:robustMismatch,robustNetSignConflictCount:robustNetSignConflict,positiveRobustEv:robustPositive,blockerCounts:counts,evidenceCoverage:sources,rows:items};
}
module.exports={N,pct,rt,yes,json,isoBefore,evidenceState,mathAudit,blockers,auditRow,calibrationEligibility,calibrationReport,summarize};
