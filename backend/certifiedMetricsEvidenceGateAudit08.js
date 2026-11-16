'use strict';

const VERSION = 'AUDIT08_CERTIFIED_METRICS_EVIDENCE_GATE_V1';
const POLICY_VERSION = 'AUDIT08_CERTIFIED_FORWARD_SETTLEMENT_POLICY_V1';
const MODE = 'READ_ONLY_FAIL_CLOSED_METRICS_ONLY';

function text(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function finite(v, fallback = null) { if (v === null || v === undefined) return fallback; if (typeof v === 'string' && v.trim() === '') return fallback; const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function resolved(row = {}) { return ['WON', 'LOST'].includes(upper(row.status)); }
function validDate(v) { const s = text(v); if (!s) return false; const t = Date.parse(s); return Number.isFinite(t); }
function badSource(source) {
  const s = upper(source);
  return !s || s.startsWith('PENDING') || s.includes('UNKNOWN') || s.includes('MANUAL') || s.includes('UNVERIFIED') || s.includes('WEAK');
}
function addReason(reasons, condition, code) { if (condition) reasons.push(code); }

function evaluateTennisSettlement(row = {}) {
  const reasons = [];
  addReason(reasons, !resolved(row), 'RESULT_NOT_RESOLVED');
  addReason(reasons, Number(row.production_eligible || 0) !== 1, 'PRODUCTION_LEDGER_NOT_ELIGIBLE');
  addReason(reasons, Number(row.settlement_eligible || 0) !== 1, 'SETTLEMENT_LEDGER_NOT_ELIGIBLE');
  addReason(reasons, upper(row.settlement_contract_status) !== 'VERIFIED', 'SETTLEMENT_CONTRACT_NOT_VERIFIED');
  addReason(reasons, !text(row.settlement_contract_version), 'SETTLEMENT_CONTRACT_VERSION_MISSING');
  addReason(reasons, !text(row.settlement_evidence_hash), 'SETTLEMENT_EVIDENCE_HASH_MISSING');
  addReason(reasons, !text(row.settlement_source_event_id), 'SETTLEMENT_SOURCE_EVENT_ID_MISSING');
  addReason(reasons, !text(row.settlement_event_fingerprint), 'SETTLEMENT_EVENT_FINGERPRINT_MISSING');
  addReason(reasons, !text(row.settlement_market_fingerprint), 'SETTLEMENT_MARKET_FINGERPRINT_MISSING');
  if (text(row.tennis_event_fingerprint) && text(row.settlement_event_fingerprint)) {
    addReason(reasons, text(row.tennis_event_fingerprint) !== text(row.settlement_event_fingerprint), 'EVENT_FINGERPRINT_MISMATCH');
  }
  if (text(row.tennis_market_fingerprint) && text(row.settlement_market_fingerprint)) {
    addReason(reasons, text(row.tennis_market_fingerprint) !== text(row.settlement_market_fingerprint), 'MARKET_FINGERPRINT_MISMATCH');
  }
  return { certified: reasons.length === 0, reasons };
}

function evaluateCalcioSettlement(row = {}) {
  const reasons = [];
  addReason(reasons, !resolved(row), 'RESULT_NOT_RESOLVED');
  const sport = upper(row.sport_type);
  addReason(reasons, sport !== 'CALCIO' && sport !== 'FOOTBALL' && sport !== 'SOCCER', 'SPORT_NOT_CALCIO');
  addReason(reasons, upper(row.bet_type).startsWith('MULTI'), 'MULTI_EXCLUDED_FROM_CERTIFIED_FORWARD');
  addReason(reasons, Number(row.paper_result_active == null ? 1 : row.paper_result_active) !== 1, 'PAPER_RESULT_INACTIVE');
  addReason(reasons, Number(row.paper_result_conflict || 0) !== 0, 'PAPER_RESULT_CONFLICT');
  const dq = upper(row.data_quality || 'CURRENT_BOOTSTRAP');
  addReason(reasons, ['LEGACY_DIRTY', 'DIRTY', 'OLD_METRICS'].includes(dq), 'DATA_QUALITY_NOT_CURRENT');
  addReason(reasons, !validDate(row.settled_at), 'SETTLED_AT_MISSING_OR_INVALID');
  addReason(reasons, badSource(row.settlement_source), 'SETTLEMENT_SOURCE_NOT_CERTIFIED');
  const hg = finite(row.home_goals, null), ag = finite(row.away_goals, null);
  addReason(reasons, hg == null || ag == null || hg < 0 || ag < 0, 'STRUCTURED_SCORE_MISSING_OR_INVALID');
  addReason(reasons, finite(row.profit, null) == null, 'PROFIT_NOT_FINITE');
  return { certified: reasons.length === 0, reasons };
}

function summarize(rows = [], evaluator) {
  const list = Array.isArray(rows) ? rows : [];
  const certifiedRows = [];
  const excludedRows = [];
  const reasons = {};
  for (const row of list) {
    const result = evaluator(row);
    if (result.certified) certifiedRows.push(row);
    else {
      excludedRows.push({ id: row.id ?? null, reasons: result.reasons });
      for (const reason of result.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
    }
  }
  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    totalRows: list.length,
    certifiedRows: certifiedRows.length,
    excludedRows: excludedRows.length,
    exclusionReasons: reasons,
    excludedSample: excludedRows.slice(0, 25),
    rows: certifiedRows
  };
}

function summarizeTennisProductionRows(rows = []) { return summarize(rows, evaluateTennisSettlement); }
function summarizeCalcioOperationalRows(rows = []) {
  const resolvedRows = (Array.isArray(rows) ? rows : []).filter(resolved);
  return summarize(resolvedRows, evaluateCalcioSettlement);
}

function health() {
  return {
    success: true,
    healthy: true,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    authority: {
      readOnlyClassification: true,
      probabilityMutation: false,
      stakeMutation: false,
      settlementMutation: false,
      databaseMutation: false,
      automaticPromotion: false
    }
  };
}

module.exports = {
  VERSION,
  POLICY_VERSION,
  MODE,
  evaluateTennisSettlement,
  evaluateCalcioSettlement,
  summarizeTennisProductionRows,
  summarizeCalcioOperationalRows,
  health
};
