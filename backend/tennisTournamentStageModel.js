'use strict';

const driftAuthority = require('./tennisTourDriftAuthorityPatch36');

const TENNIS_TOURNAMENT_STAGE_MODEL_VERSION = 'TENNIS_TOURNAMENT_STAGE_MODEL_V2_PATCH36';

const ROUND_ORDER = Object.freeze({
  Q1: 0, Q2: 0, Q3: 0, Q: 0,
  R128: 1, R64: 2, R32: 3, R16: 4,
  QF: 5, SF: 6, F: 7, RR: 3, UNKNOWN: -1
});

const STAGE_PROFILES = Object.freeze({
  QUALIFYING: Object.freeze({ pressureIndex: 0.10, maxAdjustmentPp: 0.8, confidencePenalty: 1 }),
  EARLY: Object.freeze({ pressureIndex: 0.15, maxAdjustmentPp: 1.0, confidencePenalty: 1 }),
  MID: Object.freeze({ pressureIndex: 0.30, maxAdjustmentPp: 1.4, confidencePenalty: 2 }),
  QUARTERFINAL: Object.freeze({ pressureIndex: 0.55, maxAdjustmentPp: 2.0, confidencePenalty: 4 }),
  SEMIFINAL: Object.freeze({ pressureIndex: 0.75, maxAdjustmentPp: 2.8, confidencePenalty: 7 }),
  FINAL: Object.freeze({ pressureIndex: 0.95, maxAdjustmentPp: 3.6, confidencePenalty: 10 }),
  UNKNOWN: Object.freeze({ pressureIndex: 0.25, maxAdjustmentPp: 0.8, confidencePenalty: 3 })
});

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }
function round(value, decimals = 4) {
  const number = finite(value, 0);
  return Number(number.toFixed(decimals));
}

function normalizeTournamentRound(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';
  const text = raw
    .replace(/[ÀÁÂÃÄÅ]/g, 'A')
    .replace(/[ÈÉÊË]/g, 'E')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

  if (/\b(FINAL|FINALE|CHAMPIONSHIP MATCH)\b/.test(text) && !/SEMI/.test(text)) return 'F';
  if (/\b(SF|SEMI FINAL|SEMIFINAL|SEMIFINALE)\b/.test(text)) return 'SF';
  if (/\b(QF|QUARTER FINAL|QUARTERFINAL|QUARTI)\b/.test(text)) return 'QF';
  if (/\b(R16|ROUND OF 16|OTTAVI|LAST 16)\b/.test(text)) return 'R16';
  if (/\b(R32|ROUND OF 32|TRENTADUESIMI|LAST 32)\b/.test(text)) return 'R32';
  if (/\b(R64|ROUND OF 64|LAST 64)\b/.test(text)) return 'R64';
  if (/\b(R128|ROUND OF 128|LAST 128)\b/.test(text)) return 'R128';
  if (/\b(RR|ROUND ROBIN|GROUP STAGE|GIRONE)\b/.test(text)) return 'RR';
  if (/\b(Q3|QUALIFYING 3|QUALIFICATION 3)\b/.test(text)) return 'Q3';
  if (/\b(Q2|QUALIFYING 2|QUALIFICATION 2)\b/.test(text)) return 'Q2';
  if (/\b(Q1|QUALIFYING 1|QUALIFICATION 1)\b/.test(text)) return 'Q1';
  if (/\b(Q|QUALIFYING|QUALIFICATION|QUALIFICAZIONI)\b/.test(text)) return 'Q';

  const compact = text.replace(/\s+/g, '');
  return Object.prototype.hasOwnProperty.call(ROUND_ORDER, compact) ? compact : 'UNKNOWN';
}

function roundStage(round) {
  const canonical = normalizeTournamentRound(round);
  if (['Q', 'Q1', 'Q2', 'Q3'].includes(canonical)) return 'QUALIFYING';
  if (['R128', 'R64'].includes(canonical)) return 'EARLY';
  if (['R32', 'R16', 'RR'].includes(canonical)) return 'MID';
  if (canonical === 'QF') return 'QUARTERFINAL';
  if (canonical === 'SF') return 'SEMIFINAL';
  if (canonical === 'F') return 'FINAL';
  return 'UNKNOWN';
}

