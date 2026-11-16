'use strict';
// R9: shared, side-effect-free risk invariant.  A positive PAPER stake is NOT a proof of value.
const VERSION = 'CALCIO_STAKE_SAFETY_CONTRACT_R9_V1';
const MAX_EV_REPLAY_DELTA_PP = 0.25;
const MIN_POSITIVE_EV_PCT = 0.000001;
const V15_POLICY='EDGE_KELLY_MANUAL_PAPER_V15';
function validV15Proof(proof){
  const p=parse(proof);
  return p.policy===V15_POLICY && p.manualPaperOnly===true && p.identityCertified===true && p.oddsCertified===true && p.oddsOperationalEligible===true
    && finite(p.sourceCount)>=2 && finite(p.quoteAgeMinutes)!==null && finite(p.quoteAgeMinutes)>=0 && finite(p.quoteAgeMinutes)<=30
    && ['HISTORY_PROXY','HISTORY_PROXY_STRONG','STRONG_REAL_XG'].includes(String(p.coverageMode||''));
}
function finite(value) {
  if (value === undefined || value === null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function parse(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch (_) { return {}; }
}
function round(n, decimals = 4) { return Number.isFinite(n) ? Number(n.toFixed(decimals)) : null; }
function evaluate(input = {}) {
  const p = finite(input.robustProbabilityPct);
  const odd = finite(input.netExecutableOdd);
  const reported = finite(input.robustEvPct);
  const reasons = [];
  const dataClass = String(input.dataClass || '').trim().toUpperCase();
  const guard = parse(input.reliabilityGuard);
  if (p === null || p <= 0 || p >= 100) reasons.push('R9_ROBUST_PROBABILITY_INVALID_OR_MISSING');
  if (odd === null || odd <= 1 || odd > 1000) reasons.push('R9_NET_EXECUTABLE_ODD_INVALID_OR_MISSING');
  const recomputed = p !== null && p > 0 && p < 100 && odd !== null && odd > 1 && odd <= 1000
    ? (p / 100 * odd - 1) * 100 : null;
  if (reported === null) reasons.push('R9_ROBUST_EV_MISSING');
  if (recomputed !== null && recomputed <= MIN_POSITIVE_EV_PCT) reasons.push('R9_ROBUST_NET_EV_NON_POSITIVE');
  if (reported !== null && reported <= MIN_POSITIVE_EV_PCT) reasons.push('R9_REPORTED_ROBUST_EV_NON_POSITIVE');
  if (reported !== null && recomputed !== null && Math.abs(reported - recomputed) > MAX_EV_REPLAY_DELTA_PP + 1e-9)
    reasons.push('R9_ROBUST_EV_REPLAY_MISMATCH');
  const v15=validV15Proof(input.r15RiskProof);
  if (input.r15Policy === V15_POLICY && !v15) reasons.push('R15_RISK_PROOF_MISSING_OR_INVALID');
  if (/INATTENDIBILE|PRIOR_ONLY|^PRIOR$/.test(dataClass) && !v15) reasons.push('R9_DATA_CLASS_RELIABILITY_VETO');
  const status = String(guard.status || '').trim().toUpperCase();
  if (!v15 && (status === 'RELIABILITY_GUARD_NO_STAKE' || (Object.hasOwn(guard, 'stakeMultiplier') && finite(guard.stakeMultiplier) === 0)))
    reasons.push('R9_RELIABILITY_GUARD_VETO');
  return { version:VERSION, ok:reasons.length===0, reasons, robustProbabilityPct:p, netExecutableOdd:odd,
    reportedRobustEvPct:reported, recomputedRobustNetEvPct:round(recomputed),
    evReplayDeltaPp:reported !== null && recomputed !== null ? round(reported-recomputed) : null,
    dataClass:dataClass || null, guardStatus:status || null, realMoneyAuthority:false };
}
function evaluatePersistedRow(row = {}) {
  const authority = parse(row.calcio_stake_authority_audit);
  const quality = parse(row.calcio_data_quality_audit);
  const guard = parse(row.calcio_reliability_guard_audit);
  const effectiveGuard = { ...guard, status: guard.status || row.calcio_reliability_guard_status || '',
    stakeMultiplier: guard.stakeMultiplier ?? row.calcio_reliability_stake_multiplier };
  const chosenOdd = finite(row.calcio_net_executable_odd) ?? finite(authority.netExecutableOdd) ?? finite(row.odd);
  const result = evaluate({
    robustProbabilityPct: finite(row.calcio_robust_probability) ?? finite(authority.robustProbabilityPct) ?? finite(guard.robustProbabilityPct),
    robustEvPct: finite(row.calcio_robust_ev_pct) ?? finite(authority.robustEvPct) ?? finite(guard.robustEvPct),
    netExecutableOdd: chosenOdd,
    dataClass: quality.evidence?.dataClass ?? row.calcio_data_class ?? row.stake_confidence_level ?? '',
    reliabilityGuard: effectiveGuard,
    r15RiskProof: authority.policy===V15_POLICY ? authority.r15RiskProof : null,
    r15Policy: authority.policy===V15_POLICY ? V15_POLICY : null
  });
  const reasons = result.reasons.slice();
  if (authority.policy === V15_POLICY && (Number(row.calcio_odds_certified) !== 1 || Number(row.calcio_odds_operational_eligible) !== 1)) reasons.push('R15_PERSISTED_ODDS_PROOF_MISSING');
  // R14: V15 is an independent conservative edge/Kelly authority. R9.evaluate()
  // intentionally accepts a fully validated V15 proof without legacy guard
  // status/multiplier. Apply the same rule when replaying persisted rows:
  // missing legacy guard is still a veto for *every other* authority path.
  const v15Approved = authority.policy === V15_POLICY && validV15Proof(authority.r15RiskProof)
     && authority.paperOnly === true && authority.eligible === true
     && authority.operationalAuthority === 'EXCLUSIVE_STAKE_AMOUNT_AUTHORITY'
     && Number(row.calcio_odds_certified) === 1 && Number(row.calcio_odds_operational_eligible) === 1;
  if ((!effectiveGuard.status || finite(effectiveGuard.stakeMultiplier) === null) && !v15Approved)
    reasons.push('R9_RELIABILITY_GUARD_PROOF_MISSING');
  const authorityOdd = finite(authority.netExecutableOdd);
  const storedNetOdd = finite(row.calcio_net_executable_odd);
  if (authorityOdd !== null && storedNetOdd !== null && Math.abs(authorityOdd-storedNetOdd) > 0.001) reasons.push('R9_AUTHORITY_NET_ODD_MISMATCH');
  if (authority.eligible !== true || authority.operationalAuthority !== 'EXCLUSIVE_STAKE_AMOUNT_AUTHORITY') reasons.push('R9_AUTHORITY_NOT_ELIGIBLE');
  // A blocked quality grade is allowable only for a PF paper row that has its proof flag,
  // but the conservative EV/data/guard invariant above remains mandatory.
  if ((quality.blocking === true || Number(row.calcio_data_quality_blocking) === 1) && !(authority.policy === 'PF_PAPER_EXPLORATORY_MAIN' &&
      authority.pfEvidenceGatePassed === true && quality.pfPaperQualified === true) && !v15Approved) reasons.push('R9_QUALITY_BLOCKED');
  return { ...result, ok:reasons.length===0, reasons, authorityPolicy:authority.policy || null };
}
module.exports = { V15_POLICY, validV15Proof, VERSION, MAX_EV_REPLAY_DELTA_PP, MIN_POSITIVE_EV_PCT, finite, evaluate, evaluatePersistedRow };
