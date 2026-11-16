'use strict';

const VERSION = 'TENNIS_SETTLEMENT_UPDATE_AUDIT_V1_PATCH29_R2';

const OUTCOMES = Object.freeze({
  UPDATED: 'UPDATED',
  NOOP_ALREADY_CURRENT: 'NOOP_ALREADY_CURRENT',
  NOOP_UNCHANGED_EVIDENCE: 'NOOP_UNCHANGED_EVIDENCE',
  SKIPPED_ALREADY_RESOLVED: 'SKIPPED_ALREADY_RESOLVED',
  SKIPPED_MANUAL_REVIEW: 'SKIPPED_MANUAL_REVIEW',
  MANUAL_REVIEW_RECORDED: 'MANUAL_REVIEW_RECORDED',
  BLOCKED_CONTRACT: 'BLOCKED_CONTRACT',
  DB_UPDATE_FAILED: 'DB_UPDATE_FAILED'
});

const PROTECTED_MANUAL_REASONS = Object.freeze([
  'OFFICIAL_RETIREMENT_BOOKMAKER_RULE_REQUIRED',
  'OFFICIAL_EVENT_MARKET_FINGERPRINT_MISMATCH',
  'OFFICIAL_EVENT_FINGERPRINT_MISMATCH'
]);

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }

function isProtectedManualReview(row = {}) {
  if (upper(row.settlement_contract_status) !== 'MANUAL_REVIEW') return false;
  const reason = upper(row.settlement_contract_reason);
  return PROTECTED_MANUAL_REASONS.some(code => reason.includes(code));
}

function readSettlementSnapshot(db, betId) {
  if (!db || typeof db.prepare !== 'function') return null;
  try {
    return db.prepare(`SELECT id,status,profit,settled_at,settlement_source,settlement_contract_status,
      settlement_contract_reason,settlement_source_tier,settlement_source_event_id,settlement_score,
      settlement_event_fingerprint,settlement_market_fingerprint
      FROM ai_forward_test WHERE id=?`).get(Number(betId)) || null;
  } catch (_) { return null; }
}

function buildAttemptAudit({ match = {}, before = null, after = null, outcome, intendedStatus = null, contractStatus = null, reason = null, error = null, rowsMatched = null, rowsChanged = null } = {}) {
  return {
    version: VERSION,
    betId: Number(match.id || before?.id || after?.id || 0) || null,
    match: [match.home_team, match.away_team].filter(Boolean).join(' - ') || null,
    statusBefore: before?.status || match.status || null,
    statusAfter: after?.status || before?.status || match.status || null,
    contractBefore: before?.settlement_contract_status || match.settlement_contract_status || null,
    contractAfter: after?.settlement_contract_status || before?.settlement_contract_status || match.settlement_contract_status || null,
    intendedStatus: intendedStatus || null,
    contractStatus: contractStatus || null,
    rowsMatched: rowsMatched == null ? (before ? 1 : 0) : Number(rowsMatched),
    rowsChanged: rowsChanged == null ? null : Number(rowsChanged),
    updateOutcome: outcome || OUTCOMES.DB_UPDATE_FAILED,
    reason: reason || null,
    errorCode: error?.code || null,
    errorMessage: error?.message || (typeof error === 'string' ? error : null)
  };
}

module.exports = { VERSION, OUTCOMES, PROTECTED_MANUAL_REASONS, isProtectedManualReview, readSettlementSnapshot, buildAttemptAudit };
