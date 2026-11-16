'use strict';

const crypto = require('crypto');
const tennisPredictionSnapshots = require('./tennisPredictionSnapshots');
const runtimeDiagnostics = require('./runtimeDiagnostics');

const TENNIS_FORWARD_COHORT_VERSION = 'TENNIS_FORWARD_COHORT_V1_PATCH9';
const TENNIS_FORWARD_COHORT_TEMPORAL_REVISION = 'AUDIT16D_R3_T6_CLV_TEMPORAL_SCOPE_SEPARATION_V1';
const TENNIS_FORWARD_COHORT_TABLE = 'tennis_forward_cohorts';
const TENNIS_FORWARD_COHORT_MEMBER_TABLE = 'tennis_forward_cohort_members';
const DEFAULT_HOLDOUT_PERCENT = 20;

const COHORT_ROLES = Object.freeze({
  DEVELOPMENT: 'DEVELOPMENT',
  HOLDOUT: 'HOLDOUT'
});

const MATURITY_STATES = Object.freeze({
  OBSERVATION_PENDING: 'OBSERVATION_PENDING',
  SETTLEMENT_PENDING: 'SETTLEMENT_PENDING',
  CLV_PENDING: 'CLV_PENDING',
  MATURED_SETTLEMENT_ONLY: 'MATURED_SETTLEMENT_ONLY',
  MATURED_WITH_CLV: 'MATURED_WITH_CLV',
  QUARANTINED: 'QUARANTINED',
  TEMPORAL_LEAKAGE_BLOCKED: 'TEMPORAL_LEAKAGE_BLOCKED',
  SUPERSEDED: 'SUPERSEDED'
});

const LEAKAGE_STATES = Object.freeze({
  CLEAR: 'CLEAR',
  REVIEW: 'REVIEW',
  BLOCKED: 'BLOCKED'
});

