'use strict';

const unifiedPredictionIndex = require('./calcioUnifiedPredictionIndex');

const CALCIO_STAKE_RECONCILER_VERSION = 'BETTING_PATCH_25_RUNTIME_CONSISTENCY_RECONCILIATION_V1';
const MINIMUM_POSITIVE_STAKE_EUR = unifiedPredictionIndex.MINIMUM_POSITIVE_STAKE_EUR;
const SOFT_MICRO_CAP_EUR = 3; // export legacy, non autoritativo
const SOFT_MICRO_FRACTION = 0.25; // export legacy, non autoritativo
const UNRELIABLE_THRESHOLD = unifiedPredictionIndex.MIN_RELIABILITY_FOR_STAKE;

const PREDICTION_INDEX_COLUMNS = Object.freeze([
  ['calcio_prediction_index_score', 'REAL'],
  ['calcio_prediction_index_label', 'TEXT'],
  ['calcio_prediction_index_version', 'TEXT'],
  ['calcio_prediction_index_reason', 'TEXT'],
  ['calcio_prediction_index_components', 'TEXT'],
  ['calcio_prediction_index_rank_value', 'REAL'],
  ['calcio_prediction_index_eligible', 'INTEGER DEFAULT 0'],
  ['calcio_odds_provenance_version', 'TEXT'],
  ['calcio_odds_certification_status', 'TEXT'],
  ['calcio_odds_certification_reason', 'TEXT'],
  ['calcio_odds_certified', 'INTEGER DEFAULT 0'],
  ['calcio_odds_operational_eligible', 'INTEGER DEFAULT 0'],
  ['calcio_odds_direct', 'INTEGER DEFAULT 0'],
  ['calcio_odds_derived', 'INTEGER DEFAULT 0'],
  ['calcio_odds_bookmaker_key', 'TEXT'],
  ['calcio_odds_bookmaker_title', 'TEXT'],
  ['calcio_odds_market_key', 'TEXT'],
  ['calcio_odds_last_update', 'TEXT'],
  ['calcio_odds_source_count', 'INTEGER DEFAULT 0'],
  ['calcio_odds_source_list', 'TEXT'],
  ['calcio_odds_provenance_json', 'TEXT'],
  ['calcio_decision_certification_version', 'TEXT'],
  ['calcio_decision_certification_status', 'TEXT'],
  ['calcio_decision_certification_reason', 'TEXT'],
  ['calcio_identity_certified', 'INTEGER DEFAULT 0'],
  ['calcio_market_identity_certified', 'INTEGER DEFAULT 0'],
  ['calcio_thresholds_certified', 'INTEGER DEFAULT 0'],
  ['calcio_provider_home_team', 'TEXT'],
  ['calcio_provider_away_team', 'TEXT'],
  ['calcio_historical_home_key', 'TEXT'],
  ['calcio_historical_away_key', 'TEXT'],
  ['calcio_prediction_confidence_score', 'REAL'],
  ['calcio_prediction_value_score', 'REAL'],
  ['calcio_stake_caution_mode', 'TEXT'],
  ['calcio_stake_caution_reasons', 'TEXT'],
  ['calcio_stake_operational_multiplier', 'REAL'],
  ['calcio_stake_operational_cap', 'REAL'],
  ['calcio_net_executable_odd', 'REAL'],
  ['calcio_market_consensus_gap_pp', 'REAL'],
  ['calcio_odds_outlier_premium_pct', 'REAL'],
  ['calcio_exchange_commission_pct', 'REAL'],
  ['calcio_ai_finalization_status', 'TEXT'],
  ['calcio_market_reselection_required', 'INTEGER DEFAULT 0'],
  ['calcio_market_selection_audit', 'TEXT'],
  ['calcio_market_selection_version', 'TEXT'],
  ['calcio_profit_display_mode', 'TEXT'],
  ['calcio_deepscan_raw_action', 'TEXT'],
  ['calcio_deepscan_unified_action', 'TEXT'],
  ['calcio_deepscan_action_certified', 'INTEGER DEFAULT 0'],
  ['calcio_deepscan_canonical_audit', 'TEXT'],
  ['calcio_deepscan_timing_advisory', 'TEXT'],
  ['calcio_market_finalized_count', 'INTEGER DEFAULT 0'],
  ['calcio_market_projected_count', 'INTEGER DEFAULT 0'],
  ['calcio_market_finalization_mode', 'TEXT'],
  ['calcio_market_ranking_certified', 'INTEGER DEFAULT 0'],
  ['calcio_market_finalization_audit', 'TEXT'],
  ['calcio_market_finalization_version', 'TEXT'],
  ['calcio_ipm_certification_status', 'TEXT'],
  ['calcio_output_coherence_status', 'TEXT'],
  ['calcio_output_coherence_audit', 'TEXT'],
  ['calcio_pt_certification_status', 'TEXT'],
  ['calcio_structural_certification_label', 'TEXT'],
  ['calcio_portfolio_cap_post_finalization', 'INTEGER DEFAULT 0'],
  ['calcio_finalization_transaction_status', 'TEXT'],
  ['calcio_finalization_transaction_id', 'TEXT'],
  ['calcio_runtime_consistency_status', 'TEXT'],
  ['prediction_visibility', 'TEXT'],
  ['exposure_role', 'TEXT']
]);

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function upper(value = '') {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}
function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return null; }
}
function classifyDeepScan(action = '', suggestion = '') {
  return unifiedPredictionIndex.classifyDeepScan(action, suggestion);
}
function dataClassFromRow(row = {}) {
  return unifiedPredictionIndex.dataClassFromScore(
    finite(row.calcio_prediction_reliability_score ?? row.quality_final_score ?? row.quality_base_score ?? row.confidence, 0)
  );
}
function hasThresholdFailure(row = {}) {
  const reason = upper(`${row.calcio_analysis_stage_reason || ''} ${row.analysis_stage_reason || ''}`);
  return reason.includes('SOTTO SOGLIA') || reason.includes('QUOTA OLTRE') || reason.includes('CROSS REFERENCE');
}
function ensurePredictionIndexColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
  for (const [name, type] of PREDICTION_INDEX_COLUMNS) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
      existing.add(name);
    }
  }
  return existing;
}
function gateForIndex(result = {}) {
  if (result.eligible && result.score >= 80) return { status: 'CALCIO_APPROVED', label: 'APPROVATA' };
  if (result.eligible && result.score >= 70) return { status: 'CALCIO_APPROVED_WITH_CAP', label: 'APPROVATA CON CAP' };
  if (result.eligible) return { status: 'CALCIO_WATCHLIST_MICRO', label: 'WATCHLIST MICRO' };
  if (result.score < 45 || result.safetyReasons?.length) return { status: 'CALCIO_BLOCKED_SOFT', label: 'BLOCCATA SOFT' };
  return { status: 'CALCIO_WATCHLIST_MICRO', label: 'WATCHLIST MICRO' };
}

