'use strict';

const crypto = require('crypto');
const tennisForwardLifecycle = require('./tennisForwardLifecycle');
const tennisForwardCohorts = require('./tennisForwardCohorts');
const patch38Semantics = require('./tennisForwardHealthSemanticsPatch38');
const patch48Policy = require('./tennisForwardCapturePolicyPatch48R2');

const TENNIS_FORWARD_CAPTURE_VERSION = 'TENNIS_FORWARD_CAPTURE_SLA_V1_PATCH11';
const TENNIS_FORWARD_CAPTURE_RUNTIME_SEVERITY_VERSION = 'AUDIT16D_R3_T6_R1_FORWARD_FAIL_CLOSED_DECISION_SEMANTICS_V1';
const TENNIS_FORWARD_CAPTURE_DIAGNOSTIC_POLICY_VERSION = patch48Policy.VERSION;
const CAPTURE_STATUS = Object.freeze({
  NO_FORWARD_DATA: 'NO_FORWARD_DATA',
  CAPTURING: 'CAPTURING',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  BLOCKED: 'BLOCKED'
});
const DEFAULT_SLA = Object.freeze({
  snapshotMs: 2 * 60 * 1000,
  cohortMs: 2 * 60 * 1000,
  clvGraceMs: 5 * 60 * 1000,
  settlementWarnMs: 12 * 60 * 60 * 1000,
  settlementCriticalMs: 36 * 60 * 60 * 1000
});

