'use strict';

const VERSION = 'AUDIT16D_R3_T7_R1_PATCH46_FINAL_STAKE_LOCK_V2';
const EPSILON = 1e-9;

function text(value) { return String(value == null ? '' : value).trim(); }
function number(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function sameNumber(a, b) {
  const left = number(a); const right = number(b);
  return left !== null && right !== null && Math.abs(left - right) <= EPSILON;
}

function verifySnapshotPayload(snapshot = {}, row = {}, contractApi = {}) {
  const raw = snapshot.payload_json;
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'PATCH46_SNAPSHOT_PAYLOAD_MISSING' };
  let payload;
  try { payload = JSON.parse(raw); } catch (_) { return { ok: false, reason: 'PATCH46_SNAPSHOT_PAYLOAD_INVALID_JSON' }; }
  try {
    if (typeof contractApi.validateContract === 'function') contractApi.validateContract(payload);
  } catch (_) { return { ok: false, reason: 'PATCH46_SNAPSHOT_PAYLOAD_INVARIANT_FAILED' }; }
  const expectedHash = text(row.tennis_stake_contract_hash);
  const expectedSnapshotId = text(row.tennis_stake_contract_snapshot_id);
  const { contractHash, snapshotId, decidedAt, ...core } = payload || {};
  const recomputedHash = typeof contractApi.sha256 === 'function' ? contractApi.sha256(core) : null;
  const ok = Boolean(
    recomputedHash && recomputedHash === expectedHash &&
    text(contractHash) === expectedHash &&
    text(snapshotId) === expectedSnapshotId &&
    Number(payload.betId) === Number(row.id) &&
    text(payload.version) === text(row.tennis_stake_contract_version) &&
    text(payload.finalExecution?.authority) === text(row.tennis_stake_final_authority) &&
    sameNumber(payload.finalExecution?.executableStake, row.tennis_stake_final_executable)
  );
  return { ok, reason: ok ? 'PATCH46_SNAPSHOT_PAYLOAD_HASH_VERIFIED' : 'PATCH46_SNAPSHOT_PAYLOAD_HASH_MISMATCH', recomputedHash };
}

function inspectFinalStakeLock(row = {}, contractApi = {}, options = {}) {
  const expectedAuthority = text(contractApi.FINAL_AUTHORITY);
  const expectedVersion = text(contractApi.VERSION);
  // Explicitly trust only known append-only contract versions; always verify payload hash.
  const knownContractVersions = new Set([
    'TENNIS_STAKE_EXECUTION_CONTRACT_V1_PATCH46',
    'TENNIS_STAKE_EXECUTION_CONTRACT_V3_P0_SHADOW'
  ]);
  const finalStake = number(row.tennis_stake_final_executable);
  const authority = text(row.tennis_stake_final_authority);
  const version = text(row.tennis_stake_contract_version);
  const hash = text(row.tennis_stake_contract_hash);
  const snapshotId = text(row.tennis_stake_contract_snapshot_id);

  const rowContractValid = Boolean(
    expectedAuthority && knownContractVersions.has(expectedVersion) &&
    authority === expectedAuthority && knownContractVersions.has(version) &&
    /^[a-f0-9]{64}$/i.test(hash) && snapshotId.length > 0 &&
    finalStake !== null && finalStake >= 0
  );

  if (!rowContractValid) {
    return {
      version: VERSION,
      locked: false,
      rowContractValid: false,
      snapshotVerified: false,
      reason: 'NO_VALID_PATCH46_FINAL_CONTRACT',
      finalStake,
      authority,
      contractVersion: version,
      contractHash: hash || null,
      snapshotId: snapshotId || null
    };
  }

  const requireSnapshot = options.requireSnapshot === true;
  const snapshot = options.snapshot || null;
  let snapshotVerified = false;
  let snapshotReason = 'SNAPSHOT_NOT_CHECKED';
  if (snapshot) {
    const betIdMatches = row.id == null || Number(snapshot.bet_id) === Number(row.id);
    const columnsVerified = Boolean(
      betIdMatches &&
      text(snapshot.snapshot_id) === snapshotId &&
      text(snapshot.contract_hash) === hash &&
      text(snapshot.contract_version) === version &&
      text(snapshot.final_authority) === authority &&
      sameNumber(snapshot.final_executable_stake, finalStake)
    );
    const payloadCheck = columnsVerified ? verifySnapshotPayload(snapshot, row, contractApi) : { ok: false, reason: 'PATCH46_SNAPSHOT_COLUMN_MISMATCH' };
    snapshotVerified = columnsVerified && payloadCheck.ok;
    snapshotReason = snapshotVerified ? 'PATCH46_APPEND_ONLY_SNAPSHOT_VERIFIED' : payloadCheck.reason;
  } else if (requireSnapshot) {
    snapshotReason = 'PATCH46_SNAPSHOT_NOT_FOUND';
  }

  const locked = rowContractValid && (!requireSnapshot || snapshotVerified);
  return {
    version: VERSION,
    locked,
    rowContractValid,
    snapshotVerified,
    reason: locked ? 'PATCH46_FINAL_CONTRACT_ACTIVE' : snapshotReason,
    finalStake,
    authority,
    contractVersion: version,
    contractHash: hash,
    snapshotId
  };
}

function applyFinalStakeLock(bet = {}, lock = {}) {
  if (!lock?.locked) return { ...(bet || {}) };
  const finalStake = number(lock.finalStake);
  if (finalStake === null || finalStake < 0) return { ...(bet || {}) };
  const out = {
    ...(bet || {}),
    stake: finalStake,
    invested: finalStake.toFixed(2)
  };
  if (bet?.stakePolicy && typeof bet.stakePolicy === 'object') {
    out.stakePolicy = { ...bet.stakePolicy, finalStake };
  }
  if (bet?.stakePolicyApplied && typeof bet.stakePolicyApplied === 'object') {
    out.stakePolicyApplied = { ...bet.stakePolicyApplied, stake: finalStake };
  }
  return out;
}

function incomingStake(bet = {}) {
  for (const value of [bet?.invested, bet?.stake, bet?.stakePolicy?.finalStake, bet?.stakePolicyApplied?.stake]) {
    const n = number(value);
    if (n !== null) return n;
  }
  return null;
}

function changedIncomingStake(bet = {}, lock = {}) {
  if (!lock?.locked) return false;
  const incoming = incomingStake(bet);
  const finalStake = number(lock.finalStake);
  if (finalStake === null) return false;
  return incoming === null || Math.abs(incoming - finalStake) > EPSILON;
}

function expectedUiScopeFromStake(value) {
  const stake = number(value);
  if (stake === null || stake < 0) return 'INVALID';
  return stake === 0 ? 'STUDIO' : 'TRADING';
}

module.exports = {
  VERSION,
  EPSILON,
  number,
  sameNumber,
  verifySnapshotPayload,
  inspectFinalStakeLock,
  applyFinalStakeLock,
  incomingStake,
  changedIncomingStake,
  expectedUiScopeFromStake
};