function reconcileStakeRow(row = {}, options = {}) {
  // Recupera le diagnostiche MC/modello persistite dalla pipeline live.
  // Senza questo passaggio la riconciliazione offline perderebbe il consenso
  // e potrebbe riportare artificialmente a zero uno stake valido.
  const previousComponents = parseJson(row.calcio_prediction_index_components) || {};
  const previousProbability = previousComponents.probability || {};
  const oddsCertification = options.oddsCertification
    || parseJson(row.calcio_odds_provenance_json)
    || row.oddsCertification
    || row.odds_certification;
  const result = unifiedPredictionIndex.evaluatePrediction({
    ...row,
    bankroll: options.bankroll ?? row.bankroll_snapshot ?? row.bankroll,
    deepScanAction: options.deepScanAction ?? row.ds_action,
    deepScanSuggestion: options.deepScanSuggestion ?? row.ds_suggestion,
    historicalEvidence: options.historicalEvidence || row.historicalEvidence,
    historicalSample: options.historicalSample ?? row.historical_combo_resolved ?? row.historicalSample ?? 0,
    historicalAdjustedRatePct: options.historicalAdjustedRatePct ?? row.historical_combo_adjusted_rate_pct,
    historicalWinRatePct: options.historicalWinRatePct ?? row.historical_combo_win_rate_pct,
    probabilityIntegrity: options.probabilityIntegrity ?? row.probabilityIntegrity ?? row.extData?.probabilityIntegrity,
    monteCarloStdErrorPp: options.monteCarloStdErrorPp ?? row.monte_carlo_std_error_pp,
    monteCarloCiLowPct: options.monteCarloCiLowPct,
    monteCarloCiHighPct: options.monteCarloCiHighPct,
    finalizationStatus: options.finalizationStatus ?? row.calcio_ai_finalization_status,
    // Patch 24: nessun veto post-IPM di reselezione. Il vincitore e gia il
    // primo del ranking completamente finalizzato.
    marketReselectionRequired: false,
    monteCarloProbabilityPct: options.monteCarloProbabilityPct ?? previousProbability.monteCarlo,
    modelProbabilityPct: options.modelProbabilityPct ?? previousProbability.model,
    marketProbabilityPct: options.marketProbabilityPct ?? previousProbability.marketProbability,
    consensusConfidence: options.consensusConfidence ?? previousProbability.consensusScore ?? row.confidence,
    oddsCertification,
    decisionIdentity: options.decisionIdentity || row.decisionIdentity,
    requireIdentityCertification: options.requireIdentityCertification ?? true,
    providerHome: row.calcio_provider_home_team || row.providerHome || row.home_team,
    providerAway: row.calcio_provider_away_team || row.providerAway || row.away_team
  });
  const gate = gateForIndex(result);
  return {
    ...result,
    version: CALCIO_STAKE_RECONCILER_VERSION,
    predictionIndexVersion: result.version,
    gateStatus: gate.status,
    allowBet: result.eligible,
    status: result.eligible ? 'UNIFIED_INDEX_STAKE_AUTHORIZED' : 'UNIFIED_INDEX_NO_STAKE',
    action: result.eligible ? 'BET_ALLOWED_UNIFIED_INDEX' : 'ANALYSIS_ONLY_UNIFIED_INDEX',
    qualityLabel: gate.label,
    qualityOrigin: 'UNIFIED_PREDICTION_INDEX',
    thresholdFailure: hasThresholdFailure(row),
    oldThresholdAuthority: false,
    hardVeto: result.safetyReasons?.length > 0,
    reliable: result.reliabilityScore >= UNRELIABLE_THRESHOLD,
    minimumPositiveStakeEur: MINIMUM_POSITIVE_STAKE_EUR,
    structuralCertificationLabel: result.eligible
      ? (result.components?.paperTrading?.sample > 0 ? 'STRUTTURALMENTE CERTIFICATA · PT VALIDATO' : 'STRUTTURALMENTE CERTIFICATA · PT ASSENTE')
      : 'ANALISI · NESSUNA AUTORITÀ STAKE',
    ptCertificationStatus: result.components?.paperTrading?.sample > 0 ? 'PT_VALIDATED' : 'PT_ABSENT_NEUTRAL'
  };
}

