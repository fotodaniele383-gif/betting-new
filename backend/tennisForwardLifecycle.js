'use strict';

const crypto = require('crypto');
const tennisPredictionSnapshots = require('./tennisPredictionSnapshots');
const tennisCalibrationEligibility = require('./tennisCalibrationEligibility');
const tennisForwardCohorts = require('./tennisForwardCohorts');
const runtimeDiagnostics = require('./runtimeDiagnostics');

const TENNIS_FORWARD_LIFECYCLE_VERSION = 'TENNIS_FORWARD_LIFECYCLE_V2_PATCH28_R1';

const LIFECYCLE_STATES = Object.freeze({
  LEGACY_NOT_TRACKED: 'LEGACY_NOT_TRACKED',
  PREDICTION_CAPTURED: 'PREDICTION_CAPTURED',
  PREDICTION_CLV_PENDING_SETTLEMENT: 'PREDICTION_CLV_PENDING_SETTLEMENT',
  SETTLED_WAITING_CLV: 'SETTLED_WAITING_CLV',
  COMPLETE_CERTIFIED: 'COMPLETE_CERTIFIED',
  SETTLEMENT_EVIDENCE_PENDING: 'SETTLEMENT_EVIDENCE_PENDING',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  DRIFT: 'DRIFT'
});

