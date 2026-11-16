'use strict';

const VERSION = 'TENNIS_FORWARD_CAPTURE_DIAGNOSTIC_POLICY_V4_PATCH48_R2';
const CLASSES = Object.freeze({
  NONE: 'NONE',
  STRUCTURAL_INTEGRITY: 'STRUCTURAL_INTEGRITY',
  DECISION_CONTRACT: 'DECISION_CONTRACT',
  EVIDENCE_OVERDUE: 'EVIDENCE_OVERDUE',
  EXPECTED_POLICY_EXCLUSION: 'EXPECTED_POLICY_EXCLUSION'
});

const EVIDENCE_OVERDUE = new Set(['SETTLEMENT_SLA_CRITICAL']);
const DECISION_CONTRACT = new Set(['QUALITY_DECISION_INCOMPLETE', 'QUALITY_STAKE_INCOHERENT']);

function upper(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
function unique(values) { return [...new Set((Array.isArray(values) ? values : []).map(upper).filter(Boolean))]; }
function isStructural(reason) {
  return reason === 'SOURCE_BET_NOT_FOUND'
    || reason === 'HOLDOUT_LOCK_ROLE_MISMATCH'
    || reason === 'ELIGIBILITY_LEDGER_MISSING'
    || reason.startsWith('SNAPSHOT_CHAIN_')
    || reason.startsWith('LEDGER_MISMATCH_')
    || reason.startsWith('LIFECYCLE_SNAPSHOT_CHAIN_')
    || reason.startsWith('LIFECYCLE_LEDGER_MISMATCH_')
    || reason.startsWith('LIFECYCLE_INSPECTION_FAILED')
    || /^SNAPSHOT_(?!SLA|CAPTURE_DELAY)/.test(reason)
    || /^COHORT_(CONFLICT|CORRUPT|HASH|SEAL)/.test(reason);
}
function classify(reasons = [], context = {}) {
  const normalized = unique(reasons);
  if (!normalized.length) return { class: CLASSES.NONE, structural: [], decision: [], overdue: [], expected: [] };
  const expectedTemporal = context.expectedTemporalExclusion === true || context.terminalClvQuarantine === true;
  const buckets = { structural: [], decision: [], overdue: [], expected: [] };
  for (const reason of normalized) {
    if (EVIDENCE_OVERDUE.has(reason)) buckets.overdue.push(reason);
    else if (DECISION_CONTRACT.has(reason)) buckets.decision.push(reason);
    else if (expectedTemporal && (reason.startsWith('COHORT_') || reason.startsWith('LIFECYCLE_'))) buckets.expected.push(reason);
    else if (isStructural(reason)) buckets.structural.push(reason);
    else buckets.decision.push(reason);
  }
  const cls = buckets.structural.length ? CLASSES.STRUCTURAL_INTEGRITY
    : buckets.decision.length ? CLASSES.DECISION_CONTRACT
      : buckets.overdue.length ? CLASSES.EVIDENCE_OVERDUE
        : CLASSES.EXPECTED_POLICY_EXCLUSION;
  return { class: cls, ...buckets };
}
function summarize(details = []) {
  const byClass = Object.fromEntries(Object.values(CLASSES).map(key => [key, 0]));
  const byReason = {};
  for (const item of details) {
    const cls = item.blockClass || CLASSES.NONE;
    byClass[cls] = Number(byClass[cls] || 0) + (item.status === 'BLOCKED' ? 1 : 0);
    for (const reason of item.reasons || []) byReason[reason] = Number(byReason[reason] || 0) + 1;
  }
  return { version: VERSION, byClass, byReason };
}
module.exports = { VERSION, CLASSES, EVIDENCE_OVERDUE, DECISION_CONTRACT, classify, summarize, isStructural };
