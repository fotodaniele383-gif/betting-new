'use strict';

const crypto = require('crypto');
const finalAuthority = require('./stakeUnifiedAuthorityDecisionR18');

const VERSION = 'TENNIS_STAKE_EXECUTION_CONTRACT_V3_P0_SHADOW';
const SNAPSHOT_TABLE = 'tennis_stake_execution_contracts_patch46';
const FINAL_AUTHORITY = 'PATCH46_FINAL_EXECUTABLE_STAKE_CONTRACT';
const TPI_AUTHORITY = 'DISPLAY_ONLY_NO_STAKE_AUTHORITY';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function upper(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
function bool(value) { return value === true || value === 1 || value === '1'; }
function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value, 0) + Number.EPSILON) * factor) / factor;
}
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    if (value[key] !== undefined) out[key] = sortObject(value[key]);
    return out;
  }, {});
}
function sha256(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(sortObject(value));
  return crypto.createHash('sha256').update(input).digest('hex');
}
function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(name));
}
function columns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => row.name));
}
function addColumn(db, definition) {
  const column = definition.split(/\s+/)[0];
  if (!columns(db, 'ai_forward_test').has(column)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${definition}`);
}

function ensureSchema(db) {
  [
    'tennis_stake_contract_version TEXT',
    'tennis_stake_model_suggested REAL',
    'tennis_stake_tpi_authority_status TEXT',
    'tennis_stake_quality_authority_status TEXT',
    'tennis_stake_quality_cap REAL',
    'tennis_stake_risk_authority_status TEXT',
    'tennis_stake_risk_cap REAL',
    'tennis_stake_calibration_status TEXT',
    'tennis_stake_calibration_cap REAL',
    'tennis_stake_final_execution_status TEXT',
    'tennis_stake_final_executable REAL',
    'tennis_stake_final_authority TEXT',
    'tennis_stake_final_reason TEXT',
    'tennis_stake_contract_hash TEXT',
    'tennis_stake_contract_snapshot_id TEXT',
    'tennis_stake_contract_decided_at TEXT'
  ].forEach(definition => addColumn(db, definition));

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SNAPSHOT_TABLE} (
      snapshot_id TEXT PRIMARY KEY,
      bet_id INTEGER NOT NULL,
      decided_at TEXT NOT NULL,
      contract_version TEXT NOT NULL,
      contract_hash TEXT NOT NULL,
      model_suggested_stake REAL NOT NULL,
      quality_authority_status TEXT NOT NULL,
      risk_authority_status TEXT NOT NULL,
      calibration_status TEXT NOT NULL,
      final_execution_status TEXT NOT NULL,
      final_executable_stake REAL NOT NULL,
      final_authority TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(bet_id, contract_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_${SNAPSHOT_TABLE}_bet_decided
      ON ${SNAPSHOT_TABLE}(bet_id, decided_at);
    CREATE TRIGGER IF NOT EXISTS trg_${SNAPSHOT_TABLE}_no_update
      BEFORE UPDATE ON ${SNAPSHOT_TABLE}
      BEGIN SELECT RAISE(ABORT, 'TENNIS_PATCH46_STAKE_CONTRACT_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_${SNAPSHOT_TABLE}_no_delete
      BEFORE DELETE ON ${SNAPSHOT_TABLE}
      BEGIN SELECT RAISE(ABORT, 'TENNIS_PATCH46_STAKE_CONTRACT_APPEND_ONLY'); END;
  `);
}

function qualityStatus(quality = {}, proposedStake = 0) {
  const code = upper(quality.code || quality.status || quality.label);
  const allowBet = bool(quality.allowBet ?? quality.allow_bet ?? quality.professional_gate_allow_bet);
  if (code.includes('BLOCKED_HARD') || code.includes('BLOCCATA HARD')) return 'QUALITY_GATE_BLOCKED_HARD';
  if (/(BLOCK|BLOCC|VETO|DENIED|REJECT)/.test(code)) return 'QUALITY_GATE_BLOCKED';
  if (!allowBet && proposedStake > 0) return 'QUALITY_GATE_BLOCKED';
  if (allowBet && proposedStake > 0) return 'QUALITY_GATE_AUTHORIZED_PROPOSAL';
  return 'QUALITY_GATE_NO_STAKE_PROPOSAL';
}

