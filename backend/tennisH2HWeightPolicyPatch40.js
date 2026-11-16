'use strict';

const VERSION = 'TENNIS_H2H_SAMPLE_WEIGHT_POLICY_V1_PATCH40';
const POLICY = Object.freeze([
  Object.freeze({ min: 0, max: 1, capPp: 0, status: 'INSUFFICIENT_SAMPLE' }),
  Object.freeze({ min: 2, max: 3, capPp: 0.75, status: 'VERY_SMALL_SAMPLE' }),
  Object.freeze({ min: 4, max: 6, capPp: 1.5, status: 'SMALL_SAMPLE' }),
  Object.freeze({ min: 7, max: Number.POSITIVE_INFINITY, capPp: 2.5, status: 'STANDARD_CAP' })
]);

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function ruleForSample(sample) {
  const n = Math.max(0, Math.trunc(finite(sample, 0)));
  return POLICY.find(rule => n >= rule.min && n <= rule.max) || POLICY[0];
}
function apply(rawAdjustmentPp, sample) {
  const raw = finite(rawAdjustmentPp, 0);
  const n = Math.max(0, Math.trunc(finite(sample, 0)));
  const rule = ruleForSample(n);
  const capped = Math.max(-rule.capPp, Math.min(rule.capPp, raw));
  return {
    version: VERSION,
    sample: n,
    rawAdjustmentPp: Number(raw.toFixed(4)),
    capPp: rule.capPp,
    adjustmentPp: Number(capped.toFixed(4)),
    status: rule.status,
    reduced: Math.abs(capped) + 1e-9 < Math.abs(raw),
    probabilityAuthority: 'DEEPSCAN_CONTEXT_ONLY',
    stakeAuthority: false
  };
}
module.exports = { VERSION, POLICY, ruleForSample, apply };