function persistenceFields(decision = {}) {
  return {
    ...unifiedPredictionIndex.persistenceFields(decision),
    edge: finite(decision.edgePp, 0),
    edge_pp: finite(decision.edgePp, 0),
    ev_pct: finite(decision.evPct, 0),
    calcio_ipm_certification_status: decision.decisionCertification?.status || decision.structuralCertificationLabel || '',
    calcio_pt_certification_status: decision.ptCertificationStatus || '',
    calcio_structural_certification_label: decision.structuralCertificationLabel || '',
    calcio_gate_status: decision.gateStatus,
    calcio_gate_allow_bet: decision.allowBet ? 1 : 0,
    calcio_gate_reasons: decision.reason,
    calcio_gate_max_stake: decision.operationalStake,
    calcio_operational_status: decision.gateStatus,
    calcio_operational_action: decision.action,
    calcio_operational_summary: decision.reason,
    calcio_stake_lifecycle_status: decision.status,
    calcio_stake_lifecycle_reason: decision.reason,
    calcio_quality_final_label: decision.qualityLabel,
    quality_final_label: decision.qualityLabel,
    quality_final_reason: decision.reason,
    quality_stake_mode: decision.action,
    quality_stake_amount: decision.operationalStake,
    stake_confidence_level: decision.dataClass,
    stake_policy_mode: CALCIO_STAKE_RECONCILER_VERSION,
    stake_policy_note: decision.reason
  };
}

