'use strict';
// Read-only inspection of the exact current SQLite. No stake or quality overrides.
const VERSION = 'SAFE13_CALCIO_STAKE_ROOT_CAUSE_R1';
const q = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const s = v => String(v == null ? '' : v);
function parse(raw) {try{return JSON.parse(s(raw)) || {}}catch{return {}}}
function build(db, opts = {}) {
  const limit = Math.max(1, Math.min(75, Math.floor(q(opts.limit) || 30)));
  const totals = db.prepare(`SELECT COUNT(*) AS n,
 SUM(CASE WHEN COALESCE(ev_pct,0)>0 THEN 1 ELSE 0 END) AS ev_positive,
 SUM(CASE WHEN COALESCE(calcio_prediction_index_score,0)>=60 THEN 1 ELSE 0 END) AS ipm_60,
 SUM(CASE WHEN COALESCE(calcio_prediction_reliability_score,0)>=55 THEN 1 ELSE 0 END) AS reliability_55,
 SUM(CASE WHEN COALESCE(calcio_prediction_index_score,0)>=60 AND COALESCE(calcio_prediction_reliability_score,0)>=55 THEN 1 ELSE 0 END) AS both_eligible_thresholds,
 SUM(CASE WHEN COALESCE(calcio_operational_stake,0)>0 THEN 1 ELSE 0 END) AS operational_stake_positive,
 SUM(CASE WHEN COALESCE(calcio_stake_authority_model_stake,0)>0 THEN 1 ELSE 0 END) AS theoretical_model_stake_positive,
 SUM(CASE WHEN calcio_portfolio_batch_status='PENDING_BATCH' THEN 1 ELSE 0 END) AS pending_batches,
 SUM(CASE WHEN calcio_portfolio_batch_status='COMMITTED_BATCH' THEN 1 ELSE 0 END) AS committed_batches,
 SUM(CASE WHEN calcio_data_quality_status='DATA_QUALITY_BLOCKED' THEN 1 ELSE 0 END) AS data_quality_blocked,
 SUM(CASE WHEN calcio_data_quality_status='DATA_QUALITY_LIMITED' THEN 1 ELSE 0 END) AS data_quality_limited,
 SUM(CASE WHEN calcio_deepscan_raw_action LIKE '%VIA LIBERA%' THEN 1 ELSE 0 END) AS deepscan_raw_green,
 SUM(CASE WHEN calcio_deepscan_final_state_action='VALUE CONFERMATO / MICRO' OR calcio_deepscan_final_state_action='EDGE TECNICO' THEN 1 ELSE 0 END) AS deepscan_final_positive
 FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'`).get();
  const rows = db.prepare(`SELECT id,match_date,home_team,away_team,calcio_analysis_batch_id,
 calcio_portfolio_batch_status,calcio_prediction_index_score,calcio_prediction_reliability_score,
 calcio_data_quality_status,calcio_data_quality_reasons,calcio_deepscan_raw_action,
 calcio_deepscan_final_state_action,calcio_deepscan_final_state_score,
 calcio_stake_authority_model_stake,calcio_stake_authority_final_stake,
 calcio_stake_authority_audit,calcio_stake_authority_reason,calcio_operational_stake,
 calcio_operational_action,ev_pct,calcio_robust_ev_pct,calcio_decision_state
 FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' ORDER BY id DESC LIMIT ?`).all(limit).map(r => {
    const audit = parse(r.calcio_stake_authority_audit);
    const failures = Array.isArray(audit.hardVetoes) ? audit.hardVetoes : [];
    const reasons = [...new Set([...(failures),...(s(r.calcio_data_quality_reasons).split(' | '))].filter(Boolean))].slice(0,15);
    return {id:r.id,match:`${s(r.home_team)} - ${s(r.away_team)}`,matchDate:r.match_date,
      batchId:r.calcio_analysis_batch_id,batchStatus:r.calcio_portfolio_batch_status,
      predictionIndex:r.calcio_prediction_index_score,reliability:r.calcio_prediction_reliability_score,
      dataQuality:r.calcio_data_quality_status,modelStake:q(r.calcio_stake_authority_model_stake),
      authorityStake:q(r.calcio_stake_authority_final_stake),operationalStake:q(r.calcio_operational_stake),
      evTheoreticalPct:r.ev_pct,evRobustPct:r.calcio_robust_ev_pct,
      deepScanRaw:r.calcio_deepscan_raw_action,deepScanFinal:r.calcio_deepscan_final_state_action,
      deepScanRisk:r.calcio_deepscan_final_state_score,decisionState:r.calcio_decision_state,
      operationalAction:r.calcio_operational_action,blockingReasons:reasons,
      stakeReason:s(r.calcio_stake_authority_reason).slice(0,1000)};
  });
  return {success:true,readOnly:true,version:VERSION,serverMode:'SAFE13_MANUAL_PAPER_ONLY',
    portBatchEndpoint:'POST /api/calcio/portfolio/finalize-batch',
    quantV2Active:process.env.BETTINGAPP_QUANT_V2==='1',
    totals,rows,
    explanations:[
      'HTTP 423 era introdotto dalla whitelist manuale: il percorso di allocazione era escluso.',
      'Il segnale DeepScan iniziale e quello finale sono distinti; la qualita dati puo promuovere un veto finale.',
      'EV teorico positivo non equivale a EV robusto positivo, e non e autorizzazione stake.',
      'Non vengono modificati IPM, soglie, affidabilita, decisioni o stake da questa diagnostica.'
    ]};
}
module.exports={build,VERSION};
