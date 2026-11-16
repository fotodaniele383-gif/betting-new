'use strict';

const VERSION = 'AUDIT16D_R3_T9_HOLDOUT_CLV_EVIDENCE_PRIORITY_V1';
const DEFAULT_ENABLED = String(process.env.CLV_T9_HOLDOUT_CAPTURE_ENABLED || '1') !== '0';
const OFFICIAL_SOURCE_KINDS = Object.freeze(['OFFICIAL_TOUR', 'OFFICIAL_TOURNAMENT', 'PRIMARY_EVENT_PROVIDER']);

function upper(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
function num(value) { if (value === null || value === undefined || String(value).trim() === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }

function isLockedClearHoldout(bet = {}) {
  return upper(bet.t9_cohort_role || bet.cohort_role) === 'HOLDOUT'
    && Number(bet.t9_holdout_locked ?? bet.holdout_locked ?? 0) === 1
    && upper(bet.t9_leakage_status || bet.leakage_status) === 'CLEAR';
}

function classifyHoldoutEvidencePriority(bet = {}, stakeInfo = {}, options = {}) {
  const enabled = options.enabled == null ? DEFAULT_ENABLED : options.enabled === true;
  if (!enabled || !isLockedClearHoldout(bet)) return null;
  // REAL_STAKE remains the absolute authority in clvTracker (priority 100).
  if (stakeInfo.hasRealStake === true || num(stakeInfo.stake) > 0) return null;
  // T9 intentionally expands LIVE_API eligibility only for an explicit zero-stake
  // calibration HOLDOUT. The raw persisted stake itself must be finite zero:
  // NULL/empty/invalid values never inherit the legacy zero fallback.
  const persistedStake = num(bet.stake);
  if (stakeInfo.hasStakeField !== true || num(stakeInfo.stake) !== 0 || persistedStake !== 0) return null;
  return {
    priority: 90,
    category: 'HOLDOUT_CALIBRATION',
    apiAllowed: true,
    reason: 'T9: HOLDOUT sigillato/leakage-clear con stake esplicito 0; CLV live consentito solo nella closing window e sotto i guardrail API esistenti.',
    version: VERSION
  };
}

function annotateCandidatesWithCohort(db, rows = []) {
  if (!db || typeof db.prepare !== 'function' || !Array.isArray(rows) || rows.length === 0) return Array.isArray(rows) ? rows : [];
  let tablePresent = false;
  try {
    tablePresent = Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='tennis_forward_cohort_members'").get());
  } catch (_) { tablePresent = false; }
  if (!tablePresent) return rows.map(row => ({ ...row }));
  let cohortRows = [];
  try {
    cohortRows = db.prepare(`SELECT bet_id,cohort_role,holdout_locked,leakage_status,maturity_status
      FROM tennis_forward_cohort_members WHERE bet_id IS NOT NULL`).all();
  } catch (_) { return rows.map(row => ({ ...row })); }
  const map = new Map(cohortRows.map(row => [Number(row.bet_id), row]));
  return rows.map(row => {
    const c = map.get(Number(row.id));
    if (!c) return { ...row };
    return {
      ...row,
      t9_cohort_role: c.cohort_role || null,
      t9_holdout_locked: Number(c.holdout_locked || 0),
      t9_leakage_status: c.leakage_status || null,
      t9_maturity_status: c.maturity_status || null
    };
  });
}

function isOfficialScheduleCertified(row = {}) {
  const kind = upper(row.official_schedule_source_kind);
  const disposition = upper(row.official_schedule_capture_disposition);
  const status = upper(row.official_schedule_status);
  return OFFICIAL_SOURCE_KINDS.includes(kind)
    && disposition === 'ALLOW'
    && ['SCHEDULED', 'DELAYED', 'RESUMED'].includes(status);
}

module.exports = {
  VERSION,
  DEFAULT_ENABLED,
  OFFICIAL_SOURCE_KINDS,
  isLockedClearHoldout,
  classifyHoldoutEvidencePriority,
  annotateCandidatesWithCohort,
  isOfficialScheduleCertified
};
