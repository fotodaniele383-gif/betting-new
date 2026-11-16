'use strict';

const priorityT9 = require('./tennisClvEvidencePriorityT9');
const VERSION = 'AUDIT16D_R3_T9_EVIDENCE_MATURITY_READ_MODEL_V1';
const MIN_HOLDOUT_AUDIT = 50;
const PREFERRED_HOLDOUT_MODEL_CHANGE = 100;

function upper(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
function finite(value) { return Number.isFinite(Number(value)); }
function pct(n, d) { return d > 0 ? Number((100 * n / d).toFixed(2)) : null; }
function tableExists(db, table) {
  try { return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
  catch (_) { return false; }
}
function canonicalMarket(row = {}) {
  const market = upper(row.market_type);
  const prediction = upper(row.prediction);
  if (market.includes('TOTAL') || prediction.includes('OVER') || prediction.includes('UNDER')) return 'TOTALS';
  if (market.includes('MONEY') || ['1', '2'].includes(prediction)) return 'MONEYLINE';
  return 'UNKNOWN';
}
function canonicalTournamentLevel(row = {}) {
  const text = upper([row.tournament_level, row.tournament_category, row.tournament_name, row.league].filter(Boolean).join(' '));
  if (!text) return 'UNKNOWN';
  if (text.includes('GRAND SLAM') || text.includes('GRAND_SLAM')) return 'GRAND_SLAM';
  if (text.includes('MASTERS 1000') || text.includes('MASTERS_1000') || text.includes('WTA 1000') || text.includes('WTA1000')) return text.includes('WTA') ? 'WTA_1000' : 'ATP_MASTERS_1000';
  if (text.includes('ATP 500') || text.includes('ATP500')) return 'ATP_500';
  if (text.includes('WTA 500') || text.includes('WTA500')) return 'WTA_500';
  if (text.includes('ATP 250') || text.includes('ATP250')) return 'ATP_250';
  if (text.includes('WTA 250') || text.includes('WTA250')) return 'WTA_250';
  if (text.includes('CHALLENGER')) return 'CHALLENGER';
  return 'UNKNOWN';
}

function inspect(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('T9_DB_REQUIRED');
  const required = ['ai_forward_test', 'tennis_prediction_snapshots', 'tennis_forward_cohort_members'];
  const missingTables = required.filter(t => !tableExists(db, t));
  if (missingTables.length) return { success: false, status: 'DATA_QUALITY_BLOCKED', version: VERSION, missingTables, readOnly: true };

  const anchors = db.prepare(`SELECT f.*, c.cohort_role,c.holdout_locked,c.leakage_status,c.maturity_status,s.snapshot_id,s.snapshot_status,s.is_calibration_anchor
    FROM tennis_prediction_snapshots s
    JOIN ai_forward_test f ON f.id=s.bet_id
    LEFT JOIN tennis_forward_cohort_members c ON c.bet_id=s.bet_id
    WHERE s.is_calibration_anchor=1 AND UPPER(COALESCE(s.snapshot_status,''))='VALID_PREMATCH'`).all();
  const strict = anchors.filter(r => ['WON','LOST'].includes(upper(r.status)) && upper(r.settlement_contract_status)==='VERIFIED' && upper(r.leakage_status)==='CLEAR');
  const holdout = strict.filter(r => upper(r.cohort_role)==='HOLDOUT');
  const development = strict.filter(r => upper(r.cohort_role)==='DEVELOPMENT');
  const clvVerified = strict.filter(r => upper(r.clv_contract_status)==='VERIFIED' && Number(r.clv_verified||0)===1 && r.clv_closing_ts);
  const holdoutClvVerified = holdout.filter(r => upper(r.clv_contract_status)==='VERIFIED' && Number(r.clv_verified||0)===1 && r.clv_closing_ts);
  const realStake = anchors.filter(r => finite(r.stake) && Number(r.stake)>0);
  const realStakeOfficialSchedule = realStake.filter(priorityT9.isOfficialScheduleCertified);
  const realStakeScheduleReview = realStake.filter(r => !priorityT9.isOfficialScheduleCertified(r));

  const marketCounts = {};
  const tournamentCounts = {};
  for (const row of anchors) {
    const m = canonicalMarket(row); marketCounts[m] = (marketCounts[m] || 0) + 1;
    const t = canonicalTournamentLevel(row); tournamentCounts[t] = (tournamentCounts[t] || 0) + 1;
  }
  const holdoutPending = anchors.filter(r => upper(r.cohort_role)==='HOLDOUT' && upper(r.leakage_status)==='CLEAR' && upper(r.status)==='PENDING');
  const t9EligiblePending = holdoutPending.filter(r => priorityT9.classifyHoldoutEvidencePriority(r, {hasStakeField:finite(r.stake),stake:finite(r.stake)?Number(r.stake):null,hasRealStake:finite(r.stake)&&Number(r.stake)>0}, {enabled:true}));
  const remainingTo50 = Math.max(0, MIN_HOLDOUT_AUDIT - holdout.length);
  const remainingTo100 = Math.max(0, PREFERRED_HOLDOUT_MODEL_CHANGE - holdout.length);
  const status = holdout.length >= PREFERRED_HOLDOUT_MODEL_CHANGE ? 'CALIBRATION_REVIEW_READY'
    : holdout.length >= MIN_HOLDOUT_AUDIT ? 'MINIMUM_AUDIT_READY'
    : 'COLLECTING_HOLDOUT';

  return {
    success: true,
    status,
    version: VERSION,
    readOnly: true,
    baseline: 'AUDIT16D_R3_T8',
    counts: {
      anchors: anchors.length,
      strictSettled: strict.length,
      developmentSettled: development.length,
      holdoutSettled: holdout.length,
      holdoutPending: holdoutPending.length,
      t9HoldoutZeroStakeLiveEligibleWhenInWindow: t9EligiblePending.length
    },
    maturity: {
      minimumHoldoutAudit: MIN_HOLDOUT_AUDIT,
      preferredHoldoutForModelChange: PREFERRED_HOLDOUT_MODEL_CHANGE,
      remainingTo50,
      remainingTo100,
      modelChangeAuthority: false
    },
    clv: {
      verifiedStrict: clvVerified.length,
      verifiedStrictPct: pct(clvVerified.length, strict.length),
      verifiedHoldout: holdoutClvVerified.length,
      verifiedHoldoutPct: pct(holdoutClvVerified.length, holdout.length),
      t9HoldoutCaptureEnabled: priorityT9.DEFAULT_ENABLED,
      realStakePriorityPreserved: true
    },
    schedule: {
      realStakeRows: realStake.length,
      realStakeOfficialCertified: realStakeOfficialSchedule.length,
      realStakeOfficialCertifiedPct: pct(realStakeOfficialSchedule.length, realStake.length),
      realStakeReviewOnly: realStakeScheduleReview.length,
      shadowOnly: true,
      stakeAuthority: false
    },
    normalization: {
      marketCounts,
      tournamentLevelCounts: tournamentCounts,
      unknownMarket: marketCounts.UNKNOWN || 0,
      unknownTournamentLevel: tournamentCounts.UNKNOWN || 0,
      writeBack: false
    },
    authority: {
      probability: false,
      model: false,
      deepScan: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      scheduleBlocking: false,
      automaticPromotion: false
    },
    nextAction: status === 'COLLECTING_HOLDOUT' ? 'ACCUMULATE_VERIFIED_HOLDOUT_AND_CLV'
      : status === 'MINIMUM_AUDIT_READY' ? 'RERUN_T8_AND_CONTINUE_TO_100_BEFORE_MODEL_CHANGE'
      : 'RERUN_T8_THEN_REVIEW_CALIBRATION_WITH_FROZEN_HOLDOUT'
  };
}

module.exports = { VERSION, MIN_HOLDOUT_AUDIT, PREFERRED_HOLDOUT_MODEL_CHANGE, canonicalMarket, canonicalTournamentLevel, inspect };