const COHORT_SCHEMA = Object.freeze([
  ['cohort_id', 'TEXT PRIMARY KEY'],
  ['cohort_version', 'TEXT NOT NULL'],
  ['window_start', 'TEXT NOT NULL'],
  ['window_end', 'TEXT NOT NULL'],
  ['cohort_role', 'TEXT NOT NULL'],
  ['holdout_percent', 'INTEGER NOT NULL'],
  ['sealed_at', 'TEXT NOT NULL'],
  ['created_at', 'TEXT NOT NULL'],
  ['operation_id', 'TEXT'],
  ['member_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['cohort_hash', 'TEXT NOT NULL']
]);

const MEMBER_SCHEMA = Object.freeze([
  ['bet_id', 'INTEGER PRIMARY KEY'],
  ['cohort_id', 'TEXT NOT NULL'],
  ['cohort_version', 'TEXT NOT NULL'],
  ['cohort_role', 'TEXT NOT NULL'],
  ['holdout_locked', 'INTEGER NOT NULL DEFAULT 0'],
  ['snapshot_id', 'TEXT NOT NULL'],
  ['snapshot_hash', 'TEXT NOT NULL'],
  ['captured_at', 'TEXT NOT NULL'],
  ['match_start_at', 'TEXT NOT NULL'],
  ['event_fingerprint', 'TEXT NOT NULL'],
  ['market_fingerprint', 'TEXT NOT NULL'],
  ['maturity_status', 'TEXT NOT NULL'],
  ['settlement_eligible', 'INTEGER NOT NULL DEFAULT 0'],
  ['clv_eligible', 'INTEGER NOT NULL DEFAULT 0'],
  ['leakage_status', 'TEXT NOT NULL'],
  ['exclusion_reasons', 'TEXT NOT NULL'],
  ['sealed_at', 'TEXT NOT NULL'],
  ['evaluated_at', 'TEXT NOT NULL'],
  ['operation_id', 'TEXT'],
  ['seal_hash', 'TEXT NOT NULL UNIQUE'],
  ['state_hash', 'TEXT NOT NULL']
]);

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function uniq(values) { return [...new Set((values || []).map(text).filter(Boolean))]; }
function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
  return value;
}
function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stableObject(value))).digest('hex');
}
function parseEpoch(value) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table));
}
function getTableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}
function additiveType(type) {
  return type.replace(/\s+PRIMARY KEY.*/i, '').replace(/\s+NOT NULL/ig, '').replace(/\s+DEFAULT\s+[^\s]+/ig, '').trim() || 'TEXT';
}
function ensureColumns(db, table, schema) {
  const columns = getTableColumns(db, table);
  for (const [name, type] of schema) {
    if (columns.has(name) || /PRIMARY KEY/i.test(type)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${additiveType(type)}`);
  }
}
function ensureForwardCohortSchema(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new Error('PATCH9_DB_ADAPTER_REQUIRED');
  db.exec(`CREATE TABLE IF NOT EXISTS ${TENNIS_FORWARD_COHORT_TABLE} (${COHORT_SCHEMA.map(([name, type]) => `${name} ${type}`).join(', ')})`);
  db.exec(`CREATE TABLE IF NOT EXISTS ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} (${MEMBER_SCHEMA.map(([name, type]) => `${name} ${type}`).join(', ')})`);
  ensureColumns(db, TENNIS_FORWARD_COHORT_TABLE, COHORT_SCHEMA);
  ensureColumns(db, TENNIS_FORWARD_COHORT_MEMBER_TABLE, MEMBER_SCHEMA);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${TENNIS_FORWARD_COHORT_MEMBER_TABLE}_cohort ON ${TENNIS_FORWARD_COHORT_MEMBER_TABLE}(cohort_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${TENNIS_FORWARD_COHORT_MEMBER_TABLE}_maturity ON ${TENNIS_FORWARD_COHORT_MEMBER_TABLE}(maturity_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${TENNIS_FORWARD_COHORT_MEMBER_TABLE}_leakage ON ${TENNIS_FORWARD_COHORT_MEMBER_TABLE}(leakage_status)`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_patch9_cohort_member_no_delete BEFORE DELETE ON ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} BEGIN SELECT RAISE(ABORT, 'PATCH9_COHORT_MEMBER_DELETE_FORBIDDEN'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_patch9_cohort_member_seal_immutable BEFORE UPDATE OF bet_id, cohort_id, cohort_version, cohort_role, holdout_locked, snapshot_id, snapshot_hash, captured_at, match_start_at, event_fingerprint, market_fingerprint, sealed_at, seal_hash ON ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} BEGIN SELECT RAISE(ABORT, 'PATCH9_COHORT_SEAL_IMMUTABLE'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_patch9_cohort_identity_immutable BEFORE UPDATE OF cohort_id, cohort_version, window_start, window_end, cohort_role, holdout_percent, sealed_at, created_at, cohort_hash ON ${TENNIS_FORWARD_COHORT_TABLE} BEGIN SELECT RAISE(ABORT, 'PATCH9_COHORT_IDENTITY_IMMUTABLE'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_patch9_cohort_no_delete BEFORE DELETE ON ${TENNIS_FORWARD_COHORT_TABLE} BEGIN SELECT RAISE(ABORT, 'PATCH9_COHORT_DELETE_FORBIDDEN'); END;`);
  return { cohortTable: TENNIS_FORWARD_COHORT_TABLE, memberTable: TENNIS_FORWARD_COHORT_MEMBER_TABLE };
}
function assertForwardCohortSchema(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('PATCH9_DB_ADAPTER_REQUIRED');
  if (!tableExists(db, TENNIS_FORWARD_COHORT_TABLE)) throw new Error('PATCH9_COHORT_TABLE_MISSING');
  if (!tableExists(db, TENNIS_FORWARD_COHORT_MEMBER_TABLE)) throw new Error('PATCH9_COHORT_MEMBER_TABLE_MISSING');
  return true;
}
function monthWindow(capturedAt) {
  const epoch = parseEpoch(capturedAt);
  if (epoch == null) throw new Error('PATCH9_CAPTURED_AT_INVALID');
  const date = new Date(epoch);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    label: `${year}${String(month + 1).padStart(2, '0')}`,
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0)).toISOString(),
    end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0)).toISOString()
  };
}
function roleFromSnapshotHash(snapshotHash, holdoutPercent = DEFAULT_HOLDOUT_PERCENT) {
  const safePercent = Math.max(0, Math.min(50, Number(holdoutPercent) || DEFAULT_HOLDOUT_PERCENT));
  const hash = text(snapshotHash);
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('PATCH9_SNAPSHOT_HASH_INVALID');
  const bucket = parseInt(hash.slice(0, 8), 16) % 100;
  return bucket < safePercent ? COHORT_ROLES.HOLDOUT : COHORT_ROLES.DEVELOPMENT;
}
function buildCohortIdentity(anchor, options = {}) {
  const holdoutPercent = Math.max(0, Math.min(50, Number(options.holdoutPercent) || DEFAULT_HOLDOUT_PERCENT));
  const window = monthWindow(anchor.captured_at);
  const role = roleFromSnapshotHash(anchor.snapshot_hash, holdoutPercent);
  const cohortId = `TFC9_${window.label}_${role}`;
  return { cohortId, role, holdoutPercent, windowStart: window.start, windowEnd: window.end };
}
function buildSealMaterial(member) {
  return {
    bet_id: Number(member.bet_id), cohort_id: member.cohort_id, cohort_version: member.cohort_version,
    cohort_role: member.cohort_role, holdout_locked: Number(member.holdout_locked || 0),
    snapshot_id: member.snapshot_id, snapshot_hash: member.snapshot_hash,
    captured_at: member.captured_at, match_start_at: member.match_start_at,
    event_fingerprint: member.event_fingerprint, market_fingerprint: member.market_fingerprint,
    sealed_at: member.sealed_at
  };
}
function buildStateMaterial(member) {
  return {
    seal_hash: member.seal_hash, maturity_status: member.maturity_status,
    settlement_eligible: Number(member.settlement_eligible || 0), clv_eligible: Number(member.clv_eligible || 0),
    leakage_status: member.leakage_status, exclusion_reasons: JSON.parse(member.exclusion_reasons || '[]'),
    evaluated_at: member.evaluated_at
  };
}
function getAnchor(db, betId) {
  if (!tableExists(db, tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE)) return null;
  return db.prepare(`SELECT * FROM ${tennisPredictionSnapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE} WHERE bet_id=? AND is_calibration_anchor=1 ORDER BY snapshot_sequence LIMIT 1`).get(Number(betId)) || null;
}
function loadSource(db, betId) {
  return db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(Number(betId)) || null;
}
function resolveEffectiveMatchStart(source = {}, anchor = {}) {
  const anchorEpoch = parseEpoch(anchor.match_start_at);
  const currentEpoch = parseEpoch(source.canonical_match_datetime || source.match_start_at || source.match_date || source.commence_time);
  const anchorFingerprint = text(anchor.event_fingerprint);
  const currentFingerprint = text(source.tennis_event_fingerprint || source.event_fingerprint);
  const sameEvent = !anchorFingerprint || !currentFingerprint || anchorFingerprint === currentFingerprint;
  const useCurrent = sameEvent && currentEpoch != null;
  const effectiveEpoch = useCurrent ? currentEpoch : anchorEpoch;
  let status = 'ANCHOR_TIME';
  if (useCurrent && anchorEpoch != null && currentEpoch > anchorEpoch) status = 'RESCHEDULED_LATER';
  else if (useCurrent && anchorEpoch != null && currentEpoch < anchorEpoch) status = 'RESCHEDULED_EARLIER';
  else if (useCurrent) status = 'CURRENT_CANONICAL_TIME';
  return {
    anchorEpoch,
    currentEpoch,
    effectiveEpoch,
    sameEvent,
    status,
    changed: anchorEpoch != null && effectiveEpoch != null && anchorEpoch !== effectiveEpoch,
    anchorIso: anchorEpoch == null ? null : new Date(anchorEpoch).toISOString(),
    currentIso: currentEpoch == null ? null : new Date(currentEpoch).toISOString(),
    effectiveIso: effectiveEpoch == null ? null : new Date(effectiveEpoch).toISOString()
  };
}

function temporalAssessment(source = {}, anchor = {}, options = {}) {
  const reasons = [];
  const blocking = [];
  const review = [];
  const captured = parseEpoch(anchor.captured_at);
  const matchTime = resolveEffectiveMatchStart(source, anchor);
  const start = matchTime.effectiveEpoch;
  if (upper(anchor.snapshot_type) !== 'ORIGINAL') blocking.push('ANCHOR_NOT_ORIGINAL');
  if (upper(anchor.snapshot_status) !== 'VALID_PREMATCH' || Number(anchor.is_calibration_anchor || 0) !== 1) blocking.push('ANCHOR_NOT_VALID_PREMATCH');
  if (captured == null || start == null) blocking.push('ANCHOR_TIMESTAMPS_INVALID');
  else if (captured >= start) blocking.push('SNAPSHOT_NOT_BEFORE_MATCH_START');
  if (!text(anchor.event_fingerprint) || !text(anchor.market_fingerprint)) blocking.push('ANCHOR_FINGERPRINT_MISSING');

  // AUDIT16D_R3_T6_CLV_TEMPORAL_SCOPE_SEPARATION_V1
  // Un CLV marcato VERIFIED ma privo di closing timestamp non dimostra leakage:
  // dimostra soltanto che il CLV non è temporalmente certificabile. Non deve
  // quindi invalidare settlement/coorte; resta escluso solo dall'autorità CLV.
  const clvReview = [];
  let clvTemporalVerified = false;
  if (upper(source.clv_contract_status) === 'VERIFIED') {
    const closing = parseEpoch(source.clv_closing_ts);
    const opening = parseEpoch(source.clv_opening_ts) ?? captured;
    const clvBlocking = [];
    if (closing == null) {
      clvReview.push('CLV_CLOSING_TIMESTAMP_MISSING_UNVERIFIED');
    } else {
      if (start != null && closing > start) clvBlocking.push('CLV_CAPTURED_AFTER_MATCH_START');
      if (opening != null && closing <= opening) clvBlocking.push('CLV_NOT_AFTER_OPENING');
      if (text(source.clv_event_fingerprint) && text(source.clv_event_fingerprint) !== text(anchor.event_fingerprint)) clvBlocking.push('CLV_EVENT_FINGERPRINT_MISMATCH');
      if (text(source.clv_market_fingerprint) && text(source.clv_market_fingerprint) !== text(anchor.market_fingerprint)) clvBlocking.push('CLV_MARKET_FINGERPRINT_MISMATCH');
      clvTemporalVerified = start != null && opening != null && clvBlocking.length === 0;
    }
    blocking.push(...clvBlocking);
  }

  if (upper(source.settlement_contract_status) === 'VERIFIED') {
    const observed = parseEpoch(source.settlement_observed_at || source.settled_at);
    if (observed == null) review.push('SETTLEMENT_TIMESTAMP_INVALID');
    else if (start != null && observed < start) blocking.push('SETTLEMENT_BEFORE_MATCH_START');
    if (text(source.settlement_event_fingerprint) && text(source.settlement_event_fingerprint) !== text(anchor.event_fingerprint)) blocking.push('SETTLEMENT_EVENT_FINGERPRINT_MISMATCH');
    if (text(source.settlement_market_fingerprint) && text(source.settlement_market_fingerprint) !== text(anchor.market_fingerprint)) blocking.push('SETTLEMENT_MARKET_FINGERPRINT_MISMATCH');
  }

  if (['CONFLICT', 'REJECTED', 'MANUAL_REVIEW'].includes(upper(source.settlement_contract_status))) review.push(`SETTLEMENT_${upper(source.settlement_contract_status)}`);
  if (upper(source.clv_contract_status) === 'CONFLICT') review.push('CLV_CONFLICT');
  reasons.push(...blocking, ...review, ...clvReview);
  return {
    leakageStatus: blocking.length ? LEAKAGE_STATES.BLOCKED : (review.length ? LEAKAGE_STATES.REVIEW : LEAKAGE_STATES.CLEAR),
    blocking: uniq(blocking),
    review: uniq(review),
    clvReview: uniq(clvReview),
    clvTemporalVerified,
    reasons: uniq(reasons),
    capturedEpoch: captured,
    startEpoch: start,
    matchTime,
    settlementEvidenceState: upper(source.settlement_contract_status) === 'PROPOSED' ? 'PENDING_VERIFICATION' : upper(source.settlement_contract_status)
  };
}
function deriveMaturity(source = {}, anchor = {}, options = {}) {
  const temporal = temporalAssessment(source, anchor, options);
  const nowEpoch = parseEpoch(options.evaluatedAt || new Date().toISOString()) ?? Date.now();
  const status = upper(source.status);
  const settlementStatus = upper(source.settlement_contract_status);
  const clvStatus = upper(source.clv_contract_status);
  const settlementVerified = settlementStatus === 'VERIFIED' && ['WON', 'LOST'].includes(status);
  const clvVerified = clvStatus === 'VERIFIED' && temporal.clvTemporalVerified === true;
  const clvTimestampUnverifiable = clvStatus === 'VERIFIED'
    && Array.isArray(temporal.clvReview)
    && temporal.clvReview.includes('CLV_CLOSING_TIMESTAMP_MISSING_UNVERIFIED');
  let maturityStatus;
  const superseded = Number(source.paper_result_active) === 0 && upper(source.paper_result_dedup_reason).includes('RESCHEDULE_SUPERSEDED');
  if (superseded) maturityStatus = MATURITY_STATES.SUPERSEDED;
  else if (temporal.leakageStatus === LEAKAGE_STATES.BLOCKED) maturityStatus = MATURITY_STATES.TEMPORAL_LEAKAGE_BLOCKED;
  else if (temporal.leakageStatus === LEAKAGE_STATES.REVIEW) maturityStatus = MATURITY_STATES.QUARANTINED;
  else if (temporal.startEpoch != null && nowEpoch < temporal.startEpoch) maturityStatus = MATURITY_STATES.OBSERVATION_PENDING;
  else if (!settlementVerified) maturityStatus = MATURITY_STATES.SETTLEMENT_PENDING;
  else if (clvVerified) maturityStatus = MATURITY_STATES.MATURED_WITH_CLV;
  else if (clvTimestampUnverifiable || ['UNAVAILABLE', 'UNVERIFIED', 'AVAILABLE_UNVERIFIED', 'CONFLICT'].includes(clvStatus)) maturityStatus = MATURITY_STATES.MATURED_SETTLEMENT_ONLY;
  else maturityStatus = MATURITY_STATES.CLV_PENDING;
  return {
    maturityStatus,
    settlementEligible: !superseded && settlementVerified && temporal.leakageStatus === LEAKAGE_STATES.CLEAR ? 1 : 0,
    clvEligible: !superseded && settlementVerified && clvVerified && temporal.leakageStatus === LEAKAGE_STATES.CLEAR ? 1 : 0,
    leakageStatus: temporal.leakageStatus,
    reasons: temporal.reasons,
    temporal
  };
}
function ensureCohortRow(db, identity, options = {}) {
  const now = options.sealedAt || new Date().toISOString();
  const existing = db.prepare(`SELECT * FROM ${TENNIS_FORWARD_COHORT_TABLE} WHERE cohort_id=?`).get(identity.cohortId);
  const material = {
    cohort_id: identity.cohortId, cohort_version: TENNIS_FORWARD_COHORT_VERSION,
    window_start: identity.windowStart, window_end: identity.windowEnd,
    cohort_role: identity.role, holdout_percent: identity.holdoutPercent, sealed_at: now
  };
  const cohortHash = sha256(material);
  if (existing) {
    if (existing.cohort_hash !== cohortHash && existing.cohort_hash !== sha256({ ...material, sealed_at: existing.sealed_at })) throw new Error(`PATCH9_COHORT_IDENTITY_CONFLICT:${identity.cohortId}`);
    return existing;
  }
  const row = { ...material, created_at: now, operation_id: options.operationId || null, member_count: 0, cohort_hash: cohortHash };
  const names = COHORT_SCHEMA.map(([name]) => name);
  db.prepare(`INSERT INTO ${TENNIS_FORWARD_COHORT_TABLE} (${names.join(',')}) VALUES (${names.map(name => `@${name}`).join(',')})`).run(row);
  return row;
}
function refreshCohortCount(db, cohortId) {
  const count = Number(db.prepare(`SELECT COUNT(*) count FROM ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} WHERE cohort_id=?`).get(cohortId).count || 0);
  db.prepare(`UPDATE ${TENNIS_FORWARD_COHORT_TABLE} SET member_count=? WHERE cohort_id=?`).run(count, cohortId);
  return count;
}
function assignForwardCohortMember(db, betId, options = {}) {
  ensureForwardCohortSchema(db);
  const numericBetId = Number(betId);
  if (!(numericBetId > 0)) throw new Error('PATCH9_COHORT_BET_ID_INVALID');
  const source = loadSource(db, numericBetId);
  if (!source) return { assigned: false, reason: 'SOURCE_BET_NOT_FOUND', betId: numericBetId };
  const anchor = options.anchor || getAnchor(db, numericBetId);
  if (!anchor) return { assigned: false, reason: 'FORWARD_ANCHOR_NOT_FOUND', betId: numericBetId };
  const existing = db.prepare(`SELECT * FROM ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} WHERE bet_id=?`).get(numericBetId);
  if (existing) {
    if (existing.snapshot_id !== anchor.snapshot_id || existing.snapshot_hash !== anchor.snapshot_hash) throw new Error(`PATCH9_SEALED_MEMBER_ANCHOR_CONFLICT:${numericBetId}`);
    return refreshForwardCohortMaturity(db, numericBetId, options);
  }
  const identity = buildCohortIdentity(anchor, options);
  ensureCohortRow(db, identity, options);
  const now = options.evaluatedAt || new Date().toISOString();
  const maturity = deriveMaturity(source, anchor, { ...options, evaluatedAt: now });
  const row = {
    bet_id: numericBetId, cohort_id: identity.cohortId, cohort_version: TENNIS_FORWARD_COHORT_VERSION,
    cohort_role: identity.role, holdout_locked: identity.role === COHORT_ROLES.HOLDOUT ? 1 : 0,
    snapshot_id: anchor.snapshot_id, snapshot_hash: anchor.snapshot_hash,
    captured_at: anchor.captured_at, match_start_at: anchor.match_start_at,
    event_fingerprint: anchor.event_fingerprint, market_fingerprint: anchor.market_fingerprint,
    maturity_status: maturity.maturityStatus, settlement_eligible: maturity.settlementEligible,
    clv_eligible: maturity.clvEligible, leakage_status: maturity.leakageStatus,
    exclusion_reasons: JSON.stringify(maturity.reasons), sealed_at: now, evaluated_at: now,
    operation_id: options.operationId || null
  };
  row.seal_hash = sha256(buildSealMaterial(row));
  row.state_hash = sha256(buildStateMaterial(row));
  const names = MEMBER_SCHEMA.map(([name]) => name);
  db.prepare(`INSERT INTO ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} (${names.join(',')}) VALUES (${names.map(name => `@${name}`).join(',')})`).run(row);
  const memberCount = refreshCohortCount(db, identity.cohortId);
  runtimeDiagnostics.writeDiagnostic({
    level: maturity.leakageStatus === LEAKAGE_STATES.BLOCKED ? 'ERROR' : 'INFO',
    component: 'TENNIS_FORWARD_COHORT', operation: 'COHORT_ASSIGN', operationId: options.operationId || null,
    phase: 'COHORT_MEMBER_SEALED', event: maturity.leakageStatus === LEAKAGE_STATES.BLOCKED ? 'TEMPORAL_LEAKAGE_BLOCKED' : 'COHORT_MEMBER_SEALED',
    message: `Cohort ${identity.cohortId} assegnata e sigillata per bet ${numericBetId}.`,
    context: { betId: numericBetId, cohortId: identity.cohortId, role: identity.role, maturityStatus: maturity.maturityStatus, leakageStatus: maturity.leakageStatus }
  });
  return { assigned: true, inserted: true, betId: numericBetId, member: row, memberCount, maturity };
}
function refreshForwardCohortMaturity(db, betId, options = {}) {
  ensureForwardCohortSchema(db);
  const numericBetId = Number(betId);
  const source = loadSource(db, numericBetId);
  if (!source) return { assigned: false, updated: false, reason: 'SOURCE_BET_NOT_FOUND', betId: numericBetId };
  const anchor = options.anchor || getAnchor(db, numericBetId);
  if (!anchor) return { assigned: false, updated: false, reason: 'FORWARD_ANCHOR_NOT_FOUND', betId: numericBetId };
  let member = db.prepare(`SELECT * FROM ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} WHERE bet_id=?`).get(numericBetId);
  if (!member) return assignForwardCohortMember(db, numericBetId, { ...options, anchor });
  const expectedSeal = sha256(buildSealMaterial(member));
  if (member.seal_hash !== expectedSeal) throw new Error(`PATCH9_COHORT_SEAL_HASH_MISMATCH:${numericBetId}`);
  if (member.snapshot_id !== anchor.snapshot_id || member.snapshot_hash !== anchor.snapshot_hash) throw new Error(`PATCH9_SEALED_MEMBER_ANCHOR_CONFLICT:${numericBetId}`);
  const now = options.evaluatedAt || new Date().toISOString();
  const maturity = deriveMaturity(source, anchor, { ...options, evaluatedAt: now });
  const next = {
    ...member,
    maturity_status: maturity.maturityStatus,
    settlement_eligible: maturity.settlementEligible,
    clv_eligible: maturity.clvEligible,
    leakage_status: maturity.leakageStatus,
    exclusion_reasons: JSON.stringify(maturity.reasons),
    evaluated_at: now,
    operation_id: options.operationId || member.operation_id || null
  };
  next.state_hash = sha256(buildStateMaterial(next));
  db.prepare(`UPDATE ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} SET maturity_status=@maturity_status, settlement_eligible=@settlement_eligible, clv_eligible=@clv_eligible, leakage_status=@leakage_status, exclusion_reasons=@exclusion_reasons, evaluated_at=@evaluated_at, operation_id=@operation_id, state_hash=@state_hash WHERE bet_id=@bet_id`).run({
    bet_id: next.bet_id,
    maturity_status: next.maturity_status,
    settlement_eligible: next.settlement_eligible,
    clv_eligible: next.clv_eligible,
    leakage_status: next.leakage_status,
    exclusion_reasons: next.exclusion_reasons,
    evaluated_at: next.evaluated_at,
    operation_id: next.operation_id,
    state_hash: next.state_hash
  });
  return { assigned: true, updated: true, inserted: false, betId: numericBetId, member: next, maturity };
}
function inspectForwardCohortMember(db, betId, options = {}) {
  assertForwardCohortSchema(db);
  const numericBetId = Number(betId);
  const member = db.prepare(`SELECT * FROM ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} WHERE bet_id=?`).get(numericBetId) || null;
  if (!member) return { success: true, tracked: false, betId: numericBetId, reasons: ['NO_FORWARD_COHORT_MEMBER'] };
  const source = loadSource(db, numericBetId);
  const anchor = getAnchor(db, numericBetId);
  const sealValid = member.seal_hash === sha256(buildSealMaterial(member));
  const maturity = source && anchor ? deriveMaturity(source, anchor, { ...options, evaluatedAt: options.evaluatedAt || new Date().toISOString() }) : null;
  const currentStateHash = sha256(buildStateMaterial(member));
  const stateHashValid = member.state_hash === currentStateHash;
  const expectedMatches = maturity ? (
    member.maturity_status === maturity.maturityStatus &&
    Number(member.settlement_eligible || 0) === maturity.settlementEligible &&
    Number(member.clv_eligible || 0) === maturity.clvEligible &&
    member.leakage_status === maturity.leakageStatus &&
    JSON.stringify(uniq(JSON.parse(member.exclusion_reasons || '[]')).sort()) === JSON.stringify(uniq(maturity.reasons).sort())
  ) : false;
  const reasons = [];
  if (!source) reasons.push('SOURCE_BET_NOT_FOUND');
  if (!anchor) reasons.push('FORWARD_ANCHOR_NOT_FOUND');
  if (!sealValid) reasons.push('COHORT_SEAL_HASH_INVALID');
  if (!stateHashValid) reasons.push('COHORT_STATE_HASH_INVALID');
  if (maturity && !expectedMatches) reasons.push('COHORT_MATURITY_STALE');
  return { success: reasons.length === 0, tracked: true, betId: numericBetId, reasons, sealValid, stateHashValid, expectedMatches, member, expectedMaturity: maturity };
}
function reconcileForwardCohortMaturity(db, options = {}) {
  assertForwardCohortSchema(db);
  const evaluatedAt = options.evaluatedAt || new Date().toISOString();
  const operationId = options.operationId || `PATCH27_COHORT_RECONCILE_${Date.now()}`;
  const rows = db.prepare(`SELECT bet_id FROM ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} ORDER BY bet_id`).all();
  const result = { success: true, evaluatedAt, operationId, scanned: rows.length, updated: 0, unchanged: 0, blocked: 0, errors: [] };
  const transaction = db.transaction(() => {
    for (const row of rows) {
      try {
        const inspected = inspectForwardCohortMember(db, row.bet_id, { evaluatedAt });
        const staleOnly = inspected.reasons?.length === 1 && inspected.reasons[0] === 'COHORT_MATURITY_STALE';
        if (staleOnly && inspected.sealValid && inspected.stateHashValid) {
          refreshForwardCohortMaturity(db, row.bet_id, { evaluatedAt, operationId });
          result.updated += 1;
        } else if (inspected.success) {
          result.unchanged += 1;
        } else {
          result.blocked += 1;
          result.errors.push({ betId: row.bet_id, reasons: inspected.reasons || [] });
        }
      } catch (error) {
        result.blocked += 1;
        result.errors.push({ betId: row.bet_id, reasons: [error.message || String(error)] });
      }
    }
  });
  transaction();
  result.after = scanForwardCohorts(db, { evaluatedAt, limit: options.limit || 50 });
  result.healthy = result.after.healthy;
  return result;
}

function isPatch47TerminalClvState(db, betId) {
  try {
    const row = db.prepare('SELECT clv_degraded_state FROM ai_forward_test WHERE id=?').get(Number(betId));
    return ['IRRECOVERABLE_TEMPORAL','IRRECOVERABLE_MARKET','MAX_ATTEMPTS_EXHAUSTED','MANUAL_REVIEW'].includes(String(row?.clv_degraded_state || '').toUpperCase());
  } catch (_) { return false; }
}
function scanForwardCohorts(db, options = {}) {
  assertForwardCohortSchema(db);
  const limit = Math.max(1, Math.min(2000, Number(options.limit || 50)));
  const members = Number(options.betId) > 0
    ? db.prepare(`SELECT * FROM ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} WHERE bet_id=?`).all(Number(options.betId))
    : db.prepare(`SELECT * FROM ${TENNIS_FORWARD_COHORT_MEMBER_TABLE} ORDER BY bet_id DESC`).all();
  const details = members.map(member => inspectForwardCohortMember(db, member.bet_id, options));
  const counts = Object.fromEntries(Object.values(MATURITY_STATES).map(state => [state, 0]));
  const roleCounts = { [COHORT_ROLES.DEVELOPMENT]: 0, [COHORT_ROLES.HOLDOUT]: 0 };
  let leakageBlocked = 0;
  let expectedTemporalExclusions = 0;
  let activeLeakageFaults = 0;
  for (const detail of details) {
    const member = detail.member;
    if (!member) continue;
    counts[member.maturity_status] = Number(counts[member.maturity_status] || 0) + 1;
    roleCounts[member.cohort_role] = Number(roleCounts[member.cohort_role] || 0) + 1;
    if (member.leakage_status === LEAKAGE_STATES.BLOCKED) {
      leakageBlocked += 1;
      let exclusionReasons = [];
      try { exclusionReasons = JSON.parse(member.exclusion_reasons || '[]'); } catch (_) {}
      const expectedReason = exclusionReasons.length > 0 && exclusionReasons.every(reason => ['SNAPSHOT_NOT_BEFORE_MATCH_START','CLV_CLOSING_TIMESTAMP_INVALID','SETTLEMENT_BEFORE_MATCH_START'].includes(reason));
      const expected = detail.success === true && detail.sealValid === true && detail.stateHashValid === true && detail.expectedMatches === true
        && member.maturity_status === MATURITY_STATES.TEMPORAL_LEAKAGE_BLOCKED
        && (expectedReason || isPatch47TerminalClvState(db, member.bet_id));
      if (expected) expectedTemporalExclusions += 1; else activeLeakageFaults += 1;
    }
  }
  const cohortRows = db.prepare(`SELECT * FROM ${TENNIS_FORWARD_COHORT_TABLE} ORDER BY window_start DESC, cohort_role`).all();
  const unhealthy = details.filter(detail => !detail.success);
  return {
    success: true,
    healthy: unhealthy.length === 0 && activeLeakageFaults === 0,
    pipelineAvailable: unhealthy.length === 0 && activeLeakageFaults === 0,
    expectedTemporalExclusions,
    activeLeakageFaults,
    version: TENNIS_FORWARD_COHORT_VERSION,
    mode: 'FORWARD_ONLY_SHADOW_COHORTS',
    trackedMembers: members.length,
    healthyMembers: members.length - unhealthy.length,
    unhealthyMembers: unhealthy.length,
    leakageBlocked,
    expectedTemporalExclusions,
    activeLeakageFaults,
    holdoutLocked: Number(roleCounts[COHORT_ROLES.HOLDOUT] || 0),
    developmentMembers: Number(roleCounts[COHORT_ROLES.DEVELOPMENT] || 0),
    counts,
    roleCounts,
    cohorts: cohortRows,
    details: details.filter(detail => !detail.success || detail.member?.leakage_status !== LEAKAGE_STATES.CLEAR).slice(0, limit),
    note: activeLeakageFaults > 0 ? `${activeLeakageFaults} anomalie di coorte attive richiedono intervento.` : unhealthy.length > 0 ? `${unhealthy.length} stati derivati richiedono riallineamento; le esclusioni temporali attese restano corrette.` : expectedTemporalExclusions > 0 ? `Pipeline disponibile: ${expectedTemporalExclusions} record storici sono esclusi correttamente per leakage e restano auditabili.` : members.length ? 'Coorti forward sigillate; membership immutabile e maturità ricalcolabile senza leakage.' : 'Coorti pronte: il primo membro verrà sigillato con la prossima previsione Tennis valida pre-match.'
  };
}

module.exports = {
  TENNIS_FORWARD_COHORT_VERSION,
  TENNIS_FORWARD_COHORT_TEMPORAL_REVISION,
  TENNIS_FORWARD_COHORT_TABLE,
  TENNIS_FORWARD_COHORT_MEMBER_TABLE,
  DEFAULT_HOLDOUT_PERCENT,
  COHORT_ROLES,
  MATURITY_STATES,
  LEAKAGE_STATES,
  COHORT_SCHEMA,
  MEMBER_SCHEMA,
  stableObject,
  sha256,
  ensureForwardCohortSchema,
  assertForwardCohortSchema,
  monthWindow,
  roleFromSnapshotHash,
  buildCohortIdentity,
  buildSealMaterial,
  buildStateMaterial,
  resolveEffectiveMatchStart,
  temporalAssessment,
  deriveMaturity,
  assignForwardCohortMember,
  refreshForwardCohortMaturity,
  reconcileForwardCohortMaturity,
  inspectForwardCohortMember,
  scanForwardCohorts
};