function getStageProfile(round) {
  const canonicalRound = normalizeTournamentRound(round);
  const stage = roundStage(canonicalRound);
  return {
    canonicalRound,
    stage,
    roundOrder: ROUND_ORDER[canonicalRound] ?? -1,
    isLateRound: ['QF', 'SF', 'F'].includes(canonicalRound),
    ...STAGE_PROFILES[stage]
  };
}

function empiricalBayesRate(wins, sample, priorRate = 0.5, priorStrength = 8) {
  const n = Math.max(0, finite(sample, 0));
  const w = clamp(finite(wins, 0), 0, n);
  return (w + priorRate * priorStrength) / (n + priorStrength);
}

function buildRoundResilience(evidence = {}) {
  const lateSample = Math.max(0, finite(evidence.lateRoundSample, 0));
  const lateWinRate = finite(evidence.lateRoundWinRate, null);
  const vsExpected = finite(evidence.lateRoundPerformanceVsExpected, null);
  const semifinalSample = Math.max(0, finite(evidence.semifinalPlusSample, 0));
  const finalSample = Math.max(0, finite(evidence.finalSample, 0));

  const adjustedRate = lateWinRate === null
    ? 0.5
    : empiricalBayesRate(lateWinRate * lateSample, lateSample, 0.5, 8);
  const expectedLift = vsExpected === null ? 0 : clamp(vsExpected, -0.25, 0.25);
  const sampleReliability = clamp(Math.sqrt(lateSample / 18), 0, 1);
  const deepRoundReliability = clamp((Math.sqrt(semifinalSample / 10) + Math.sqrt(finalSample / 6)) / 2, 0, 1);
  const resilienceScore = clamp(50 + (adjustedRate - 0.5) * 70 + expectedLift * 70, 20, 80);

  return {
    sample: lateSample,
    winRate: lateWinRate,
    adjustedWinRate: round(adjustedRate, 4),
    performanceVsExpected: vsExpected,
    semifinalPlusSample: semifinalSample,
    finalSample,
    sampleReliability: round(sampleReliability, 4),
    deepRoundReliability: round(deepRoundReliability, 4),
    resilienceScore: round(resilienceScore, 2),
    usable: lateSample >= 3 && lateWinRate !== null
  };
}

function metricSummary(rows = []) {
  const valid = rows.filter(row => Number.isFinite(Number(row.production_probability_p1)) && [1, 2].includes(Number(row.actual_winner_side)));
  if (!valid.length) return { rows: 0, accuracyPct: null, brier: null };
  let correct = 0;
  let brier = 0;
  for (const row of valid) {
    const p1 = clamp(Number(row.production_probability_p1), 0.001, 0.999);
    const actualP1 = Number(row.actual_winner_side) === 1 ? 1 : 0;
    const predicted = p1 >= 0.5 ? 1 : 2;
    if (predicted === Number(row.actual_winner_side)) correct += 1;
    brier += (p1 - actualP1) ** 2;
  }
  return {
    rows: valid.length,
    accuracyPct: round(correct / valid.length * 100, 2),
    brier: round(brier / valid.length, 6)
  };
}

function evaluateRecentPerformance(rows = [], options = {}) {
  const recentSize = Math.max(20, Math.round(finite(options.recentSize, 60)));
  const previousSize = Math.max(40, Math.round(finite(options.previousSize, 120)));
  const sorted = [...rows].sort((a, b) => String(a.match_start_at || '').localeCompare(String(b.match_start_at || '')) || Number(a.bet_id || 0) - Number(b.bet_id || 0));
  const recentRows = sorted.slice(-recentSize);
  const priorRows = sorted.slice(Math.max(0, sorted.length - recentSize - previousSize), Math.max(0, sorted.length - recentSize));
  const recent = metricSummary(recentRows);
  const previous = metricSummary(priorRows);
  const accuracyDropPp = recent.accuracyPct === null || previous.accuracyPct === null ? null : round(previous.accuracyPct - recent.accuracyPct, 2);
  const brierWorsening = recent.brier === null || previous.brier === null ? null : round(recent.brier - previous.brier, 6);
  const degradationActive = recent.rows >= 20 && previous.rows >= 40 && (
    (accuracyDropPp !== null && accuracyDropPp >= 8) ||
    (brierWorsening !== null && brierWorsening >= 0.02)
  );
  let severity = 'NONE';
  if (degradationActive) {
    const score = Math.max(accuracyDropPp || 0, (brierWorsening || 0) * 300);
    severity = score >= 16 ? 'HIGH' : score >= 10 ? 'MEDIUM' : 'LOW';
  }
  return {
    version: TENNIS_TOURNAMENT_STAGE_MODEL_VERSION,
    recent,
    previous,
    recentSize,
    previousSize,
    accuracyDropPp,
    brierWorsening,
    degradationActive,
    severity,
    hardExclusion: false,
    policy: 'SOFT_CONFIDENCE_AND_EXTREMITY_SHRINK_ONLY'
  };
}

