'use strict';

const VERSION = 'AUDIT10_SETTLEMENT_EXCEPTION_SCOPE_GATE_V1';
const POLICY_VERSION = 'AUDIT10_SETTLEMENT_SCOPE_POLICY_V1';
const MODE = 'READ_ONLY_FAIL_CLOSED_SPORT_SCOPED_QUARANTINE';

const AUTHORITY = Object.freeze({
  databaseMutation: false,
  probabilityMutation: false,
  stakeMutation: false,
  settlementMutation: false,
  schedulerMutation: false,
  automaticProductionActivation: false
});

function text(v) { return String(v == null ? '' : v).trim(); }
function upper(v) { return text(v).toUpperCase(); }
function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function tableExists(db, name) {
  try { return Boolean(db.prepare("SELECT 1 x FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name)); }
  catch (_) { return false; }
}
function countBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const k = text(row?.[key]) || 'UNKNOWN';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function unavailableTennis(reason) {
  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    sport: 'TENNIS',
    available: false,
    ready: false,
    failClosed: true,
    reason,
    totalRows: 0,
    openRows: 0,
    criticalOpenRows: 1,
    quarantinedOpenRows: 0,
    manualActionOpenRows: 0,
    targetedRecoveryOpenRows: 0,
    productionEligibleOpenRows: 0,
    settlementEligibleOpenRows: 0,
    unknownEligibilityOpenRows: 1,
    oldestOpenAt: null,
    byExceptionType: {},
    byRecoveryMode: {},
    authority: AUTHORITY
  };
}

function summarizeTennisQueue(db) {
  if (!db || typeof db.prepare !== 'function') return unavailableTennis('DB_ADAPTER_REQUIRED');
  if (!tableExists(db, 'tennis_settlement_exception_queue_patch51')) return unavailableTennis('QUEUE_TABLE_MISSING');

  const hasEligibility = tableExists(db, 'tennis_calibration_eligibility');
  let rows = [];
  try {
    if (hasEligibility) {
      rows = db.prepare(`SELECT q.bet_id,q.status,q.exception_type,q.recovery_mode,q.manual_action_required,
        q.contract_status,q.contract_reason,q.source,q.source_tier,q.source_event_id,
        q.first_seen_at,q.last_changed_at,
        e.production_eligible,e.settlement_eligible
        FROM tennis_settlement_exception_queue_patch51 q
        LEFT JOIN tennis_calibration_eligibility e ON e.bet_id=q.bet_id`).all();
    } else {
      rows = db.prepare(`SELECT q.bet_id,q.status,q.exception_type,q.recovery_mode,q.manual_action_required,
        q.contract_status,q.contract_reason,q.source,q.source_tier,q.source_event_id,
        q.first_seen_at,q.last_changed_at,
        NULL production_eligible,NULL settlement_eligible
        FROM tennis_settlement_exception_queue_patch51 q`).all();
    }
  } catch (error) {
    return unavailableTennis(`QUEUE_QUERY_FAILED:${error.message}`);
  }

  const open = rows.filter(r => upper(r.status) === 'OPEN');
  const classified = open.map(row => {
    const pKnown = row.production_eligible === 0 || row.production_eligible === 1;
    const sKnown = row.settlement_eligible === 0 || row.settlement_eligible === 1;
    const eligibilityKnown = pKnown && sKnown;
    const quarantined = eligibilityKnown && Number(row.production_eligible) === 0 && Number(row.settlement_eligible) === 0;
    return { ...row, eligibilityKnown, quarantined, critical: !quarantined };
  });
  const critical = classified.filter(r => r.critical);
  const quarantined = classified.filter(r => r.quarantined);
  const dates = open.map(r => Date.parse(r.first_seen_at || '')).filter(Number.isFinite).sort((a,b)=>a-b);

  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    sport: 'TENNIS',
    available: true,
    ready: critical.length === 0,
    failClosed: true,
    reason: critical.length === 0 ? 'NO_PRODUCTION_RELEVANT_OPEN_EXCEPTIONS' : 'PRODUCTION_RELEVANT_OR_UNCLASSIFIED_EXCEPTIONS_OPEN',
    totalRows: rows.length,
    openRows: open.length,
    criticalOpenRows: critical.length,
    quarantinedOpenRows: quarantined.length,
    manualActionOpenRows: open.filter(r => n(r.manual_action_required,0) === 1).length,
    targetedRecoveryOpenRows: open.filter(r => upper(r.recovery_mode) === 'TARGETED_OFFICIAL_RESULT').length,
    productionEligibleOpenRows: classified.filter(r => Number(r.production_eligible) === 1).length,
    settlementEligibleOpenRows: classified.filter(r => Number(r.settlement_eligible) === 1).length,
    unknownEligibilityOpenRows: classified.filter(r => !r.eligibilityKnown).length,
    oldestOpenAt: dates.length ? new Date(dates[0]).toISOString() : null,
    byExceptionType: countBy(open, 'exception_type'),
    byRecoveryMode: countBy(open, 'recovery_mode'),
    authority: AUTHORITY
  };
}

function summarizeCalcioReadiness(readinessSection) {
  const m = readinessSection?.metrics || {};
  const settlement = m.settlementEvidence || {};
  const resolvedRows = n(m.resolvedRows, 0);
  const certifiedResolvedRows = n(m.certifiedResolvedRows, 0);
  const uncertifiedResolvedRows = n(m.uncertifiedResolvedRows, Math.max(0, resolvedRows - certifiedResolvedRows));
  const excludedRows = n(settlement.excludedRows, 0);
  const totalRows = n(settlement.totalRows, resolvedRows);
  const certifiedRows = n(settlement.certifiedRows, certifiedResolvedRows);
  const available = Boolean(settlement.version) && Number.isFinite(Number(settlement.excludedRows));
  const blockingRows = Math.max(excludedRows, uncertifiedResolvedRows, Math.max(0, resolvedRows - certifiedResolvedRows));

  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    sport: 'CALCIO',
    available,
    ready: available && blockingRows === 0,
    failClosed: true,
    reason: !available ? 'CALCIO_SETTLEMENT_EVIDENCE_UNAVAILABLE' : blockingRows === 0 ? 'CALCIO_SETTLEMENT_EVIDENCE_CLEAR' : 'CALCIO_UNCERTIFIED_SETTLEMENT_ROWS_PRESENT',
    totalRows,
    certifiedRows,
    excludedRows,
    resolvedRows,
    certifiedResolvedRows,
    uncertifiedResolvedRows,
    blockingRows: available ? blockingRows : 1,
    authority: AUTHORITY
  };
}

function summarizeSport(db, sport, readinessSection) {
  const s = upper(sport);
  if (s === 'TENNIS') return summarizeTennisQueue(db);
  if (s === 'CALCIO' || s === 'FOOTBALL' || s === 'SOCCER') return summarizeCalcioReadiness(readinessSection);
  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    mode: MODE,
    sport: s || 'UNKNOWN',
    available: false,
    ready: false,
    failClosed: true,
    reason: 'UNSUPPORTED_SPORT',
    blockingRows: 1,
    authority: AUTHORITY
  };
}

function health() {
  return { success:true, healthy:true, readOnly:true, version:VERSION, policyVersion:POLICY_VERSION, mode:MODE, authority:AUTHORITY };
}

module.exports = {
  VERSION,
  POLICY_VERSION,
  MODE,
  AUTHORITY,
  summarizeTennisQueue,
  summarizeCalcioReadiness,
  summarizeSport,
  health
};
