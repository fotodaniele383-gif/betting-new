'use strict';

const clvCoverage = require('./clvCrossSportCoveragePatch53');
const tennisClvContract = require('./tennisClvContract');

const VERSION = 'AUDIT09_CERTIFIED_CLV_EVIDENCE_GATE_V1';
const POLICY_VERSION = 'AUDIT09_CLV_PREMATCH_PROVENANCE_POLICY_V1';

function text(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function num(v) { if (v == null || text(v) === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function parseTs(v) { return tennisClvContract.parseTs(v); }
function round(v, d = 2) { const n = Number(v); return Number.isFinite(n) ? Number(n.toFixed(d)) : 0; }
function addReason(reasons, reason, condition) { if (condition) reasons.push(reason); }

function eventTs(row = {}) {
  const candidates = [
    row.canonical_event_time_safety_utc,
    row.canonical_event_time_canonical_utc,
    row.canonical_match_datetime,
    row.commence_time,
    row.match_date
  ];
  for (const value of candidates) {
    const ts = parseTs(value);
    if (ts != null) return ts;
  }
  return null;
}

function sourceIsPrematch(row = {}) {
  const source = upper(row.clv_source || row.clv_method || row.clv_last_attempt_result);
  if (!source) return false;
  const forbidden = ['POST_MATCH', 'POSTMATCH', 'STALE', 'SYNTHETIC', 'ESTIMATED', 'MANUAL'];
  if (forbidden.some(token => source.includes(token))) return false;
  return ['LIVE_API', 'PREMATCH', 'CLOSING', 'VAULT', 'BOOKMAKER'].some(token => source.includes(token));
}

function commonEvidence(row = {}) {
  const reasons = [];
  const openingOdd = num(row.opening_odd);
  const closingOdd = num(row.closing_odd);
  const openingTs = parseTs(row.clv_opening_ts);
  const closingTs = parseTs(row.clv_closing_ts);
  const matchTs = eventTs(row);
  const bookmaker = text(row.clv_bookmaker);
  const sourceEventId = text(row.clv_source_event_id);
  const eventFingerprint = text(row.clv_event_fingerprint);
  const marketFingerprint = text(row.clv_market_fingerprint);

  addReason(reasons, 'CLV_VERIFIED_FLAG_FALSE', Number(row.clv_verified || 0) !== 1);
  addReason(reasons, 'MISSING_OR_INVALID_OPENING_ODD', !(openingOdd > 1));
  addReason(reasons, 'MISSING_OR_INVALID_CLOSING_ODD', !(closingOdd > 1));
  addReason(reasons, 'MISSING_OPENING_TIMESTAMP', openingTs == null);
  addReason(reasons, 'MISSING_CLOSING_TIMESTAMP', closingTs == null);
  addReason(reasons, 'MISSING_EVENT_TIMESTAMP', matchTs == null);
  addReason(reasons, 'CLOSING_NOT_AFTER_OPENING', openingTs != null && closingTs != null && closingTs <= openingTs);
  addReason(reasons, 'CLOSING_AFTER_EVENT_START', closingTs != null && matchTs != null && closingTs > matchTs);
  addReason(reasons, 'MISSING_BOOKMAKER', !bookmaker);
  addReason(reasons, 'MISSING_SOURCE_EVENT_ID', !sourceEventId);
  addReason(reasons, 'MISSING_EVENT_FINGERPRINT', !eventFingerprint);
  addReason(reasons, 'MISSING_MARKET_FINGERPRINT', !marketFingerprint);
  addReason(reasons, 'SOURCE_NOT_CERTIFIED_PREMATCH', !sourceIsPrematch(row));

  return {
    reasons,
    openingOdd,
    closingOdd,
    openingTs,
    closingTs,
    matchTs,
    bookmaker,
    sourceEventId,
    eventFingerprint,
    marketFingerprint
  };
}

function evaluateTennis(row = {}) {
  const base = commonEvidence(row);
  const reasons = [...base.reasons];
  const status = upper(row.clv_contract_status);
  addReason(reasons, 'TENNIS_CLV_CONTRACT_NOT_VERIFIED', status !== 'VERIFIED');
  addReason(reasons, 'TENNIS_CLV_CONTRACT_VERSION_MISSING', !text(row.clv_contract_version));

  const eventFp = text(row.tennis_event_fingerprint);
  const marketFp = text(row.tennis_market_fingerprint);
  addReason(reasons, 'TENNIS_EVENT_FINGERPRINT_MISMATCH', Boolean(eventFp) && eventFp !== base.eventFingerprint);
  addReason(reasons, 'TENNIS_MARKET_FINGERPRINT_MISMATCH', Boolean(marketFp) && marketFp !== base.marketFingerprint);

  // Re-evaluate the existing Tennis contract too, but AUDIT09 is stricter because event/opening time are mandatory.
  const contract = tennisClvContract.evaluateTennisClvContract(row);
  addReason(reasons, 'TENNIS_CONTRACT_REEVALUATION_FAILED', contract.status !== 'VERIFIED');

  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    sport: 'TENNIS',
    certified: reasons.length === 0,
    reasons,
    evidence: base,
    contractStatus: status || null,
    contractReevaluationStatus: contract.status
  };
}

function evaluateCalcio(row = {}) {
  const base = commonEvidence(row);
  const reasons = [...base.reasons];
  const contractStatus = upper(row.clv_contract_status);
  if (contractStatus && contractStatus !== 'VERIFIED') reasons.push('CALCIO_CLV_CONTRACT_EXPLICITLY_NOT_VERIFIED');
  const sportKey = text(row.clv_cross_sport_sport_key || row.clv_sport_key_resolved);
  addReason(reasons, 'CALCIO_CLV_SPORT_KEY_UNRESOLVED', !sportKey);

  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    sport: 'CALCIO',
    certified: reasons.length === 0,
    reasons,
    evidence: base,
    sportKey: sportKey || null,
    contractStatus: contractStatus || null
  };
}

function evaluateRow(row = {}) {
  const sport = clvCoverage.detectSport(row);
  return sport === 'TENNIS' ? evaluateTennis(row) : evaluateCalcio(row);
}

function emptySegment(sport) {
  return {
    sport,
    eligibleRows: 0,
    rawVerifiedRows: 0,
    certifiedRows: 0,
    rawOnlyRows: 0,
    rawVerifiedCoveragePct: 0,
    certifiedCoveragePct: 0,
    exclusionReasons: {}
  };
}

function finalize(segment) {
  const d = segment.eligibleRows || 0;
  segment.rawVerifiedCoveragePct = d ? round(segment.rawVerifiedRows / d * 100, 2) : 0;
  segment.certifiedCoveragePct = d ? round(segment.certifiedRows / d * 100, 2) : 0;
  segment.rawOnlyRows = Math.max(0, segment.rawVerifiedRows - segment.certifiedRows);
  return segment;
}

function summarizeRows(rows = []) {
  const bySport = { TENNIS: emptySegment('TENNIS'), CALCIO: emptySegment('CALCIO') };
  const eligibleRows = (Array.isArray(rows) ? rows : []).filter(clvCoverage.isEligibleClvRow);
  for (const row of eligibleRows) {
    const sport = clvCoverage.detectSport(row);
    const segment = bySport[sport] || (bySport[sport] = emptySegment(sport));
    segment.eligibleRows += 1;
    if (Number(row.clv_verified || 0) === 1) segment.rawVerifiedRows += 1;
    const evaluation = evaluateRow(row);
    if (evaluation.certified) segment.certifiedRows += 1;
    else if (Number(row.clv_verified || 0) === 1) {
      for (const reason of [...new Set(evaluation.reasons)]) {
        segment.exclusionReasons[reason] = (segment.exclusionReasons[reason] || 0) + 1;
      }
    }
  }
  Object.values(bySport).forEach(finalize);
  const overall = emptySegment('ALL');
  for (const segment of Object.values(bySport)) {
    overall.eligibleRows += segment.eligibleRows;
    overall.rawVerifiedRows += segment.rawVerifiedRows;
    overall.certifiedRows += segment.certifiedRows;
    for (const [reason, count] of Object.entries(segment.exclusionReasons)) {
      overall.exclusionReasons[reason] = (overall.exclusionReasons[reason] || 0) + count;
    }
  }
  finalize(overall);
  return {
    success: true,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    bySport,
    overall,
    authority: {
      readOnly: true,
      databaseMutation: false,
      probabilityMutation: false,
      stakeMutation: false,
      settlementMutation: false,
      schedulerMutation: false,
      automaticPromotion: false
    },
    invariant: 'A CLV is certified only with explicit opening/closing odds, prematch temporal provenance, bookmaker, source event id and event/market fingerprints.'
  };
}

function health() {
  return {
    success: true,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    authority: {
      readOnly: true,
      databaseMutation: false,
      probabilityMutation: false,
      stakeMutation: false,
      settlementMutation: false,
      schedulerMutation: false,
      automaticPromotion: false
    }
  };
}

module.exports = {
  VERSION,
  POLICY_VERSION,
  eventTs,
  sourceIsPrematch,
  evaluateTennis,
  evaluateCalcio,
  evaluateRow,
  summarizeRows,
  health
};
