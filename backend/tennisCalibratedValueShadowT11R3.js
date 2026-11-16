'use strict';

const VERSION = 'AUDIT16D_R3_T11_R3_CALIBRATED_VALUE_SHADOW_V1';
const MODE = 'SHADOW_CALIBRATED_VALUE_NO_PRODUCTION_AUTHORITY';
const NUMERIC_BREAK_EVEN_EPSILON_PP = 0.05; // display/numerical tie only; not a betting threshold.

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, digits = 4) {
  const n = finite(value, null);
  if (n === null) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
function upper(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
function normalizeMarketType(value) {
  const x = upper(value);
  if (x.includes('TOTAL')) return 'TOTALS';
  if (x.includes('MONEY') || x === '' || x === 'H2H') return 'MONEYLINE';
  return x || 'UNKNOWN';
}
function classifyValueDirection(edgePp) {
  const e = finite(edgePp, null);
  if (e === null) return 'UNAVAILABLE';
  if (Math.abs(e) <= NUMERIC_BREAK_EVEN_EPSILON_PP) return 'NEAR_BREAK_EVEN';
  return e > 0 ? 'POSITIVE' : 'NEGATIVE';
}
function classifyCiRelation(lowPct, highPct, breakEvenPct) {
  const lo = finite(lowPct, null), hi = finite(highPct, null), be = finite(breakEvenPct, null);
  if (lo === null || hi === null || be === null) return 'CI_UNAVAILABLE';
  if (lo > be) return 'CI_ABOVE_BREAK_EVEN';
  if (hi < be) return 'CI_BELOW_BREAK_EVEN';
  return 'CI_STRADDLES_BREAK_EVEN';
}
function compareProduction(finalStake, valueDirection) {
  const stake = Math.max(0, finite(finalStake, 0));
  if (valueDirection === 'UNAVAILABLE') return { comparisonClass:'CALIBRATED_NEUTRAL', direction:'SHADOW_UNAVAILABLE' };
  if (valueDirection === 'NEAR_BREAK_EVEN') return { comparisonClass:'CALIBRATED_NEUTRAL', direction:stake > 0 ? 'EXECUTABLE_NEAR_BREAK_EVEN' : 'ZERO_STAKE_NEAR_BREAK_EVEN' };
  if (stake > 0 && valueDirection === 'POSITIVE') return { comparisonClass:'CALIBRATED_SUPPORT', direction:'SHADOW_POSITIVE_EXECUTABLE_STAKE' };
  if (stake <= 0 && valueDirection === 'NEGATIVE') return { comparisonClass:'CALIBRATED_SUPPORT', direction:'SHADOW_NEGATIVE_ZERO_STAKE' };
  if (stake > 0 && valueDirection === 'NEGATIVE') return { comparisonClass:'CALIBRATED_CONTRADICTION', direction:'SHADOW_NEGATIVE_EXECUTABLE_STAKE' };
  if (stake <= 0 && valueDirection === 'POSITIVE') return { comparisonClass:'CALIBRATED_CONTRADICTION', direction:'SHADOW_POSITIVE_ZERO_STAKE' };
  return { comparisonClass:'CALIBRATED_NEUTRAL', direction:'UNCLASSIFIED' };
}
function build(trace = {}) {
  const rel = trace?.aiReliabilityShadow || {};
  const marketType = normalizeMarketType(rel.marketType || trace.marketType);
  const odd = finite(trace.odd, null);
  const finalStake = Math.max(0, finite(trace?.analysis?.stakes?.patch46, 0));
  if (marketType !== 'MONEYLINE') {
    return { version:VERSION, mode:MODE, available:false, marketType, reason:'TOTALS_OR_NON_MONEYLINE_CALIBRATED_VALUE_NOT_CERTIFIED', finalExecutableStake:round(finalStake,2), authority:{stake:false,qualityGate:false,probabilityProduction:false,thresholdProduction:false} };
  }
  if (!(odd > 1)) {
    return { version:VERSION, mode:MODE, available:false, marketType, reason:'ODD_UNAVAILABLE_OR_INVALID', finalExecutableStake:round(finalStake,2), authority:{stake:false,qualityGate:false,probabilityProduction:false,thresholdProduction:false} };
  }
  if (rel.available !== true || !Number.isFinite(Number(rel.aiReliabilityPct))) {
    return { version:VERSION, mode:MODE, available:false, marketType, reason:rel.reason || 'AI_RELIABILITY_SHADOW_UNAVAILABLE', finalExecutableStake:round(finalStake,2), authority:{stake:false,qualityGate:false,probabilityProduction:false,thresholdProduction:false} };
  }
  const pWinPct = Number(rel.aiReliabilityPct);
  const breakEvenPct = 100 / odd;
  const calibratedEdgePp = pWinPct - breakEvenPct;
  const calibratedEvPct = ((pWinPct / 100) * odd - 1) * 100;
  const ciLow = finite(rel.ci95LowPct, null), ciHigh = finite(rel.ci95HighPct, null);
  const ciLowEdge = ciLow === null ? null : ciLow - breakEvenPct;
  const ciHighEdge = ciHigh === null ? null : ciHigh - breakEvenPct;
  const valueDirection = classifyValueDirection(calibratedEdgePp);
  const production = compareProduction(finalStake, valueDirection);
  const rawProb = finite(rel.rawModelProbabilityPct ?? trace.estimatedProb, null);
  const rawEdge = finite(trace.edgePp, null);
  const rawEv = finite(trace.evPct, null);
  return {
    version: VERSION,
    mode: MODE,
    available: true,
    shadowOnly: true,
    marketType,
    odd: round(odd, 4),
    pWinShadowPct: round(pWinPct, 2),
    pWinCi95LowPct: round(ciLow, 2),
    pWinCi95HighPct: round(ciHigh, 2),
    breakEvenProbabilityPct: round(breakEvenPct, 2),
    calibratedEdgePp: round(calibratedEdgePp, 2),
    calibratedEvPct: round(calibratedEvPct, 2),
    calibratedCiEdgeLowPp: round(ciLowEdge, 2),
    calibratedCiEdgeHighPp: round(ciHighEdge, 2),
    ciRelationship: classifyCiRelation(ciLow, ciHigh, breakEvenPct),
    valueDirection,
    comparisonClass: production.comparisonClass,
    comparisonDirection: production.direction,
    finalExecutableStake: round(finalStake, 2),
    rawModelProbabilityPct: round(rawProb, 2),
    rawEdgePp: round(rawEdge, 2),
    rawEvPct: round(rawEv, 2),
    probabilityCalibrationDeltaPp: rawProb === null ? null : round(pWinPct - rawProb, 2),
    tradingEvidence: rel.bayesianTradingUpdate || null,
    priorSensitivityRangePp: finite(rel.sensitivityRangePp, null),
    stableToPriorStrength: rel.stableToPriorStrength === true,
    authority: { stake:false, qualityGate:false, probabilityProduction:false, thresholdProduction:false, automaticPromotion:false },
    note: 'Shadow calibrated value = P(win) shadow versus bookmaker break-even probability. Research only; no production gate/stake authority.'
  };
}
function inspect(traceReport = {}) {
  const traces = Array.isArray(traceReport.traces) ? traceReport.traces : [];
  const rows = traces.map(trace => ({ betId:trace.betId, match:trace.match, prediction:trace.prediction, ...build(trace) }));
  const count = key => rows.filter(row => row.available === true && row.comparisonClass === key).length;
  return {
    success:true, version:VERSION, mode:MODE, readOnly:true,
    sourceTraceVersion:traceReport.version || null,
    rows,
    summary:{ total:rows.length, available:rows.filter(r=>r.available).length, support:count('CALIBRATED_SUPPORT'), neutral:count('CALIBRATED_NEUTRAL'), contradiction:count('CALIBRATED_CONTRADICTION'), totalsOrUnavailable:rows.filter(r=>!r.available).length },
    authority:{stakeChange:false,qualityGateChange:false,probabilityProductionChange:false,thresholdProductionChange:false,automaticPromotion:false},
    generatedAt:new Date().toISOString()
  };
}
module.exports = { VERSION, MODE, NUMERIC_BREAK_EVEN_EPSILON_PP, build, inspect, classifyValueDirection, classifyCiRelation, compareProduction };