const EVIDENCE_OVERDUE_REASONS = patch48Policy.EVIDENCE_OVERDUE;
function classifyCaptureBlock(reasons = [], context = {}) { return patch48Policy.classify(reasons, context).class; }

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function iso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function millis(value) { const valueIso = iso(value); return valueIso ? Date.parse(valueIso) : null; }
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table));
}
function isTennisRow(row = {}) {
  const source = upper([row.sport_type, row.bet_type, row.strategy_tag, row.league].filter(Boolean).join(' '));
  return source.includes('TENNIS') || source.includes('ATP') || source.includes('WTA');
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function resolveMatchStart(row = {}, anchor = null) {
  return tennisForwardCohorts.resolveEffectiveMatchStart(row, anchor || {}).effectiveIso;
}
function hasPatch46Contract(row = {}) {
  return upper(row.tennis_stake_contract_version) === 'TENNIS_STAKE_EXECUTION_CONTRACT_V1_PATCH46'
    && upper(row.tennis_stake_final_authority) === 'PATCH46_FINAL_EXECUTABLE_STAKE_CONTRACT';
}
function qualityDecisionIsComplete(row = {}) {
  if (hasPatch46Contract(row)) {
    return Boolean(text(row.tennis_stake_quality_authority_status)
      && text(row.tennis_stake_risk_authority_status)
      && text(row.tennis_stake_calibration_status)
      && text(row.tennis_stake_final_execution_status)
      && finite(row.tennis_stake_final_executable) !== null);
  }
  return Boolean(text(row.quality_base_code) && text(row.quality_final_code) && text(row.quality_stake_mode) && text(row.quality_decision_at));
}
function qualityStakeIsCoherent(row = {}) {
  const epsilon = 0.011;
  const actualStake = Math.max(0, finite(row.stake) || 0);
  if (hasPatch46Contract(row)) {
    const model = Math.max(0, finite(row.tennis_stake_model_suggested) || 0);
    const qualityCap = Math.max(0, finite(row.tennis_stake_quality_cap) || 0);
    const riskCap = Math.max(0, finite(row.tennis_stake_risk_cap) || 0);
    const calibrationCap = Math.max(0, finite(row.tennis_stake_calibration_cap) || 0);
    const finalStake = Math.max(0, finite(row.tennis_stake_final_executable) || 0);
    const execution = upper(row.tennis_stake_final_execution_status);
    const qualityAuthority = upper(row.tennis_stake_quality_authority_status);
    const persistedMatches = Math.abs(actualStake - finalStake) <= epsilon;
    const capsHold = finalStake <= model + epsilon && finalStake <= qualityCap + epsilon && finalStake <= riskCap + epsilon && finalStake <= calibrationCap + epsilon;
    if (!persistedMatches || !capsHold) return false;
    if (finalStake > epsilon) return execution.startsWith('EXECUTABLE_') && qualityAuthority.includes('AUTHORIZED') && qualityCap > 0 && riskCap > 0 && calibrationCap > 0;
    return !execution.startsWith('EXECUTABLE_');
  }
  const finalCode = upper(row.quality_final_code || row.quality_final_label);
  const mode = upper(row.quality_stake_mode);
  const qualityAmount = Math.max(0, finite(row.quality_stake_amount) || 0);
  const blocking = finalCode.includes('BLOCKED_HARD') || finalCode.includes('BLOCKED_SOFT') || finalCode.includes('BLOCCATA HARD') || finalCode.includes('BLOCCATA SOFT') || finalCode.includes('WAITING_DEEPSCAN');
  if (blocking) return mode === 'ZERO' && qualityAmount <= epsilon && actualStake <= epsilon;
  if (finalCode.includes('WATCHLIST_MICRO')) return mode === 'FIXED_MICRO_2_EUR' && [0,2].some(expected => Math.abs(qualityAmount-expected)<=epsilon) && actualStake <= qualityAmount+epsilon && actualStake <= 2+epsilon;
  if (finalCode.includes('APPROVED_WITH_CAP') || finalCode.includes('APPROVATA CON CAP')) return mode === 'BANKROLL_PERCENT_CAP' && qualityAmount > 0 && actualStake <= qualityAmount + epsilon;
  if (finalCode === 'APPROVED' || finalCode === 'APPROVATA') return mode === 'CERTIFIED_PERCENT' && qualityAmount > 0 && actualStake <= qualityAmount + epsilon;
  return false;
}

function resolveDecisionContractSafety(row = {}) {
  const epsilon = 0.011;
  const actualStake = Math.max(0, finite(row.stake) || 0);
  const complete = qualityDecisionIsComplete(row);
  const coherent = qualityStakeIsCoherent(row);
  let intendedStake = 0;
  let executionStatus = '';
  let explicitExecutableIntent = false;
  if (hasPatch46Contract(row)) {
    intendedStake = Math.max(0, finite(row.tennis_stake_final_executable) || 0);
    executionStatus = upper(row.tennis_stake_final_execution_status);
    explicitExecutableIntent = intendedStake > epsilon || executionStatus.startsWith('EXECUTABLE_');
  } else {
    intendedStake = Math.max(0, finite(row.quality_stake_amount) || 0);
    executionStatus = upper(row.quality_stake_mode);
    explicitExecutableIntent = intendedStake > epsilon && ['FIXED_MICRO_2_EUR','BANKROLL_PERCENT_CAP','CERTIFIED_PERCENT'].includes(executionStatus);
  }
  const failClosedZeroStake = actualStake <= epsilon && !explicitExecutableIntent;
  return { complete, coherent, actualStake, intendedStake, executionStatus, explicitExecutableIntent, failClosedZeroStake };
}

function sourceCandidates(db, betId = null) {
  const where = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
  const snapshotClause = tableExists(db, 'tennis_prediction_snapshots')
    ? " OR id IN (SELECT bet_id FROM tennis_prediction_snapshots WHERE is_calibration_anchor=1)"
    : '';
  const tracked = `(quality_decision_at IS NOT NULL OR quality_final_version='TENNIS_QUALITY_GATE_V2_PATCH10'${snapshotClause}) AND COALESCE(paper_result_active,1)=1`;
  if (Number(betId) > 0) return db.prepare(`SELECT * FROM ai_forward_test WHERE id=? AND ${where}`).all(Number(betId));
  return db.prepare(`SELECT * FROM ai_forward_test WHERE ${where} AND ${tracked} ORDER BY id`).all();
}
function inspectForwardCaptureBet(db, betId, options = {}) {
  const nowMs = millis(options.now || new Date()) || Date.now();
  const sla = { ...DEFAULT_SLA, ...(options.sla || {}) };
  const source = db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(Number(betId)) || null;
  if (!source) return { success: false, status: CAPTURE_STATUS.BLOCKED, betId: Number(betId), reasons: ['SOURCE_BET_NOT_FOUND'] };
  if (!isTennisRow(source)) return { success: true, status: 'NON_TENNIS', betId: Number(betId), reasons: [] };

  const snapshotExists = tableExists(db, 'tennis_prediction_snapshots');
  const cohortExists = tableExists(db, 'tennis_forward_cohort_members');
  const ledgerExists = tableExists(db, 'tennis_calibration_eligibility');
  const anchor = snapshotExists ? db.prepare('SELECT * FROM tennis_prediction_snapshots WHERE bet_id=? AND is_calibration_anchor=1 ORDER BY snapshot_sequence LIMIT 1').get(Number(betId)) || null : null;
  const cohort = cohortExists ? db.prepare('SELECT * FROM tennis_forward_cohort_members WHERE bet_id=?').get(Number(betId)) || null : null;
  const ledger = ledgerExists ? db.prepare('SELECT * FROM tennis_calibration_eligibility WHERE bet_id=?').get(Number(betId)) || null : null;

  const decisionAt = iso(source.quality_decision_at || anchor?.captured_at);
  const decisionMs = millis(decisionAt);
  const capturedAt = iso(anchor?.captured_at);
  const capturedMs = millis(capturedAt);
  const cohortAt = iso(cohort?.sealed_at);
  const cohortMs = millis(cohortAt);
  const matchStartAt = resolveMatchStart(source, anchor);
  const matchStartMs = millis(matchStartAt);
  const reasons = [];
  const warnings = [];
  const pending = [];

  // AUDIT16D_R3_T6_R1: un contratto incompleto ma fail-closed con stake reale €0
  // non è un errore operativo. Resta warning/pending. Qualsiasi intenzione EXECUTABLE
  // o stake > 0 incoerente resta invece bloccante.
  const decisionSafety = resolveDecisionContractSafety(source);
  if (!decisionSafety.complete || !decisionSafety.coherent) {
    if (decisionSafety.failClosedZeroStake) {
      warnings.push('DECISION_CONTRACT_FAIL_CLOSED_ZERO_STAKE');
      if (matchStartMs && nowMs >= matchStartMs) warnings.push('PREMATCH_CLOSED_NO_EXECUTION');
      else pending.push('DECISION_CONTRACT_PENDING_FAIL_CLOSED');
    } else {
      if (!decisionSafety.complete) reasons.push('QUALITY_DECISION_INCOMPLETE');
      if (!decisionSafety.coherent) reasons.push('QUALITY_STAKE_INCOHERENT');
    }
  }
  if (!anchor) {
    if (decisionMs && nowMs - decisionMs > sla.snapshotMs) warnings.push('SNAPSHOT_SLA_MISSED');
    else pending.push('SNAPSHOT_PENDING_WITHIN_SLA');
  } else {
    if (upper(anchor.snapshot_status) !== 'VALID_PREMATCH') reasons.push(`SNAPSHOT_${upper(anchor.snapshot_status) || 'INVALID'}`);
    if (decisionMs && capturedMs && capturedMs - decisionMs > sla.snapshotMs) warnings.push('SNAPSHOT_CAPTURE_DELAY_EXCEEDED');
    if (!cohort) {
      if (capturedMs && nowMs - capturedMs > sla.cohortMs) warnings.push('COHORT_SLA_MISSED');
      else pending.push('COHORT_PENDING_WITHIN_SLA');
    } else if (capturedMs && cohortMs && cohortMs - capturedMs > sla.cohortMs) warnings.push('COHORT_ASSIGNMENT_DELAY_EXCEEDED');
  }

  let expectedTemporalExclusion = false;
  const clvDegradedState = upper(source.clv_degraded_state);
  const terminalClvQuarantine = ['IRRECOVERABLE_TEMPORAL','IRRECOVERABLE_MARKET','MAX_ATTEMPTS_EXHAUSTED','MANUAL_REVIEW'].includes(clvDegradedState);
  let cohortInspection = null;
  if (cohort && ['BLOCKED', 'CONFLICT', 'TEMPORAL_LEAKAGE_BLOCKED'].includes(upper(cohort.leakage_status))) {
    try {
      cohortInspection = tennisForwardCohorts.inspectForwardCohortMember(db, Number(betId), options);
      let exclusionReasons=[];try{exclusionReasons=JSON.parse(cohort?.exclusion_reasons||'[]');}catch(_){}const expectedReasonSet=exclusionReasons.length>0&&exclusionReasons.every(reason=>['SNAPSHOT_NOT_BEFORE_MATCH_START','CLV_CLOSING_TIMESTAMP_INVALID','SETTLEMENT_BEFORE_MATCH_START'].includes(String(reason||'').toUpperCase()));expectedTemporalExclusion = patch38Semantics.classifyCohortInspection(cohortInspection).expectedTemporalExclusion || (cohortInspection?.success===true&&cohortInspection?.sealValid===true&&cohortInspection?.stateHashValid===true&&cohortInspection?.expectedMatches===true&&expectedReasonSet);
    } catch (_) { expectedTemporalExclusion = false; }
    if (expectedTemporalExclusion || terminalClvQuarantine) { expectedTemporalExclusion = true; warnings.push('EXPECTED_TEMPORAL_EXCLUSION'); }
    else reasons.push(`COHORT_${upper(cohort.leakage_status)}`);
  }
  if (cohort && Number(cohort.holdout_locked || 0) === 1 && upper(cohort.cohort_role) !== 'HOLDOUT') reasons.push('HOLDOUT_LOCK_ROLE_MISMATCH');
  if (anchor && !ledger) reasons.push('ELIGIBILITY_LEDGER_MISSING');

  if (matchStartMs) {
    // AUDIT16D_R3_T6: CLV "VERIFIED" è operativo solo se il degraded ledger
    // conferma VERIFIED e il closing timestamp è realmente presente.
    const clvVerified = upper(source.clv_contract_status) === 'VERIFIED'
      && upper(source.clv_degraded_state) === 'VERIFIED'
      && millis(source.clv_closing_ts) != null;
    const settlementStatus = upper(source.settlement_contract_status);
    const settlementVerified = ['VERIFIED', 'VOID'].includes(settlementStatus);
    const settlementManualReview = settlementStatus === 'MANUAL_REVIEW';
    const settlementManualReason = upper(source.settlement_contract_reason);
    const retirementManualReview = settlementManualReview && (/RETIREMENT/.test(settlementManualReason)
      || /OFFICIAL_RETIREMENT/.test(upper(source.settlement_source)));
    if (nowMs > matchStartMs + sla.clvGraceMs && !clvVerified) warnings.push('CLV_SLA_MISSED');
    if (retirementManualReview) {
      warnings.push('SETTLEMENT_BOOKMAKER_RULE_REQUIRED');
    } else if (settlementManualReview) {
      warnings.push('SETTLEMENT_IDENTITY_REVIEW_REQUIRED');
    } else if (nowMs > matchStartMs + sla.settlementCriticalMs && !settlementVerified) {
      reasons.push('SETTLEMENT_SLA_CRITICAL');
    } else if (nowMs > matchStartMs + sla.settlementWarnMs && !settlementVerified) {
      warnings.push('SETTLEMENT_SLA_MISSED');
    }
  } else {
    warnings.push('MATCH_START_UNRESOLVED');
  }

  if (anchor && options.skipLifecycleInspection !== true) {
    try {
      const lifecycle = tennisForwardLifecycle.inspectForwardLifecycleBet(db, Number(betId), { operationId: options.operationId });
      if (!lifecycle.healthy) {
        if (expectedTemporalExclusion) warnings.push('EXCLUDED_RECORD_LIFECYCLE_DRIFT');
        else reasons.push(...(lifecycle.reasons || []).map(reason => `LIFECYCLE_${reason}`));
      }
    } catch (error) {
      reasons.push(`LIFECYCLE_INSPECTION_FAILED:${error.message}`);
    }
  }

  const blocked = reasons.length > 0;
  const degraded = warnings.length > 0;
  const status = blocked ? CAPTURE_STATUS.BLOCKED : degraded ? CAPTURE_STATUS.DEGRADED : pending.length ? CAPTURE_STATUS.CAPTURING : CAPTURE_STATUS.HEALTHY;
  const uniqueReasons = [...new Set(reasons)];
  const classification = patch48Policy.classify(uniqueReasons, { expectedTemporalExclusion, terminalClvQuarantine });
  const blockClass = classification.class;
  const state = {
    betId: Number(betId), status, blockClass, reasons: uniqueReasons, warnings: [...new Set(warnings)], pending: [...new Set(pending)],
    sourceStatus: source.status || null, qualityFinalCode: source.quality_final_code || null,
    matchStartAt, decisionAt, capturedAt, cohortAt,
    clvContractStatus: source.clv_contract_status || null,
    settlementContractStatus: source.settlement_contract_status || null,
    settlementSource: source.settlement_source || null,
    settlementContractReason: source.settlement_contract_reason || null,
    snapshotId: anchor?.snapshot_id || null,
    cohortId: cohort?.cohort_id || null,
    expectedTemporalExclusion,
    cohortSealValid: cohortInspection?.sealValid ?? null,
    cohortStateHashValid: cohortInspection?.stateHashValid ?? null,
    cohortExpectedMatches: cohortInspection?.expectedMatches ?? null,
    cohortRole: cohort?.cohort_role || null,
    ledgerStatus: ledger?.eligibility_status || null,
    clvDegradedState: clvDegradedState || null,
    terminalClvQuarantine,
    decisionSafety,
    classification
  };
  return { success: !blocked, healthy: status === CAPTURE_STATUS.HEALTHY, ...state, stateHash: hash(state) };
}
function scanForwardCaptureHealth(db, options = {}) {
  const rows = sourceCandidates(db, options.betId);
  if (!rows.length) {
    return {
      success: true, healthy: true, status: CAPTURE_STATUS.NO_FORWARD_DATA,
      version: TENNIS_FORWARD_CAPTURE_VERSION, mode: 'READ_ONLY_FORWARD_SLA',
      trackedBets: 0, counts: Object.fromEntries(Object.values(CAPTURE_STATUS).map(status => [status, status === CAPTURE_STATUS.NO_FORWARD_DATA ? 1 : 0])),
      alerts: 0, details: [], sla: { ...DEFAULT_SLA },
      note: 'Nessuna previsione Tennis Patch 10 reale ancora disponibile. Il controllo diventerà operativo alla prossima previsione.'
    };
  }
  const details = rows.map(row => inspectForwardCaptureBet(db, row.id, options));
  const counts = Object.fromEntries(Object.values(CAPTURE_STATUS).map(status => [status, 0]));
  for (const item of details) counts[item.status] = Number(counts[item.status] || 0) + 1;
  let status = CAPTURE_STATUS.HEALTHY;
  if (counts[CAPTURE_STATUS.BLOCKED]) status = CAPTURE_STATUS.BLOCKED;
  else if (counts[CAPTURE_STATUS.DEGRADED]) status = CAPTURE_STATUS.DEGRADED;
  else if (counts[CAPTURE_STATUS.CAPTURING]) status = CAPTURE_STATUS.CAPTURING;
  const expectedTemporalExclusions = details.filter(item => item.expectedTemporalExclusion === true).length;
  const activeStructuralFaults = details.filter(item => item.status === CAPTURE_STATUS.BLOCKED && item.blockClass === patch48Policy.CLASSES.STRUCTURAL_INTEGRITY).length;
  const decisionContractBlocked = details.filter(item => item.status === CAPTURE_STATUS.BLOCKED && item.blockClass === patch48Policy.CLASSES.DECISION_CONTRACT).length;
  const structuralBlocked = activeStructuralFaults;
  const evidenceOverdue = details.filter(item => item.status === CAPTURE_STATUS.BLOCKED && item.blockClass === patch48Policy.CLASSES.EVIDENCE_OVERDUE).length;
  const manualBookmakerReview = details.filter(item => (item.warnings || []).includes('SETTLEMENT_BOOKMAKER_RULE_REQUIRED')).length;
  const manualIdentityReview = details.filter(item => (item.warnings || []).includes('SETTLEMENT_IDENTITY_REVIEW_REQUIRED')).length;
  const clvOnlyDegraded = details.filter(item => item.status === CAPTURE_STATUS.DEGRADED
    && (item.warnings || []).length > 0
    && (item.warnings || []).every(code => code === 'CLV_SLA_MISSED')).length;
  const failClosedDecisionContracts = details.filter(item => (item.warnings || []).includes('DECISION_CONTRACT_FAIL_CLOSED_ZERO_STAKE')).length;
  const closedWithoutExecution = details.filter(item => (item.warnings || []).includes('PREMATCH_CLOSED_NO_EXECUTION')).length;
  const alerts = counts[CAPTURE_STATUS.BLOCKED] + counts[CAPTURE_STATUS.DEGRADED];
  const pipelineAvailable = activeStructuralFaults === 0;
  const runtimeSeverity = activeStructuralFaults > 0 || decisionContractBlocked > 0 ? 'ERROR' : alerts > 0 ? 'WARN' : 'INFO';
  const note = activeStructuralFaults > 0
    ? `Raccolta forward bloccata da ${activeStructuralFaults} anomalie strutturali attive.`
    : decisionContractBlocked > 0
      ? `${decisionContractBlocked} record hanno un contratto decisionale incoerente e sono esclusi dall'esecuzione; la raccolta strutturale resta disponibile.`
    : failClosedDecisionContracts > 0
      ? `${failClosedDecisionContracts} contratti decisionali incompleti restano fail-closed con stake €0; ${closedWithoutExecution} hanno già chiuso la finestra prematch. Nessuna esposizione operativa incoerente.`
    : expectedTemporalExclusions > 0
      ? `Pipeline disponibile: ${expectedTemporalExclusions} record storici sono esclusi correttamente per leakage temporale.`
    : evidenceOverdue > 0
      ? `${evidenceOverdue} risultati attendono evidenza ufficiale oltre SLA; nessun blocco strutturale.`
      : manualBookmakerReview > 0
        ? `${manualBookmakerReview} risultato con ritiro ufficiale richiede la verifica della regola bookmaker; nessun settlement automatico.`
        : manualIdentityReview > 0
          ? `${manualIdentityReview} risultato ufficiale richiede revisione identità mercato/evento; nessun settlement automatico.`
          : clvOnlyDegraded > 0
          ? `${clvOnlyDegraded} settlement sono verificati; il solo CLV non è disponibile e non viene ricostruito.`
          : status === CAPTURE_STATUS.HEALTHY
            ? 'Raccolta forward allineata.'
            : status === CAPTURE_STATUS.CAPTURING
              ? 'Raccolta forward in corso entro le finestre SLA.'
              : `Raccolta forward ${status}: ${alerts} record richiedono attenzione.`;
  return {
    success: pipelineAvailable && decisionContractBlocked === 0,
    healthy: pipelineAvailable && decisionContractBlocked === 0,
    pipelineAvailable, expectedTemporalExclusions, activeStructuralFaults, decisionContractBlocked,
    failClosedDecisionContracts, closedWithoutExecution,
    diagnosticSummary: patch48Policy.summarize(details),
    status, runtimeSeverity, structuralBlocked, evidenceOverdue, manualBookmakerReview, manualIdentityReview, clvOnlyDegraded,
    version: TENNIS_FORWARD_CAPTURE_VERSION,
    runtimeSeverityVersion: TENNIS_FORWARD_CAPTURE_RUNTIME_SEVERITY_VERSION,
    diagnosticPolicyVersion: TENNIS_FORWARD_CAPTURE_DIAGNOSTIC_POLICY_VERSION,
    mode: 'READ_ONLY_FORWARD_SLA',
    trackedBets: details.length, alerts, counts, sla: { ...DEFAULT_SLA, ...(options.sla || {}) },
    details: details.slice(0, Math.max(1, Math.min(2000, Number(options.limit || 40)))),
    note
  };
}

module.exports = {
  TENNIS_FORWARD_CAPTURE_VERSION,
  TENNIS_FORWARD_CAPTURE_RUNTIME_SEVERITY_VERSION,
  TENNIS_FORWARD_CAPTURE_DIAGNOSTIC_POLICY_VERSION,
  CAPTURE_STATUS,
  DEFAULT_SLA,
  EVIDENCE_OVERDUE_REASONS,
  classifyCaptureBlock,
  hasPatch46Contract,
  isTennisRow,
  resolveMatchStart,
  qualityDecisionIsComplete,
  qualityStakeIsCoherent,
  resolveDecisionContractSafety,
  inspectForwardCaptureBet,
  scanForwardCaptureHealth
};
