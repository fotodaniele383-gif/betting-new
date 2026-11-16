#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');

const PATCH = 'TENNIS_PATCH_48_OPERATIONAL_AUTHORITY_ALIGNMENT_FORWARD_QUARANTINE_CANONICAL_DEEPSCAN';
const REVISION = 'R5_WINDOWS_NODE_CONTINUOUS_CLV_LEDGER_ONBOARDING';
const DEEPSCAN_VERSION = 'TENNIS_DEEPSCAN_CANONICAL_TRUTH_V1_PATCH48';
const RESULT_MARKER = '@@TENNIS_PATCH48_R5_RESULT@@';
const dbPath = path.resolve(process.argv.find(arg => arg.endsWith('.db')) || path.join(__dirname, 'database_betting.db'));

function openDb() {
  try {
    const req = createRequire(path.join(__dirname, '..', 'package.json'));
    const BetterSqlite3 = req('better-sqlite3');
    return new BetterSqlite3(dbPath);
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(dbPath);
  }
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function upper(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function uniq(values) { return [...new Set((values || []).map(Number).filter(Number.isFinite))]; }
function tableColumns(db, table) { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)); }
function addColumn(db, definition) {
  const name = definition.split(/\s+/)[0];
  if (!tableColumns(db, 'ai_forward_test').has(name)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${definition}`);
}
function normalizeDeepScan(value) {
  const text = upper(value);
  if (/VALUE.CONFERMATO|VALUE_CONFIRMED/.test(text)) return 'VALUE_CONFIRMED';
  if (/EDGE.TECNICO|TECHNICAL_EDGE/.test(text)) return 'TECHNICAL_EDGE';
  if (/RISCHIO.MODELLO|MODEL_RISK/.test(text)) return 'MODEL_RISK';
  if (/ALTO.RISCHIO|HIGH_RISK/.test(text)) return 'HIGH_RISK';
  if (/WATCHLIST|LOW_EDGE/.test(text)) return 'WATCHLIST';
  if (/ATTENDI|IN.PLAY|LIVE/.test(text)) return 'WAIT_IN_PLAY';
  return text || 'NO_DEEPSCAN';
}
function businessRows(db) {
  return db.prepare(`SELECT id,stake,estimated_prob,odd,closing_odd,clv,status,ds_action,
    tennis_probability_guard_status,tennis_stake_final_executable,tennis_stake_final_execution_status
    FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' ORDER BY id`).all();
}
function strictCalibrationOnlyCandidate(row) {
  const pending = upper(row.status) === 'PENDING';
  const wta = upper([row.league, row.bet_type, row.strategy_tag, row.tour_type].join(' ')).includes('WTA');
  const qualityCode = upper(row.quality_final_code || row.quality_final_label);
  const legacyQualityAuthorized = qualityCode.includes('APPROVED_WITH_CAP') || qualityCode.includes('APPROVATA CON CAP')
    || qualityCode.includes('WATCHLIST_MICRO') || qualityCode.includes('WATCHLIST MICRO')
    || qualityCode === 'APPROVED' || qualityCode === 'APPROVATA';
  const qualityAuthorized = upper(row.tennis_stake_quality_authority_status).includes('AUTHORIZED') || legacyQualityAuthorized;
  const riskStatus = upper(row.tennis_stake_risk_authority_status);
  const riskAllowed = !/(PAPER_ONLY|CIRCUIT_BREAKER|BLOCKED|REJECTED)/.test(riskStatus);
  const execution = upper(row.tennis_stake_final_execution_status);
  const guard = upper(row.tennis_probability_guard_status);
  const reason = upper([row.tennis_stake_final_reason, row.tennis_probability_guard_reason].join(' '));
  const onlyCalibration = execution === 'BLOCKED_BY_CALIBRATION_GUARD'
    || (guard === 'HARD_OVERCONFIDENCE_PAPER_ONLY' && reason.includes('CALIBRATION'));
  return pending && !wta && qualityAuthorized && riskAllowed && onlyCalibration
    && finite(row.tennis_stake_quality_cap) > 0 && finite(row.tennis_stake_risk_cap) > 0
    && finite(row.tennis_stake_final_executable) <= 0;
}
function emit(output) {
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify(output)}\n`);
}
function applyTransaction(db, fn) {
  if (typeof db.transaction === 'function') return db.transaction(fn)();
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

const db = openDb();
const stakeContract = require('./tennisStakeExecutionContractPatch46');
const snapshots = require('./tennisPredictionSnapshots');
const cohorts = require('./tennisForwardCohorts');
const lifecycle = require('./tennisForwardLifecycle');
const capture = require('./tennisForwardCaptureHealth');
const clvLedger = require('./tennisClvDegradedLedgerPatch47');

const before = businessRows(db);
const beforeFingerprint = hash(before);
let canonicalized = 0;
let changedStake = 0;
let snapshotsInserted = 0;
let contractRepaired = 0;
const changedBetIds = [];
const contractRepairedBetIds = [];
const skippedCalibrationCandidates = [];
const now = new Date().toISOString();

function persistContractForRow(row, decidedAt, reasonTag = 'CANONICAL_REPAIR') {
  const contract = stakeContract.buildFromRow(row, { decidedAt });
  const fields = stakeContract.toPersistenceFields(contract);
  const setClause = Object.keys(fields).map(key => `${key}=?`).join(',');
  db.prepare(`UPDATE ai_forward_test SET ${setClause} WHERE id=?`).run(...Object.values(fields), row.id);
  const persisted = stakeContract.persistSnapshot(db, contract);
  if (persisted.inserted) snapshotsInserted += 1;
  contractRepaired += 1;
  contractRepairedBetIds.push(Number(row.id));
  return { betId: Number(row.id), reasonTag, inserted: persisted.inserted, snapshotId: persisted.snapshotId };
}

function promoteCalibrationOnly(row) {
  const cap = Math.min(
    2,
    finite(row.tennis_stake_model_suggested, finite(row.quality_stake_amount, 0)),
    finite(row.tennis_stake_quality_cap, 0),
    finite(row.tennis_stake_risk_cap, 0)
  );
  if (!(cap > 0)) return false;
  db.prepare(`UPDATE ai_forward_test SET
    stake=?, professional_gate_max_stake=?, professional_gate_allow_bet=1,
    tennis_stake_authority_proposed_stake=COALESCE(NULLIF(tennis_stake_model_suggested,0),NULLIF(quality_stake_amount,0),?),
    tennis_stake_authority_final_stake=?, tennis_stake_authority_status='AUTHORIZED_MICRO_SAMPLE_CAP',
    tennis_probability_guard_status='SHADOW_OVERCONFIDENCE_MICRO_CAP', tennis_probability_guard_stake_cap=?,
    tennis_probability_guard_reason=?, tennis_stake_quality_authority_status='QUALITY_GATE_AUTHORIZED_PROPOSAL',
    tennis_stake_calibration_status='SHADOW_OVERCONFIDENCE_MICRO_CAP', tennis_stake_calibration_cap=?,
    tennis_stake_final_execution_status='EXECUTABLE_MICRO_STAKE', tennis_stake_final_executable=?,
    tennis_stake_final_authority='PATCH46_FINAL_EXECUTABLE_STAKE_CONTRACT',
    tennis_operational_action='FINAL_MICRO_STAKE_AUTHORIZED_SHADOW_CALIBRATION',
    tennis_operational_status='PROBABILITY_GUARD_SHADOW_OVERCONFIDENCE_MICRO_CAP'
    WHERE id=?`).run(
      cap, cap, finite(row.tennis_stake_model_suggested, finite(row.quality_stake_amount, cap)), cap, cap,
      'Patch48 R4: la calibrazione non production-ready resta diagnostica e può solo mantenere il cap micro già autorizzato da Quality e Risk.',
      cap, cap, row.id
    );
  const updated = db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(row.id);
  persistContractForRow(updated, now, 'CALIBRATION_ONLY_MICRO_REALIGNMENT');
  changedStake += 1;
  changedBetIds.push(Number(row.id));
  return true;
}

function repairDecisionContract(betId, pass) {
  const row = db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(Number(betId));
  if (!row) return { betId: Number(betId), repaired: false, reason: 'SOURCE_BET_NOT_FOUND' };
  if (strictCalibrationOnlyCandidate(row)) {
    const repaired = promoteCalibrationOnly(row);
    return { betId: Number(betId), repaired, reason: repaired ? 'CALIBRATION_ONLY_PROMOTED' : 'CALIBRATION_CAP_ZERO' };
  }
  const hasContract = upper(row.tennis_stake_contract_version) === 'TENNIS_STAKE_EXECUTION_CONTRACT_V1_PATCH46';
  const eligibleBackfill = hasContract || upper(row.status) === 'PENDING' || Boolean(row.quality_decision_at);
  if (!eligibleBackfill) return { betId: Number(betId), repaired: false, reason: 'NO_CANONICAL_CONTRACT_SCOPE' };
  try {
    persistContractForRow(row, now, `DECISION_CONTRACT_FIXPOINT_PASS_${pass}`);
    return { betId: Number(betId), repaired: true, reason: 'CONTRACT_REBUILT_PRESERVING_STAKE' };
  } catch (error) {
    return { betId: Number(betId), repaired: false, reason: error.message };
  }
}


function reconcileCohortsCompat(pass) {
  const evaluatedAt = new Date().toISOString();
  const operationId = `TENNIS_PATCH48_R5_COHORT_FIXPOINT_${pass}`;
  const rows = db.prepare('SELECT bet_id FROM tennis_forward_cohort_members ORDER BY bet_id').all();
  const result = { success: true, scanned: rows.length, updated: 0, unchanged: 0, blocked: 0, errors: [] };
  for (const row of rows) {
    try {
      const inspected = cohorts.inspectForwardCohortMember(db, row.bet_id, { evaluatedAt });
      const staleOnly = inspected.reasons?.length === 1 && inspected.reasons[0] === 'COHORT_MATURITY_STALE';
      if (staleOnly && inspected.sealValid && inspected.stateHashValid) {
        cohorts.refreshForwardCohortMaturity(db, row.bet_id, { evaluatedAt, operationId });
        result.updated += 1;
      } else if (inspected.success) {
        result.unchanged += 1;
      } else {
        result.blocked += 1;
        result.errors.push({ betId: Number(row.bet_id), reasons: inspected.reasons || [] });
      }
    } catch (error) {
      result.blocked += 1;
      result.errors.push({ betId: Number(row.bet_id), reasons: [error.message] });
    }
  }
  result.after = cohorts.scanForwardCohorts(db, { evaluatedAt, limit: 2000 });
  result.healthy = result.after.healthy;
  result.success = result.errors.length === 0;
  return result;
}

function refreshBet(betId, pass) {
  const operationId = `TENNIS_PATCH48_R5_FIXPOINT_${pass}_${betId}`;
  const eligibility = snapshots.refreshCalibrationEligibilityForBet(db, betId, { operationId });
  const cohort = cohorts.refreshForwardCohortMaturity(db, betId, { operationId });
  const eligibilityOk = eligibility.updated !== false || ['NO_CALIBRATION_ANCHOR', 'FORWARD_ANCHOR_NOT_FOUND'].includes(eligibility.reason);
  const cohortOk = cohort.assigned !== false || cohort.reason === 'FORWARD_ANCHOR_NOT_FOUND';
  if (!eligibilityOk) throw new Error(`ELIGIBILITY_REFRESH_FAILED:${eligibility.reason || 'UNKNOWN'}`);
  if (!cohortOk) throw new Error(`COHORT_REFRESH_FAILED:${cohort.reason || 'UNKNOWN'}`);
  return { betId, eligibility: eligibility.updated !== false, cohort: cohortOk };
}

try {
  stakeContract.ensureSchema(db);
  const clvLedgerCoverage = clvLedger.reconcileOperationalCoverage(db, {
    strict: true,
    source: 'PATCH48_R5_INSTALL_MIGRATION',
    now: new Date(now)
  });
  if (!clvLedgerCoverage.success) {
    throw new Error(`PATCH47_LEDGER_ONBOARDING_FAILED:${JSON.stringify(clvLedgerCoverage)}`);
  }
  addColumn(db, 'tennis_deepscan_canonical_version TEXT');
  addColumn(db, 'tennis_deepscan_canonical_action TEXT');
  addColumn(db, 'tennis_deepscan_canonical_source TEXT');
  addColumn(db, 'tennis_deepscan_canonical_hash TEXT');
  addColumn(db, 'tennis_deepscan_canonical_at TEXT');

  applyTransaction(db, () => {
    const rows = db.prepare("SELECT * FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").all();
    const canonicalUpdate = db.prepare(`UPDATE ai_forward_test SET
      tennis_deepscan_canonical_version=?, tennis_deepscan_canonical_action=?,
      tennis_deepscan_canonical_source=?, tennis_deepscan_canonical_hash=?, tennis_deepscan_canonical_at=?
      WHERE id=?`);
    for (const row of rows) {
      const action = normalizeDeepScan(row.ds_action || row.deep_scan_canonical_code || row.quality_deepscan_class);
      const source = 'PERSISTED_DEEPSCAN_SNAPSHOT';
      const evidenceHash = hash({ id: row.id, action, source });
      if (row.tennis_deepscan_canonical_version !== DEEPSCAN_VERSION
        || row.tennis_deepscan_canonical_action !== action
        || row.tennis_deepscan_canonical_source !== source
        || row.tennis_deepscan_canonical_hash !== evidenceHash) {
        canonicalUpdate.run(DEEPSCAN_VERSION, action, source, evidenceHash, now, row.id);
        canonicalized += 1;
      }
    }

    const candidates = db.prepare(`SELECT * FROM ai_forward_test
      WHERE UPPER(COALESCE(sport_type,''))='TENNIS'
        AND UPPER(COALESCE(status,''))='PENDING'
        AND COALESCE(tennis_stake_final_executable,0)<=0
        AND COALESCE(tennis_stake_quality_cap,0)>0
        AND COALESCE(tennis_stake_risk_cap,0)>0`).all();
    for (const row of candidates) {
      if (!strictCalibrationOnlyCandidate(row)) {
        if (upper(row.tennis_probability_guard_status) === 'HARD_OVERCONFIDENCE_PAPER_ONLY') {
          skippedCalibrationCandidates.push({ id: row.id, reason: 'UPSTREAM_AUTHORITY_NOT_CERTIFIED' });
        }
        continue;
      }
      promoteCalibrationOnly(row);
    }
  });

  const passes = [];
  const refreshFailed = [];
  let pendingRefresh = uniq([...changedBetIds, ...contractRepairedBetIds]);
  let forward = null;
  let cohortHealth = null;
  let finalLifecycle = null;

  for (let pass = 1; pass <= 3; pass += 1) {
    const refreshed = [];
    for (const betId of pendingRefresh) {
      try { refreshed.push(refreshBet(betId, pass)); }
      catch (error) { refreshFailed.push({ pass, betId, error: error.message }); }
    }

    const cohortReconcile = reconcileCohortsCompat(pass);
    const lifecycleReconcile = lifecycle.reconcileForwardLifecycle(db, {
      apply: true,
      operationId: `TENNIS_PATCH48_R5_LIFECYCLE_FIXPOINT_${pass}`
    });

    forward = capture.scanForwardCaptureHealth(db, { limit: 2000 });
    cohortHealth = cohorts.scanForwardCohorts(db, { limit: 2000 });
    const decisionDetails = (forward.details || []).filter(item => item.blockClass === 'DECISION_CONTRACT');
    const structuralDetails = (forward.details || []).filter(item => item.blockClass === 'STRUCTURAL_INTEGRITY');
    const repairs = [];
    for (const item of decisionDetails) repairs.push(repairDecisionContract(item.betId, pass));

    const repairedIds = uniq([
      ...(lifecycleReconcile.repaired || []).map(item => item.betId),
      ...repairs.filter(item => item.repaired).map(item => item.betId)
    ]);
    passes.push({
      pass,
      pendingRefresh,
      refreshed,
      cohort: {
        success: cohortReconcile.success,
        updated: cohortReconcile.updated,
        unchanged: cohortReconcile.unchanged,
        blocked: cohortReconcile.blocked,
        errors: cohortReconcile.errors
      },
      lifecycle: {
        success: lifecycleReconcile.success,
        beforeDrift: lifecycleReconcile.before?.driftBets ?? null,
        afterDrift: lifecycleReconcile.after?.driftBets ?? null,
        repaired: lifecycleReconcile.repaired || [],
        failed: lifecycleReconcile.failed || []
      },
      forward: {
        activeStructuralFaults: forward.activeStructuralFaults,
        decisionContractBlocked: forward.decisionContractBlocked,
        evidenceOverdue: forward.evidenceOverdue,
        expectedTemporalExclusions: forward.expectedTemporalExclusions,
        structuralDetails: structuralDetails.map(item => ({ betId: item.betId, reasons: item.reasons })),
        decisionDetails: decisionDetails.map(item => ({ betId: item.betId, reasons: item.reasons }))
      },
      repairs
    });

    finalLifecycle = lifecycleReconcile;
    if (Number(forward.activeStructuralFaults || 0) === 0
      && Number(forward.decisionContractBlocked || 0) === 0
      && Number(lifecycleReconcile.after?.driftBets || 0) === 0
      && Number(cohortHealth.activeLeakageFaults || 0) === 0) break;
    pendingRefresh = repairedIds;
  }

  // A final read-only verification after the last write pass.
  finalLifecycle = lifecycle.reconcileForwardLifecycle(db, {
    apply: false,
    operationId: 'TENNIS_PATCH48_R5_LIFECYCLE_FINAL_AUDIT'
  });
  forward = capture.scanForwardCaptureHealth(db, { limit: 2000 });
  cohortHealth = cohorts.scanForwardCohorts(db, { limit: 2000 });

  const after = businessRows(db);
  const integrity = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const probabilityChanged = before.some((row, index) => row.estimated_prob !== after[index]?.estimated_prob);
  const oddsChanged = before.some((row, index) => row.odd !== after[index]?.odd || row.closing_odd !== after[index]?.closing_odd);
  const clvChanged = before.some((row, index) => row.clv !== after[index]?.clv);
  const failures = [];
  if (String(integrity).toLowerCase() !== 'ok') failures.push('DATABASE_INTEGRITY');
  if (foreignKeys.length) failures.push('FOREIGN_KEY_VIOLATIONS');
  if (probabilityChanged) failures.push('PROBABILITY_CHANGED');
  if (oddsChanged) failures.push('ODDS_CHANGED');
  if (clvChanged) failures.push('CLV_CHANGED');
  if (refreshFailed.length) failures.push('TARGETED_RECONCILE_FAILED');
  if (Number(finalLifecycle.before?.driftBets || 0) > 0) failures.push('LIFECYCLE_DRIFT_REMAINS');
  if (Number(cohortHealth.activeLeakageFaults || 0) > 0) failures.push('ACTIVE_COHORT_LEAKAGE_FAULTS');
  if (Number(forward.activeStructuralFaults || 0) > 0) failures.push('ACTIVE_STRUCTURAL_FAULTS');
  if (Number(forward.decisionContractBlocked || 0) > 0) failures.push('DECISION_CONTRACT_FAULTS');
  if (!clvLedgerCoverage.success || clvLedgerCoverage.after?.fullyCovered !== clvLedgerCoverage.after?.operationalRows) failures.push('PATCH47_OPERATIONAL_COVERAGE_INCOMPLETE');

  const output = {
    success: failures.length === 0,
    patch: PATCH,
    revision: REVISION,
    migration: 'CONTINUOUS_CLV_LEDGER_ONBOARDING_UNBOUNDED_LIFECYCLE_RECONCILE_AND_AUTHORITY_ALIGNMENT',
    resultMarker: RESULT_MARKER,
    clvLedgerCoverage,
    canonicalized,
    changedStake,
    changedBetIds: uniq(changedBetIds),
    contractRepaired,
    contractRepairedBetIds: uniq(contractRepairedBetIds),
    snapshotsInserted,
    skippedCalibrationCandidates,
    refreshFailed,
    fixpointPasses: passes,
    lifecycleFinal: {
      success: finalLifecycle.success,
      driftBets: finalLifecycle.before?.driftBets ?? null,
      failed: finalLifecycle.failed || []
    },
    cohorts: {
      activeLeakageFaults: cohortHealth.activeLeakageFaults,
      expectedTemporalExclusions: cohortHealth.expectedTemporalExclusions,
      leakageBlocked: cohortHealth.leakageBlocked
    },
    forward: {
      trackedBets: forward.trackedBets,
      pipelineAvailable: forward.pipelineAvailable,
      activeStructuralFaults: forward.activeStructuralFaults,
      decisionContractBlocked: forward.decisionContractBlocked,
      evidenceOverdue: forward.evidenceOverdue,
      expectedTemporalExclusions: forward.expectedTemporalExclusions,
      diagnosticSummary: forward.diagnosticSummary,
      blockedDetails: (forward.details || []).filter(item => item.status === 'BLOCKED').map(item => ({
        betId: item.betId, blockClass: item.blockClass, reasons: item.reasons, warnings: item.warnings
      }))
    },
    probabilityChanged,
    oddsChanged,
    clvChanged,
    beforeFingerprint,
    afterFingerprint: hash(after),
    integrity,
    foreignKeyViolations: foreignKeys.length,
    failures
  };
  emit(output);
  if (!output.success) process.exitCode = 1;
} catch (error) {
  emit({ success: false, patch: PATCH, revision: REVISION, resultMarker: RESULT_MARKER, error: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  db.close();
}