const TRANSITIONS = Object.freeze({
  PREDICTION_PERSIST: 'PREDICTION_PERSIST',
  CLV_LOCK: 'CLV_LOCK',
  SETTLEMENT_BLOCKED: 'SETTLEMENT_BLOCKED',
  SETTLEMENT_PENDING_REASON: 'SETTLEMENT_PENDING_REASON',
  PATCH46_STAKE_REPAIR: 'PATCH46_STAKE_REPAIR',
  SETTLEMENT_VERIFIED: 'SETTLEMENT_VERIFIED',
  ELIGIBILITY_RECONCILE: 'ELIGIBILITY_RECONCILE'
});

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
  }
  return value;
}
function sha256(value) {
  return crypto.createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(stableObject(value)))
    .digest('hex');
}
function parseReasons(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.map(text).filter(Boolean))].sort() : [];
  } catch (_) {
    return text(value) ? [text(value)] : [];
  }
}
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table));
}
function runAtomic(db, fn) {
  if (db.inTransaction) return fn();
  if (typeof db.transaction === 'function') return db.transaction(fn)();
  if (typeof db.exec !== 'function') throw new Error('PATCH28_R1_DB_TRANSACTION_UNAVAILABLE');
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
}
function isTennisRow(row = {}) {
  const source = upper([row.sport_type, row.bet_type, row.strategy_tag, row.league].filter(Boolean).join(' '));
  return source.includes('TENNIS') || source.includes('ATP') || source.includes('WTA');
}
function normalizeComparableRecord(record = {}) {
  return {
    eligibility_status: text(record.eligibility_status),
    eligibility_reasons: parseReasons(record.eligibility_reasons),
    segment_key: text(record.segment_key),
    settlement_eligible: Number(record.settlement_eligible || 0),
    clv_eligible: Number(record.clv_eligible || 0),
    production_eligible: Number(record.production_eligible || 0),
    snapshot_hash: text(record.snapshot_hash),
    dataset_version: text(record.dataset_version),
    prediction_snapshot_id: text(record.prediction_snapshot_id),
    prediction_snapshot_hash: text(record.prediction_snapshot_hash),
    prediction_snapshot_status: text(record.prediction_snapshot_status),
    prediction_snapshot_version: text(record.prediction_snapshot_version)
  };
}
function compareEligibilityRecords(expected = {}, actual = {}) {
  const left = normalizeComparableRecord(expected);
  const right = normalizeComparableRecord(actual);
  const mismatches = [];
  for (const key of Object.keys(left)) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
      mismatches.push({ field: key, expected: left[key], actual: right[key] });
    }
  }
  return { match: mismatches.length === 0, mismatches, expected: left, actual: right };
}
function deriveLifecycleState(sourceRow = {}, anchor = null, comparison = { match: true }, chain = { valid: true }) {
  if (!anchor) return LIFECYCLE_STATES.LEGACY_NOT_TRACKED;
  if (!comparison.match || chain.valid === false) return LIFECYCLE_STATES.DRIFT;

  const sourceStatus = upper(sourceRow.status);
  const settlementStatus = upper(sourceRow.settlement_contract_status);
  const clvStatus = upper(sourceRow.clv_contract_status);
  const settlementVerified = settlementStatus === 'VERIFIED' && ['WON', 'LOST'].includes(sourceStatus);
  const clvVerified = clvStatus === 'VERIFIED';
  const reviewRequired = ['CONFLICT', 'REJECTED', 'MANUAL_REVIEW'].includes(settlementStatus) || clvStatus === 'CONFLICT';

  if (reviewRequired) return LIFECYCLE_STATES.REVIEW_REQUIRED;
  if (settlementStatus === 'PROPOSED') return LIFECYCLE_STATES.SETTLEMENT_EVIDENCE_PENDING;
  if (settlementVerified && clvVerified) return LIFECYCLE_STATES.COMPLETE_CERTIFIED;
  if (settlementVerified) return LIFECYCLE_STATES.SETTLED_WAITING_CLV;
  if (clvVerified) return LIFECYCLE_STATES.PREDICTION_CLV_PENDING_SETTLEMENT;
  return LIFECYCLE_STATES.PREDICTION_CAPTURED;
}
function buildLifecycleReasons(sourceRow = {}, anchor = null, ledger = null, comparison = { match: true, mismatches: [] }, chain = { valid: true, failures: [] }) {
  const reasons = [];
  if (!anchor) reasons.push('NO_FORWARD_CALIBRATION_ANCHOR');
  if (anchor && upper(anchor.snapshot_status) !== 'VALID_PREMATCH') reasons.push(`ANCHOR_STATUS_${upper(anchor.snapshot_status) || 'UNKNOWN'}`);
  if (anchor && !ledger) reasons.push('ELIGIBILITY_LEDGER_MISSING');
  if (!comparison.match) reasons.push(...comparison.mismatches.map(item => `LEDGER_MISMATCH_${upper(item.field)}`));
  if (chain.valid === false) reasons.push(...(chain.failures || []).map(item => `SNAPSHOT_CHAIN_${upper(item.code)}`));
  if (upper(sourceRow.clv_contract_status) === 'CONFLICT') reasons.push('CLV_CONFLICT');
  if (['CONFLICT', 'REJECTED', 'MANUAL_REVIEW'].includes(upper(sourceRow.settlement_contract_status))) {
    reasons.push(`SETTLEMENT_${upper(sourceRow.settlement_contract_status)}`);
  }
  if (upper(sourceRow.settlement_contract_status) === 'PROPOSED') reasons.push('SETTLEMENT_EVIDENCE_PROPOSED');
  return [...new Set(reasons)];
}
function inspectForwardLifecycleBet(db, betId, options = {}) {
  const numericBetId = Number(betId);
  if (!(numericBetId > 0)) throw new Error('PATCH8_LIFECYCLE_BET_ID_INVALID');
  const sourceRow = db.prepare('SELECT * FROM ai_forward_test WHERE id = ?').get(numericBetId) || null;
  if (!sourceRow) {
    return {
      success: false,
      healthy: false,
      forwardTracked: false,
      betId: numericBetId,
      lifecycleState: LIFECYCLE_STATES.DRIFT,
      reasons: ['SOURCE_BET_NOT_FOUND']
    };
  }
  if (!isTennisRow(sourceRow)) {
    return {
      success: true,
      healthy: true,
      forwardTracked: false,
      betId: numericBetId,
      lifecycleState: 'NON_TENNIS',
      reasons: []
    };
  }

  const snapshotTableExists = tableExists(db, tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE);
  const anchor = snapshotTableExists
    ? db.prepare(`SELECT * FROM ${tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE bet_id = ? AND is_calibration_anchor = 1 ORDER BY snapshot_sequence LIMIT 1`).get(numericBetId) || null
    : null;
  const ledgerExists = tableExists(db, tennisCalibrationEligibility.TENNIS_CALIBRATION_LEDGER_TABLE);
  const ledger = ledgerExists
    ? db.prepare(`SELECT * FROM ${tennisCalibrationEligibility.TENNIS_CALIBRATION_LEDGER_TABLE} WHERE bet_id = ?`).get(numericBetId) || null
    : null;
  const effectiveRow = tennisCalibrationEligibility.applyPredictionSnapshotToRow(sourceRow, anchor);
  const expected = tennisCalibrationEligibility.buildEligibilityRecord(effectiveRow, {
    evaluatedAt: ledger?.evaluated_at || options.evaluatedAt || new Date().toISOString(),
    operationId: ledger?.operation_id || options.operationId || null,
    requirePredictionSnapshot: true
  });
  const comparison = ledger && expected
    ? compareEligibilityRecords(expected, ledger)
    : { match: !anchor, mismatches: anchor ? [{ field: 'ledger', expected: 'PRESENT', actual: 'MISSING' }] : [] };
  const chainRows = anchor
    ? db.prepare(`SELECT * FROM ${tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE bet_id = ? ORDER BY bet_id, snapshot_sequence`).all(numericBetId)
    : [];
  const chain = anchor
    ? tennisPredictionSnapshots.verifyPredictionSnapshotRows(chainRows)
    : { valid: true, rows: 0, bets: 0, failures: [] };
  const lifecycleState = deriveLifecycleState(sourceRow, anchor, comparison, chain);
  const reasons = buildLifecycleReasons(sourceRow, anchor, ledger, comparison, chain);
  const healthy = !anchor || (comparison.match && chain.valid !== false);
  const stateMaterial = {
    betId: numericBetId,
    snapshotId: anchor?.snapshot_id || null,
    snapshotHash: anchor?.snapshot_hash || null,
    clvStatus: text(sourceRow.clv_contract_status) || null,
    settlementStatus: text(sourceRow.settlement_contract_status) || null,
    resultStatus: text(sourceRow.status) || null,
    eligibilityStatus: text(ledger?.eligibility_status) || null,
    lifecycleState,
    reasons
  };
  return {
    success: healthy,
    healthy,
    forwardTracked: Boolean(anchor),
    betId: numericBetId,
    lifecycleState,
    reasons,
    stateHash: sha256(stateMaterial),
    source: {
      status: sourceRow.status || null,
      clvContractStatus: sourceRow.clv_contract_status || null,
      settlementContractStatus: sourceRow.settlement_contract_status || null
    },
    snapshot: anchor ? {
      id: anchor.snapshot_id,
      hash: anchor.snapshot_hash,
      status: anchor.snapshot_status,
      version: anchor.snapshot_version,
      capturedAt: anchor.captured_at
    } : null,
    ledger: ledger ? {
      eligibilityStatus: ledger.eligibility_status,
      settlementEligible: Number(ledger.settlement_eligible || 0),
      clvEligible: Number(ledger.clv_eligible || 0),
      productionEligible: Number(ledger.production_eligible || 0),
      snapshotId: ledger.prediction_snapshot_id || null,
      snapshotHash: ledger.prediction_snapshot_hash || null,
      evaluatedAt: ledger.evaluated_at || null,
      operationId: ledger.operation_id || null
    } : null,
    comparison,
    chain
  };
}
function listForwardBetIds(db) {
  if (!tableExists(db, tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE)) return [];
  return db.prepare(`SELECT DISTINCT bet_id FROM ${tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE is_calibration_anchor = 1 ORDER BY bet_id`).all().map(row => Number(row.bet_id));
}
function scanForwardLifecycle(db, options = {}) {
  const betIds = Number(options.betId) > 0 ? [Number(options.betId)] : listForwardBetIds(db);
  const details = betIds.map(betId => inspectForwardLifecycleBet(db, betId, options));
  const counts = Object.fromEntries(Object.values(LIFECYCLE_STATES).map(state => [state, 0]));
  for (const item of details) counts[item.lifecycleState] = Number(counts[item.lifecycleState] || 0) + 1;
  const drift = details.filter(item => !item.healthy);
  const requestedLimit = Math.max(1, Number(options.limit || 30));
  const unboundedDetails = options.internalUnboundedDetails === true;
  const detailLimit = unboundedDetails ? details.length : Math.min(100, requestedLimit);
  const visibleDetails = options.includeDetails === false ? [] : details.slice(0, detailLimit);
  return {
    success: drift.length === 0,
    version: TENNIS_FORWARD_LIFECYCLE_VERSION,
    mode: 'READ_ONLY_DERIVED_HEALTH',
    trackedBets: details.length,
    healthyBets: details.length - drift.length,
    driftBets: drift.length,
    counts,
    details: visibleDetails,
    detailsReturned: visibleDetails.length,
    detailsTruncated: options.includeDetails === false ? details.length > 0 : visibleDetails.length < details.length,
    internalUnboundedDetails: unboundedDetails
  };
}
function executeAtomicLifecycleTransition(db, config = {}, mutator) {
  if (!db || typeof db.transaction !== 'function') throw new Error('PATCH8_DB_TRANSACTION_REQUIRED');
  if (typeof mutator !== 'function') throw new Error('PATCH8_MUTATOR_REQUIRED');
  const betId = Number(config.betId);
  if (!(betId > 0)) throw new Error('PATCH8_LIFECYCLE_BET_ID_INVALID');
  const transition = text(config.transition) || 'UNKNOWN_TRANSITION';
  const operationId = config.operationId || runtimeDiagnostics.createOperationId(`TENNIS_${transition}`);

  runtimeDiagnostics.writeDiagnostic({
    level: 'INFO', component: 'TENNIS_FORWARD_LIFECYCLE', operation: transition,
    operationId, phase: 'LIFECYCLE_TX_START', event: 'LIFECYCLE_TX_START',
    message: `Avvio transazione lifecycle ${transition} per bet ${betId}.`, context: { betId, transition }
  });

  const run = () => {
    const mutationResult = mutator();
    if (mutationResult === false || mutationResult?.success === false || mutationResult?.updated === false) {
      throw new Error(`PATCH8_MUTATION_NOT_APPLIED:${transition}:${betId}`);
    }
    const eligibilityResult = tennisPredictionSnapshots.refreshCalibrationEligibilityForBet(db, betId, { operationId });
    if (!eligibilityResult.updated) throw new Error(`PATCH8_ELIGIBILITY_REFRESH_FAILED:${eligibilityResult.reason || 'UNKNOWN'}`);
    const cohortResult = tennisForwardCohorts.refreshForwardCohortMaturity(db, betId, { operationId });
    if (cohortResult.assigned === false && cohortResult.reason !== 'FORWARD_ANCHOR_NOT_FOUND') {
      throw new Error(`PATCH9_COHORT_REFRESH_FAILED:${cohortResult.reason || 'UNKNOWN'}`);
    }
    const inspection = inspectForwardLifecycleBet(db, betId, { operationId });
    if (!inspection.healthy) {
      const error = new Error(`PATCH8_LIFECYCLE_DRIFT:${inspection.reasons.join(',') || 'UNKNOWN'}`);
      error.lifecycleInspection = inspection;
      throw error;
    }
    return { success: true, betId, transition, operationId, mutationResult, eligibilityResult, cohortResult, inspection };
  };

  try {
    const result = runAtomic(db, run);
    runtimeDiagnostics.writeDiagnostic({
      level: 'INFO', component: 'TENNIS_FORWARD_LIFECYCLE', operation: transition,
      operationId, phase: 'LIFECYCLE_TX_COMMIT', event: 'LIFECYCLE_TX_COMMIT',
      message: `Transazione lifecycle ${transition} completata per bet ${betId}.`,
      context: { betId, transition, lifecycleState: result.inspection.lifecycleState, eligibilityStatus: result.inspection.ledger?.eligibilityStatus || null }
    });
    return result;
  } catch (error) {
    runtimeDiagnostics.captureError({
      component: 'TENNIS_FORWARD_LIFECYCLE', operation: transition, operationId,
      phase: 'LIFECYCLE_TX_ROLLBACK', event: 'LIFECYCLE_TX_ROLLBACK', error,
      context: { betId, transition, lifecycleInspection: error.lifecycleInspection || null }
    });
    throw error;
  }
}
function reconcileForwardLifecycle(db, options = {}) {
  const apply = options.apply === true;
  const operationId = options.operationId || runtimeDiagnostics.createOperationId('TENNIS_LIFECYCLE_RECONCILE');
  const before = scanForwardLifecycle(db, { includeDetails: true, internalUnboundedDetails: true, limit: 100000 });
  const candidates = before.details.filter(item => !item.healthy && item.forwardTracked && item.chain?.valid !== false);
  const repaired = [];
  const failed = [];
  if (apply) {
    for (const candidate of candidates) {
      try {
        const run = () => {
          const refreshed = tennisPredictionSnapshots.refreshCalibrationEligibilityForBet(db, candidate.betId, { operationId });
          if (!refreshed.updated) throw new Error(refreshed.reason || 'ELIGIBILITY_REFRESH_FAILED');
          const cohort = tennisForwardCohorts.refreshForwardCohortMaturity(db, candidate.betId, { operationId });
          if (cohort.assigned === false && cohort.reason !== 'FORWARD_ANCHOR_NOT_FOUND') {
            throw new Error(cohort.reason || 'COHORT_REFRESH_FAILED');
          }
          return { refreshed, cohort };
        };
        runAtomic(db, run);
        const afterBet = inspectForwardLifecycleBet(db, candidate.betId, { operationId });
        if (!afterBet.healthy) throw new Error(`DRIFT_REMAINS:${afterBet.reasons.join(',')}`);
        repaired.push({ betId: candidate.betId, lifecycleState: afterBet.lifecycleState });
      } catch (error) {
        failed.push({ betId: candidate.betId, error: error.message });
      }
    }
  }
  const after = apply ? scanForwardLifecycle(db, { includeDetails: true, internalUnboundedDetails: true, limit: 100000 }) : before;
  runtimeDiagnostics.writeDiagnostic({
    level: failed.length ? 'ERROR' : (before.driftBets ? 'WARN' : 'INFO'),
    component: 'TENNIS_FORWARD_LIFECYCLE', operation: TRANSITIONS.ELIGIBILITY_RECONCILE,
    operationId, phase: apply ? 'LIFECYCLE_RECONCILE_APPLY' : 'LIFECYCLE_RECONCILE_DRY_RUN',
    event: 'LIFECYCLE_RECONCILE',
    message: apply ? `Reconcile lifecycle completato: ${repaired.length} riparati, ${failed.length} falliti.` : `Audit lifecycle read-only: ${before.driftBets} drift rilevati.`,
    context: { apply, beforeDrift: before.driftBets, afterDrift: after.driftBets, repaired, failed }
  });
  return { success: failed.length === 0 && after.driftBets === 0, apply, operationId, before, after, repaired, failed };
}

module.exports = {
  TENNIS_FORWARD_LIFECYCLE_VERSION,
  LIFECYCLE_STATES,
  TRANSITIONS,
  stableObject,
  sha256,
  parseReasons,
  normalizeComparableRecord,
  compareEligibilityRecords,
  runAtomic,
  deriveLifecycleState,
  inspectForwardLifecycleBet,
  scanForwardLifecycle,
  executeAtomicLifecycleTransition,
  reconcileForwardLifecycle
};