function activePendingRows(db) {
  return db.prepare(`
    SELECT * FROM ai_forward_test
    WHERE UPPER(COALESCE(sport_type, '')) = 'CALCIO'
      AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
      AND UPPER(COALESCE(bet_type, '')) IN ('SINGLE', 'SINGLE_CR')
      AND COALESCE(paper_result_active, 1) = 1
      AND COALESCE(paper_result_conflict, 0) = 0
    ORDER BY id DESC
  `).all();
}
function latestPerEvent(rows = []) {
  const seen = new Set();
  return rows.filter(row => {
    const key = row.match_exposure_key || row.calcio_event_key || `${upper(row.home_team)}|${upper(row.away_team)}|${row.match_date || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reconcilePendingRows(db, options = {}) {
  const columns = ensurePredictionIndexColumns(db);
  const rows = activePendingRows(db);
  const selected = latestPerEvent(rows);
  const report = {
    version: CALCIO_STAKE_RECONCILER_VERSION,
    predictionIndexVersion: unifiedPredictionIndex.CALCIO_UNIFIED_PREDICTION_INDEX_VERSION,
    scanned: rows.length,
    selectedLatestEvents: selected.length,
    updated: 0,
    operationalPositive: 0,
    refreshRequiredSkipped: 0,
    unchanged: 0,
    decisions: []
  };

  const execute = () => {
    for (const row of selected) {
      if (upper(row.calcio_decision_certification_status) === 'PATCH19_REQUIRES_PROVIDER_REFRESH') {
        report.refreshRequiredSkipped += 1;
        report.unchanged += 1;
        report.decisions.push({
          id: row.id,
          event: `${row.home_team} - ${row.away_team}`,
          prediction: row.prediction,
          skipped: true,
          reason: 'Refresh provider Patch 19 richiesto: nessuna riattivazione automatica della riga legacy.',
          operationalStake: 0
        });
        continue;
      }
      const decision = reconcileStakeRow(row, options);
      const fields = persistenceFields(decision);
      const filtered = Object.fromEntries(Object.entries(fields).filter(([key]) => columns.has(key)));
      const changed = Object.entries(filtered).filter(([key, value]) => String(row[key] ?? '') !== String(value ?? ''));
      if (options.dryRun !== true && changed.length) {
        db.prepare(`UPDATE ai_forward_test SET ${changed.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`)
          .run(...changed.map(([, value]) => value), row.id);
        report.updated += 1;
      } else {
        report.unchanged += 1;
      }
      if (decision.operationalStake > 0) report.operationalPositive += 1;
      report.decisions.push({ id: row.id, event: `${row.home_team} - ${row.away_team}`, prediction: row.prediction, ...decision });
    }
  };

  if (options.dryRun === true) {
    execute();
    report.updated = 0;
    return report;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    execute();
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
  return report;
}

module.exports = {
  CALCIO_STAKE_RECONCILER_VERSION,
  MINIMUM_POSITIVE_STAKE_EUR,
  SOFT_MICRO_CAP_EUR,
  SOFT_MICRO_FRACTION,
  UNRELIABLE_THRESHOLD,
  PREDICTION_INDEX_COLUMNS,
  parseJson,
  classifyDeepScan,
  dataClassFromRow,
  hasThresholdFailure,
  ensurePredictionIndexColumns,
  reconcileStakeRow,
  persistenceFields,
  reconcilePendingRows
};