function qualityAllowed(quality = {}, status = '') {
  const code = upper(
    quality.code || quality.status || quality.label || status
  );
  const allow = bool(
    quality.allowBet ??
    quality.allow_bet ??
    quality.professional_gate_allow_bet
  );

  return allow &&
    !/(BLOCK|BLOCC|VETO|DENIED|REJECT)/.test(code);
}

function riskAllowed(risk = {}, status = '') {
  const s = upper(status || risk.status);

  return !bool(risk.circuitBreaker) &&
    (
      s === 'OK' ||
      s === 'AUTHORIZED' ||
      s.startsWith('AUTHORIZED_')
    );
}

function calibrationAllowed(calibration = {}, status = '') {
  const s = upper(status || calibration.status);
  if (['PASS', 'OK', 'OVERCONFIDENCE_MICRO_CAP'].includes(s)) return true;
  // R14: Patch39/48 can issue a SHADOW diagnostic micro-cap while the
  // independently authorized Quality/Risk stages still permit paper stake.
  // Never infer permission from a bare SHADOW label: require its exact producer
  // and the explicit 2-euro cap. This does not lift any hard Quality/Risk veto.
  if (s === 'SHADOW_OVERCONFIDENCE_MICRO_CAP') {
    const authority = upper(calibration.decisionAuthority || calibration.authority);
    const cap = strictAmount(calibration.capStake ?? calibration.finalStakeCap);
    return authority === 'PATCH48_SHADOW_DIAGNOSTIC_MICRO_CAP' && cap === 2;
  }
  return false;
}
function strictAmount(value) {
  if (value === null || value === undefined || typeof value === 'boolean' ||
      (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function finalExecutionStatus({
  finalStake, quality, risk, calibration, modelSuggestedStake
}) {
  if (!(modelSuggestedStake > 0))
    return 'NO_EXECUTABLE_STAKE';

  if (!qualityAllowed(quality))
    return 'BLOCKED_BY_QUALITY_GATE';

  if (!riskAllowed(risk))
    return upper(risk.status).includes('PAPER_ONLY') ||
      bool(risk.circuitBreaker)
      ? 'PAPER_ONLY_RISK_GUARD'
      : 'BLOCKED_BY_RISK_AUTHORITY';

  if (!calibrationAllowed(calibration))
    return 'BLOCKED_BY_CALIBRATION_GUARD';

  if (finalStake > 0)
    return finalStake <= 2
      ? 'EXECUTABLE_MICRO_STAKE'
      : 'EXECUTABLE_STANDARD_STAKE';

  return 'NO_EXECUTABLE_STAKE';
}

function buildContract(input = {}) {
  const decidedAt = input.decidedAt || new Date().toISOString();
  const quality = input.qualityGate || input.quality || {};
  const risk = input.riskAuthority || input.finalStakeAuthority || {};
  const calibration = input.calibrationGuard || input.probabilityCalibrationGuard || {};
  const modelSuggestedStake = round(number(
    input.modelSuggestedStake ??
    quality?.stake?.amount ??
    quality.quality_stake_amount ??
    risk.proposedStake ??
    input.proposedStake,
    0
  ));
  const qualityCap = round(number(
    input.qualityCap ?? quality?.stake?.amount ?? quality.maxStake ?? quality.professional_gate_max_stake,
    modelSuggestedStake
  ));
  const riskCap = round(number(input.riskCap ?? risk.finalStake, qualityCap));
  const calibrationCap = round(number(
    input.calibrationCap ?? calibration.finalStakeCap ?? calibration.finalStake,
    riskCap
  ));
  const qualityAuthorityStatus = qualityStatus(quality, qualityCap);
  const riskAuthorityStatus = upper(risk.status || 'RISK_AUTHORITY_UNAVAILABLE');
  const calibrationStatus = upper(calibration.status || 'CALIBRATION_GUARD_UNAVAILABLE');

  const proposedFinal = number(
    input.finalExecutableStake ??
    input.persistedStake ??
    input.finalStake,
    0
  );

  // R14: a new live decision must not silently sanitize a stake that exceeds
  // its signed cap. Historical rows explicitly vetoed by integrity controls
  // remain readable as blocked, preserving append-only forensic behavior.
  const absoluteCap = Math.min(modelSuggestedStake, qualityCap, riskCap, calibrationCap, 10);
  if (input.historicalIntegrityVeto !== true &&
      (proposedFinal < 0 || proposedFinal > absoluteCap + 1e-9)) {
    throw new Error('TENNIS_PATCH46_STAKE_CONTRACT_INVARIANT_FAILED');
  }
  const capped = round(Math.max(0, Math.min(proposedFinal, absoluteCap)));

  const permitted =
    input.historicalIntegrityVeto !== true && qualityAuthorityStatus === 'QUALITY_GATE_AUTHORIZED_PROPOSAL' &&
    qualityAllowed(quality) &&
    riskAllowed(risk) &&
    calibrationAllowed(calibration);

  const finalStake = permitted && capped >= 2 ? capped : 0;
  const vetoReasons=[];
  if (input.historicalIntegrityVeto===true) vetoReasons.push('HISTORICAL_INTEGRITY_VETO');
  if (!qualityAllowed(quality)) vetoReasons.push('QUALITY_GATE_DENIED');
  if (!riskAllowed(risk)) vetoReasons.push('RISK_AUTHORITY_DENIED');
  if (!calibrationAllowed(calibration)) vetoReasons.push('CALIBRATION_GUARD_DENIED');
  if (!(modelSuggestedStake>0)) vetoReasons.push('NO_MODEL_SUGGESTION');
  if (permitted && capped<2) vetoReasons.push('STAKE_BELOW_2_EUR_MINIMUM');
  const unifiedDecision=finalAuthority.decide({sport:'TENNIS',approved:finalStake>0,proposedStake:finalStake,
    minimumStake:2,expectedValuePct:null,hasVerifiedValue:false,hardReasons:vetoReasons,
    stage:'POST_QUALITY_RISK_CALIBRATION'});
  if (unifiedDecision.eligible !== (finalStake>0)) throw new Error('R18_TENNIS_AUTHORITY_CONTRACT_INCOHERENT');

  const executionStatus = finalExecutionStatus({
    finalStake,
    quality,
    risk,
    calibration,
    modelSuggestedStake
  });

  const reasonChain = [];
  if (input.historicalIntegrityVeto === true)
    reasonChain.push('INTEGRITY_VETO:STORED_STAKE_EXCEEDS_VERIFIED_CAP');
  if (quality.reason) reasonChain.push(`QUALITY: ${String(quality.reason)}`);
  if (risk.reason) reasonChain.push(`RISK: ${String(risk.reason)}`);
  if (calibration.reason) reasonChain.push(`CALIBRATION: ${String(calibration.reason)}`);
  reasonChain.push(...vetoReasons.map(r => 'R18_DECISION:'+r));
  if (!reasonChain.length) reasonChain.push(finalStake > 0 ? 'Stake finale autorizzato dalla catena completa.' : 'Nessuno stake finale eseguibile.');

  const contractCore = {
    version: VERSION,
    betId: input.betId == null ? null : number(input.betId, null),
    tpi: {
      status: TPI_AUTHORITY,
      role: 'DIAGNOSTIC_RANKING_ONLY',
      stakeAuthority: false
    },
    modelSuggestion: {
      role: 'NON_EXECUTABLE_PROPOSAL',
      stake: modelSuggestedStake
    },
    qualityGate: {
      status: qualityAuthorityStatus,
      role: 'PROPOSAL_AND_CAP_AUTHORITY',
      allowBet: bool(quality.allowBet ?? quality.allow_bet ?? quality.professional_gate_allow_bet),
      code: quality.code || quality.status || null,
      capStake: qualityCap
    },
    riskAuthority: {
      status: riskAuthorityStatus,
      role: 'RISK_CAP_AUTHORITY',
      capStake: riskCap,
      circuitBreaker: bool(risk.circuitBreaker),
      sourceVersion: risk.version || null
    },
    calibrationGuard: {
      status: calibrationStatus,
      role: calibrationStatus.includes('SHADOW_') ? 'SHADOW_DIAGNOSTIC_MICRO_CAP' : 'FINAL_REDUCTION_GUARD',
      capStake: calibrationCap,
      decisionAuthority: calibration.authority || calibration.decisionAuthority || null,
      sourceVersion: calibration.version || null
    },
    finalExecution: {
      status: executionStatus,
      authorityDecisionCode: unifiedDecision.code,
      authorityDecision: unifiedDecision,
      authority: FINAL_AUTHORITY,
      executableStake: finalStake,
      // R14: positive *paper* stake is NOT a real-money execution permission.
      paperOnly: true,
      realMoneyAuthorized: false,
      automaticExecution: false,
      reason: reasonChain.join(' | ')
    },
    invariants: {
      noStakeIncreaseOverModelSuggestion: finalStake <= modelSuggestedStake + 1e-9,
      noStakeIncreaseOverQualityCap: finalStake <= qualityCap + 1e-9,
      noStakeIncreaseOverRiskCap: finalStake <= riskCap + 1e-9,
      noStakeIncreaseOverCalibrationCap: finalStake <= calibrationCap + 1e-9,
      singleFinalAuthority: true,
      tpiHasNoStakeAuthority: true
    }
  };

  const contractHash = sha256(contractCore);
  const snapshotId = `TSE46_${contractCore.betId == null ? 'NA' : contractCore.betId}_${contractHash.slice(0, 20)}`;
  const contract = { ...contractCore, contractHash, snapshotId, decidedAt };
  validateContract(contract);
  return contract;
}

function validateContract(contract = {}) {
  const invariantValues = Object.values(contract.invariants || {});
  if (!invariantValues.length || invariantValues.some(value => value !== true)) {
    const error = new Error('TENNIS_PATCH46_STAKE_CONTRACT_INVARIANT_FAILED');
    error.code = 'TENNIS_PATCH46_STAKE_CONTRACT_INVARIANT_FAILED';
    error.contract = contract;
    throw error;
  }
  if (contract.finalExecution?.authority !== FINAL_AUTHORITY) throw new Error('TENNIS_PATCH46_FINAL_AUTHORITY_INVALID');
  if (contract.tpi?.stakeAuthority !== false)
    throw new Error('TENNIS_PATCH46_TPI_AUTHORITY_INVALID');

  if (contract.version === VERSION) {
    const value = contract.finalExecution?.executableStake;

    if (
      !Number.isFinite(value) ||
      (value !== 0 && (value < 2 || value > 10))
    ) throw new Error('TENNIS_P0_STAKE_RANGE_INVALID');

    if (value > 0 && (
      contract.qualityGate?.status !== 'QUALITY_GATE_AUTHORIZED_PROPOSAL' ||
      !qualityAllowed(contract.qualityGate) ||
      !riskAllowed(contract.riskAuthority) ||
      !calibrationAllowed(contract.calibrationGuard) ||
      value > contract.modelSuggestion?.stake + 1e-9 ||
      value > contract.qualityGate?.capStake + 1e-9 ||
      value > contract.riskAuthority?.capStake + 1e-9 ||
      value > contract.calibrationGuard?.capStake + 1e-9
    )) throw new Error('TENNIS_P0_FINAL_VETO_OR_CAP_INVALID');

    const {
      contractHash, snapshotId, decidedAt, ...core
    } = contract;

    if (sha256(core) !== contractHash)
      throw new Error('TENNIS_P0_CONTRACT_HASH_INVALID');

    if (
      snapshotId !==
      `TSE46_${core.betId == null ? 'NA' : core.betId}_${contractHash.slice(0, 20)}`
    ) throw new Error('TENNIS_P0_SNAPSHOT_ID_INVALID');
  }

  return true;
}

function toPersistenceFields(contract = {}) {
  validateContract(contract);
  return {
    tennis_stake_contract_version: contract.version,
    tennis_stake_model_suggested: contract.modelSuggestion.stake,
    tennis_stake_tpi_authority_status: contract.tpi.status,
    tennis_stake_quality_authority_status: contract.qualityGate.status,
    tennis_stake_quality_cap: contract.qualityGate.capStake,
    tennis_stake_risk_authority_status: contract.riskAuthority.status,
    tennis_stake_risk_cap: contract.riskAuthority.capStake,
    tennis_stake_calibration_status: contract.calibrationGuard.status,
    tennis_stake_calibration_cap: contract.calibrationGuard.capStake,
    tennis_stake_final_execution_status: contract.finalExecution.status,
    tennis_stake_final_executable: contract.finalExecution.executableStake,
    tennis_stake_final_authority: contract.finalExecution.authority,
    tennis_stake_final_reason: contract.finalExecution.reason,
    tennis_stake_contract_hash: contract.contractHash,
    tennis_stake_contract_snapshot_id: contract.snapshotId,
    tennis_stake_contract_decided_at: contract.decidedAt
  };
}

function persistSnapshot(db, contract = {}) {
  ensureSchema(db);
  validateContract(contract);
  const existing = db.prepare(`SELECT snapshot_id FROM ${SNAPSHOT_TABLE} WHERE bet_id IS ? AND contract_hash=?`).get(contract.betId, contract.contractHash);
  if (existing) return { inserted: false, snapshotId: existing.snapshot_id, reason: 'UNCHANGED_CONTRACT' };
  db.prepare(`INSERT INTO ${SNAPSHOT_TABLE}(
    snapshot_id,bet_id,decided_at,contract_version,contract_hash,model_suggested_stake,
    quality_authority_status,risk_authority_status,calibration_status,final_execution_status,
    final_executable_stake,final_authority,payload_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    contract.snapshotId, contract.betId, contract.decidedAt, contract.version, contract.contractHash,
    contract.modelSuggestion.stake, contract.qualityGate.status, contract.riskAuthority.status,
    contract.calibrationGuard.status, contract.finalExecution.status, contract.finalExecution.executableStake,
    contract.finalExecution.authority, JSON.stringify(contract)
  );
  return { inserted: true, snapshotId: contract.snapshotId, reason: 'NEW_CONTRACT_SNAPSHOT' };
}

function buildFromRow(row = {}, options = {}) {
  const quality = {
    code: row.quality_final_code || row.quality_final_label || row.professional_gate_status,
    label: row.quality_final_label,
    allowBet: row.professional_gate_allow_bet !== null &&
      row.professional_gate_allow_bet !== undefined &&
      String(row.professional_gate_allow_bet).trim() !== ''
      ? bool(row.professional_gate_allow_bet)
      : upper(row.tennis_stake_quality_authority_status) === 'QUALITY_GATE_AUTHORIZED_PROPOSAL',
    reason: row.quality_final_reason || row.deepscan_gate_reason || row.stake_policy_note,
    stake: { amount: number(row.tennis_stake_quality_cap ?? row.quality_stake_amount ?? row.professional_gate_max_stake ?? row.tennis_stake_authority_proposed_stake ?? row.stake, 0) }
  };
  const risk = {
    version: row.tennis_risk_authority_version || row.tennis_stake_authority_version,
    status: row.tennis_stake_risk_authority_status || row.tennis_risk_authority_status || row.tennis_stake_authority_status,
    finalStake: number(row.tennis_stake_risk_cap ?? row.tennis_stake_authority_final_stake ?? row.professional_gate_max_stake ?? row.stake, 0),
    proposedStake: number(row.tennis_stake_model_suggested ?? row.tennis_stake_authority_proposed_stake ?? quality.stake.amount, 0),
    reason: row.tennis_risk_authority_reason || row.tennis_stake_authority_reason,
    circuitBreaker: bool(row.tennis_risk_authority_circuit_breaker)
  };
  const calibration = {
    version: row.tennis_probability_guard_version,
    status: row.tennis_probability_guard_status || row.tennis_stake_calibration_status,
    finalStake: number(row.stake, 0),
    finalStakeCap: number(row.tennis_probability_guard_stake_cap ?? row.tennis_stake_calibration_cap ?? row.stake, 0),
    reason: row.tennis_probability_guard_reason
  };
  const recordedStake = number(row.stake, 0);

  const riskLimit =
    row.tennis_stake_risk_cap ??
    row.tennis_stake_authority_final_stake;

  const calibrationLimit =
    row.tennis_probability_guard_stake_cap ??
    row.tennis_stake_calibration_cap;

  const qualityLimit =
    row.tennis_stake_quality_cap ??
    row.quality_stake_amount;

  const invalidOrExceeded = cap =>
    cap != null && (
      typeof cap === 'boolean' ||
      String(cap).trim() === '' ||
      !Number.isFinite(Number(cap)) ||
      Number(cap) < 0 ||
      recordedStake > Number(cap) + 1e-9
    );

  const historicalIntegrityVeto =
    recordedStake > 0 && (
      invalidOrExceeded(riskLimit) ||
      invalidOrExceeded(calibrationLimit) ||
      invalidOrExceeded(qualityLimit) ||
      recordedStake > 10
    );

  return buildContract({
    historicalIntegrityVeto,
    betId: row.id,
    modelSuggestedStake: number(row.tennis_stake_model_suggested ?? row.quality_stake_amount ?? row.tennis_stake_authority_proposed_stake ?? row.stake_base_before_deepscan ?? row.stake, 0),
    qualityGate: quality,
    riskAuthority: risk,
    calibrationGuard: calibration,
    finalExecutableStake: number(row.stake, 0),
    decidedAt: options.decidedAt || row.tennis_probability_guard_decided_at || row.tennis_stake_authority_decided_at || row.updated_at || new Date().toISOString()
  });
}

function health(db = null) {
  let snapshotRows = null;
  if (db && tableExists(db, SNAPSHOT_TABLE)) snapshotRows = number(db.prepare(`SELECT COUNT(*) n FROM ${SNAPSHOT_TABLE}`).get().n, 0);
  return {
    version: VERSION,
    finalAuthority: FINAL_AUTHORITY,
    tpiAuthority: TPI_AUTHORITY,
    singleFinalAuthority: true,
    noStakeIncrease: true,
    probabilityChanged: false,
    qualityLogicChanged: false,
    riskLogicChanged: false,
    calibrationLogicChanged: false,
    snapshotTable: SNAPSHOT_TABLE,
    appendOnlySnapshots: true,
    snapshotRows
  };
}

module.exports = {
  VERSION,
  SNAPSHOT_TABLE,
  FINAL_AUTHORITY,
  TPI_AUTHORITY,
  ensureSchema,
  buildContract,
  buildFromRow,
  validateContract,
  toPersistenceFields,
  persistSnapshot,
  health,
  sha256
};
