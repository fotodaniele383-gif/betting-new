'use strict';

const crypto = require('crypto');

const VERSION = 'AUDIT12_SETTLEMENT_RESOLUTION_EVIDENCE_GATE_V1';
const POLICY_VERSION = 'AUDIT12_OFFICIAL_EVIDENCE_ATOMIC_RESOLUTION_POLICY_V1';
const MODE = 'FAIL_CLOSED_OFFICIAL_EVIDENCE_BEFORE_EXCEPTION_RESOLUTION';

const AUTHORITY = Object.freeze({
  databaseMutation: false,
  probabilityMutation: false,
  stakeMutation: false,
  settlementMutation: false,
  schedulerMutation: false,
  automaticProductionActivation: false
});

const OFFICIAL_TIERS = new Set(['CERTIFIED', 'PROVIDER']);
const FINAL_STATUSES = new Set(['WON', 'LOST', 'VOID', 'PUSH']);

function text(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function ts(v) { const n = Date.parse(text(v)); return Number.isFinite(n) ? n : null; }
function sha(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function isSha256(v) { return /^[a-f0-9]{64}$/i.test(text(v)); }

function evaluateResolutionEvidence(row = {}, queueRow = {}, options = {}) {
  const reasons = [];
  const betId = Number(row.id || queueRow.bet_id || 0);
  const operationId = text(options.operationId || '');
  const status = upper(row.status);
  const contractStatus = upper(row.settlement_contract_status);
  const contractReason = upper(row.settlement_contract_reason);
  const source = text(row.settlement_source);
  const sourceTier = upper(row.settlement_source_tier);
  const sourceEventId = text(row.settlement_source_event_id);
  const observedAt = text(row.settlement_observed_at);
  const settledAt = text(row.settled_at);
  const eventStart = text(row.canonical_match_datetime || row.match_date);
  const eventFingerprint = text(row.settlement_event_fingerprint);
  const marketFingerprint = text(row.settlement_market_fingerprint);
  const canonicalEventFingerprint = text(row.tennis_event_fingerprint);
  const canonicalMarketFingerprint = text(row.tennis_market_fingerprint);
  const evidenceHash = text(row.settlement_evidence_hash);
  const settlementOperationId = text(row.settlement_operation_id);
  const manualActionRequired = Number(queueRow.manual_action_required || 0) === 1;
  const recoveryMode = upper(queueRow.recovery_mode);
  const queueStatus = upper(queueRow.status);

  if (!(betId > 0)) reasons.push('BET_ID_REQUIRED');
  if (upper(row.sport_type) !== 'TENNIS') reasons.push('SPORT_NOT_TENNIS');
  if (queueStatus !== 'OPEN') reasons.push('QUEUE_NOT_OPEN');
  if (Number(queueRow.bet_id || 0) !== betId) reasons.push('QUEUE_BET_ID_MISMATCH');
  if (manualActionRequired) reasons.push('MANUAL_ACTION_REQUIRED');
  if (recoveryMode && recoveryMode !== 'TARGETED_OFFICIAL_RESULT') reasons.push('RECOVERY_MODE_NOT_AUTOMATED_OFFICIAL');
  if (!FINAL_STATUSES.has(status)) reasons.push('SETTLEMENT_STATUS_NOT_FINAL');
  if (contractStatus !== 'VERIFIED') reasons.push('CONTRACT_NOT_VERIFIED');
  if (contractReason !== 'CONTRACT_OK') reasons.push('CONTRACT_REASON_NOT_OK');
  if (!OFFICIAL_TIERS.has(sourceTier)) reasons.push('SOURCE_TIER_NOT_OFFICIAL');
  if (!source || /UNKNOWN|PENDING|WEAK|MANUAL|FALLBACK|LEGACY/i.test(source)) reasons.push('SETTLEMENT_SOURCE_NOT_OFFICIAL');
  if (!sourceEventId) reasons.push('SOURCE_EVENT_ID_MISSING');
  if (!isSha256(evidenceHash)) reasons.push('EVIDENCE_HASH_INVALID');
  if (!eventFingerprint || !canonicalEventFingerprint || eventFingerprint !== canonicalEventFingerprint) reasons.push('EVENT_FINGERPRINT_MISMATCH');
  if (!marketFingerprint || !canonicalMarketFingerprint || marketFingerprint !== canonicalMarketFingerprint) reasons.push('MARKET_FINGERPRINT_MISMATCH');

  const eventTs = ts(eventStart);
  const observedTs = ts(observedAt);
  const settledTs = ts(settledAt);
  if (eventTs == null) reasons.push('EVENT_TIMESTAMP_MISSING');
  if (observedTs == null) reasons.push('OBSERVED_TIMESTAMP_MISSING');
  if (settledTs == null) reasons.push('SETTLED_TIMESTAMP_MISSING');
  if (eventTs != null && observedTs != null && observedTs < eventTs) reasons.push('EVIDENCE_BEFORE_EVENT_START');
  if (observedTs != null && settledTs != null && settledTs < observedTs) reasons.push('SETTLED_BEFORE_EVIDENCE_OBSERVED');

  if (operationId) {
    if (!settlementOperationId) reasons.push('SETTLEMENT_OPERATION_ID_MISSING');
    else if (settlementOperationId !== operationId) reasons.push('SETTLEMENT_OPERATION_ID_MISMATCH');
  }

  const proofMaterial = {
    version: VERSION,
    betId,
    queuePreviousEvidenceKey: text(queueRow.evidence_key),
    exceptionType: upper(queueRow.exception_type),
    recoveryMode,
    settlementStatus: status,
    contractStatus,
    contractReason,
    source: upper(source),
    sourceTier,
    sourceEventId: upper(sourceEventId),
    observedAt,
    settledAt,
    eventStart,
    settlementEvidenceHash: evidenceHash.toLowerCase(),
    eventFingerprint,
    marketFingerprint,
    settlementOperationId,
    requestedOperationId: operationId
  };
  const resolutionEvidenceHash = sha(stableJson(proofMaterial));

  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    ready: reasons.length === 0,
    failClosed: true,
    reason: reasons.length ? 'RESOLUTION_EVIDENCE_NOT_CERTIFIED' : 'OFFICIAL_SETTLEMENT_EVIDENCE_CERTIFIED',
    reasons,
    betId,
    sourceTier,
    source,
    sourceEventId: sourceEventId || null,
    observedAt: observedAt || null,
    settledAt: settledAt || null,
    eventStart: eventStart || null,
    eventFingerprint: eventFingerprint || null,
    marketFingerprint: marketFingerprint || null,
    settlementEvidenceHash: evidenceHash || null,
    resolutionEvidenceHash,
    operationId: operationId || null,
    settlementOperationId: settlementOperationId || null,
    authority: AUTHORITY
  };
}

function health() {
  return {
    success: true,
    healthy: true,
    readOnly: true,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    officialSourceTiers: Array.from(OFFICIAL_TIERS),
    authority: AUTHORITY
  };
}

module.exports = {
  VERSION,
  POLICY_VERSION,
  MODE,
  AUTHORITY,
  OFFICIAL_TIERS,
  evaluateResolutionEvidence,
  health
};