function loadRecentPerformanceFromDb(db, options = {}) {
  return driftAuthority.loadFromDb(db, options);
}

function applyTournamentStageAdjustment(input = {}) {
  const baseProbabilityP1 = clamp(finite(input.baseProbabilityP1, 0.5), 0.02, 0.98);
  const profile = getStageProfile(input.round);
  const p1 = buildRoundResilience(input.player1Evidence || {});
  const p2 = buildRoundResilience(input.player2Evidence || {});
  const recent = input.recentPerformance || driftAuthority.buildReport([]);
  const driftDecision = driftAuthority.authorityForTour(recent, input.tour || 'ALL');

  const reliability = Math.min(p1.sampleReliability, p2.sampleReliability);
  const resilienceDiff = (p1.resilienceScore - p2.resilienceScore) / 100;
  let adjustmentPp = profile.isLateRound ? resilienceDiff * profile.maxAdjustmentPp * reliability : 0;
  adjustmentPp = clamp(adjustmentPp, -profile.maxAdjustmentPp, profile.maxAdjustmentPp);

  let adjusted = clamp(baseProbabilityP1 + adjustmentPp / 100, 0.02, 0.98);
  let degradationShrink = 0;
  if (driftDecision.probabilityAdjustmentAuthority) {
    const forwardSeverity = (driftDecision.tour === 'ALL'
      ? recent.forward?.overall?.severity
      : recent.forward?.byTour?.[driftDecision.tour]?.severity) || 'LOW';
    const severityFactor = forwardSeverity === 'HIGH' ? 0.10 : forwardSeverity === 'MEDIUM' ? 0.07 : 0.04;
    degradationShrink = severityFactor * (profile.isLateRound ? 1 : 0.55) * profile.pressureIndex;
    adjusted = 0.5 + (adjusted - 0.5) * (1 - degradationShrink);
  }

  const stageEvidenceAvailable = profile.isLateRound && p1.usable && p2.usable;
  const diagnosticConfidencePenalty = recent.confidenceAdjustmentAuthority === true || recent.degradationActive === true
    ? (profile.isLateRound ? 6 : 3)
    : 0;
  const confidencePenalty = profile.confidencePenalty + diagnosticConfidencePenalty + (profile.isLateRound && !stageEvidenceAvailable ? 4 : 0);

  return {
    version: TENNIS_TOURNAMENT_STAGE_MODEL_VERSION,
    profile,
    player1Resilience: p1,
    player2Resilience: p2,
    baseProbabilityP1: round(baseProbabilityP1, 6),
    stageAdjustmentPp: round(adjustmentPp, 4),
    degradationShrink: round(degradationShrink, 4),
    adjustedProbabilityP1: round(clamp(adjusted, 0.02, 0.98), 6),
    adjustedProbabilityP2: round(1 - clamp(adjusted, 0.02, 0.98), 6),
    confidencePenalty: round(confidencePenalty, 2),
    stageEvidenceAvailable,
    lateRoundRiskIntegrated: profile.isLateRound,
    recentPerformance: recent,
    driftAuthority: driftDecision,
    hardVeto: false,
    hardExclusion: false,
    recommendationPolicy: 'ALWAYS_RETURN_BEST_AVAILABLE_FORECAST_WITH_CONFIDENCE_LABEL',
    probabilityMutationPolicy: driftDecision.probabilityAdjustmentAuthority
      ? 'FORWARD_CERTIFIED_BOUNDED_SHRINK'
      : 'RETROSPECTIVE_DIAGNOSTIC_CONFIDENCE_ONLY'
  };
}

module.exports = {
  TENNIS_TOURNAMENT_STAGE_MODEL_VERSION,
  ROUND_ORDER,
  STAGE_PROFILES,
  normalizeTournamentRound,
  roundStage,
  getStageProfile,
  empiricalBayesRate,
  buildRoundResilience,
  evaluateRecentPerformance,
  loadRecentPerformanceFromDb,
  applyTournamentStageAdjustment
};
