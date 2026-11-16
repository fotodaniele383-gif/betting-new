'use strict';

const CALCIO_RELIABILITY_CALIBRATION_VERSION = 'BETTING_PATCH_26F_D_RELIABILITY_CALIBRATION_V1';

const BANDS = Object.freeze([
  Object.freeze({ key: 'VERY_LOW', min: 0, max: 39.999, label: 'MOLTO BASSA' }),
  Object.freeze({ key: 'LOW', min: 40, max: 54.999, label: 'BASSA' }),
  Object.freeze({ key: 'MEDIUM', min: 55, max: 69.999, label: 'MEDIA' }),
  Object.freeze({ key: 'GOOD', min: 70, max: 84.999, label: 'BUONA' }),
  Object.freeze({ key: 'HIGH', min: 85, max: 100, label: 'ALTA' })
]);

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function normalizeLabel(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function bandForScore(score) {
  const n = finite(score, null);
  if (n === null) return null;
  return BANDS.find(band => n >= band.min && n <= band.max) || BANDS[BANDS.length - 1];
}

function resolveDeclaredReliability(row = {}) {
  const finalSnapshot = parseObject(row.calcio_final_market_snapshot);
  const finalConfidence = finalSnapshot?.forecastConfidence || null;
  const dualAudit = parseObject(row.calcio_dual_score_audit);
  const sources = [
    { source: 'PREDICTION_RELIABILITY_FINAL', score: finite(row.calcio_prediction_reliability_score, null), label: row.calcio_prediction_reliability_label },
    { source: 'FINAL_MARKET_FORECAST_CONFIDENCE', score: finite(finalConfidence?.score, null), label: finalConfidence?.label },
    { source: 'DUAL_SCORE_FORECAST_CONFIDENCE_SHADOW', score: finite(row.calcio_forecast_confidence_score, finite(row.calcio_forecast_confidence_shadow, finite(dualAudit?.forecastConfidenceScore, null))), label: row.calcio_forecast_confidence_label || dualAudit?.label }
  ];
  const selected = sources.find(item => item.score !== null && item.score >= 0 && item.score <= 100) || null;
  if (!selected) return { available: false, score: null, label: 'N/D', source: 'ABSENT', band: null };
  const band = bandForScore(selected.score);
  return {
    available: true,
    score: Number(selected.score.toFixed(2)),
    label: normalizeLabel(selected.label) || band?.label.replace(' ', '_') || 'N/D',
    source: selected.source,
    band
  };
}

function probabilityForRow(row = {}) {
  const values = [row.estimated_prob, row.estimatedProb, row.probability, row.prob];
  for (const value of values) {
    const n = finite(value, null);
    if (n !== null && n >= 0 && n <= 100) return n;
  }
  const snapshot = parseObject(row.calcio_final_market_snapshot);
  const n = finite(snapshot?.probabilityPct, finite(snapshot?.probability?.finalProbabilityPct, null));
  return n !== null && n >= 0 && n <= 100 ? n : null;
}

function isResolved(row = {}) {
  return ['WON', 'LOST'].includes(String(row.status || '').toUpperCase());
}

function isPending(row = {}) {
  return String(row.status || '').toUpperCase() === 'PENDING';
}

function wilsonInterval(won, total, z = 1.959963984540054) {
  if (!total) return { lowPct: null, highPct: null };
  const p = won / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denom;
  return {
    lowPct: Number((Math.max(0, center - margin) * 100).toFixed(2)),
    highPct: Number((Math.min(1, center + margin) * 100).toFixed(2))
  };
}

function sampleValidationConfidence(resolved) {
  if (!resolved) return 0;
  return Number(Math.min(100, (resolved / 30) * 100).toFixed(1));
}

function validationStatus(resolved, absCalibrationGapPp, brier) {
  if (!resolved) return { code: 'NOT_VALIDATED_NO_OUTCOMES', label: 'NON VALIDATA · NESSUN ESITO' };
  if (resolved < 5) return { code: 'OBSERVATION_ONLY', label: 'SOLO OSSERVAZIONE' };
  if (resolved < 15) return { code: 'PRELIMINARY_LOW_SAMPLE', label: 'PRELIMINARE · SAMPLE BASSO' };
  if (absCalibrationGapPp !== null && absCalibrationGapPp > 15) return { code: 'REVIEW_REQUIRED', label: 'DA RIVEDERE' };
  if (resolved >= 30 && absCalibrationGapPp !== null && absCalibrationGapPp <= 5 && (brier === null || brier <= 0.22)) {
    return { code: 'EMPIRICALLY_COHERENT', label: 'COERENTE' };
  }
  if (absCalibrationGapPp !== null && absCalibrationGapPp <= 8) return { code: 'PRELIMINARY_COHERENT', label: 'COERENTE PRELIMINARE' };
  return { code: 'VALIDATION_IN_PROGRESS', label: 'VALIDAZIONE IN CORSO' };
}

function emptyAccumulator(band) {
  return {
    bandKey: band.key,
    bandLabel: band.label,
    bandMin: band.min,
    bandMax: band.max,
    signals: 0,
    pending: 0,
    resolved: 0,
    won: 0,
    lost: 0,
    reliabilitySum: 0,
    probabilitySum: 0,
    probabilityCount: 0,
    brierSum: 0,
    brierCount: 0,
    sourceCounts: {}
  };
}

function buildReliabilityCalibration(rows = [], options = {}) {
  const accumulators = new Map(BANDS.map(band => [band.key, emptyAccumulator(band)]));
  let scoredRows = 0;
  let pendingScoredRows = 0;
  let resolvedScoredRows = 0;
  let rowsWithoutScore = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const reliability = resolveDeclaredReliability(row);
    if (!reliability.available || !reliability.band) {
      rowsWithoutScore += 1;
      continue;
    }
    scoredRows += 1;
    const acc = accumulators.get(reliability.band.key);
    acc.signals += 1;
    acc.reliabilitySum += reliability.score;
    acc.sourceCounts[reliability.source] = (acc.sourceCounts[reliability.source] || 0) + 1;
    if (isPending(row)) {
      acc.pending += 1;
      pendingScoredRows += 1;
    }
    if (isResolved(row)) {
      const won = String(row.status || '').toUpperCase() === 'WON';
      acc.resolved += 1;
      acc.won += won ? 1 : 0;
      acc.lost += won ? 0 : 1;
      resolvedScoredRows += 1;
      const probabilityPct = probabilityForRow(row);
      if (probabilityPct !== null) {
        acc.probabilitySum += probabilityPct;
        acc.probabilityCount += 1;
        const p = probabilityPct / 100;
        const y = won ? 1 : 0;
        acc.brierSum += (p - y) ** 2;
        acc.brierCount += 1;
      }
    }
  }

  const bands = BANDS.map(band => {
    const acc = accumulators.get(band.key);
    const avgDeclaredReliabilityPct = acc.signals ? acc.reliabilitySum / acc.signals : null;
    const hitRatePct = acc.resolved ? (acc.won / acc.resolved) * 100 : null;
    const avgForecastProbabilityPct = acc.probabilityCount ? acc.probabilitySum / acc.probabilityCount : null;
    const calibrationGapPp = hitRatePct !== null && avgForecastProbabilityPct !== null ? hitRatePct - avgForecastProbabilityPct : null;
    const brier = acc.brierCount ? acc.brierSum / acc.brierCount : null;
    const interval = wilsonInterval(acc.won, acc.resolved);
    const status = validationStatus(acc.resolved, calibrationGapPp === null ? null : Math.abs(calibrationGapPp), brier);
    return {
      bandKey: acc.bandKey,
      bandLabel: acc.bandLabel,
      bandMin: acc.bandMin,
      bandMax: acc.bandMax,
      bandRange: `${Math.round(acc.bandMin)}–${Math.floor(acc.bandMax)}`,
      signals: acc.signals,
      pending: acc.pending,
      resolved: acc.resolved,
      won: acc.won,
      lost: acc.lost,
      avgDeclaredReliabilityPct: avgDeclaredReliabilityPct === null ? null : Number(avgDeclaredReliabilityPct.toFixed(2)),
      hitRatePct: hitRatePct === null ? null : Number(hitRatePct.toFixed(2)),
      hitRateCi95: interval,
      avgForecastProbabilityPct: avgForecastProbabilityPct === null ? null : Number(avgForecastProbabilityPct.toFixed(2)),
      calibrationGapPp: calibrationGapPp === null ? null : Number(calibrationGapPp.toFixed(2)),
      brier: brier === null ? null : Number(brier.toFixed(4)),
      validationConfidencePct: sampleValidationConfidence(acc.resolved),
      validationStatus: status.code,
      validationLabel: status.label,
      sourceCounts: acc.sourceCounts
    };
  });

  const nonEmptyResolvedBands = bands.filter(item => item.resolved > 0);
  let monotonicity = 'NOT_EVALUABLE';
  if (nonEmptyResolvedBands.length >= 3 && nonEmptyResolvedBands.every(item => item.brier !== null)) {
    const ordered = nonEmptyResolvedBands.slice().sort((a, b) => a.bandMin - b.bandMin);
    let improvements = 0;
    for (let i = 1; i < ordered.length; i += 1) if (ordered[i].brier <= ordered[i - 1].brier) improvements += 1;
    monotonicity = improvements === ordered.length - 1 ? 'COHERENT' : improvements >= Math.ceil((ordered.length - 1) / 2) ? 'MIXED' : 'NOT_COHERENT';
  }

  return {
    version: CALCIO_RELIABILITY_CALIBRATION_VERSION,
    semantics: 'EVIDENCE_AND_FORECAST_STRENGTH_NOT_WIN_PROBABILITY',
    shadowOnly: true,
    stakeAuthority: false,
    scoreAuthorityChanged: false,
    scoredRows,
    pendingScoredRows,
    resolvedScoredRows,
    rowsWithoutScore,
    validationCoveragePct: scoredRows ? Number(((resolvedScoredRows / scoredRows) * 100).toFixed(2)) : 0,
    empiricalStatus: resolvedScoredRows === 0 ? 'NOT_VALIDATED_NO_RESOLVED_CALCIO_ROWS' : resolvedScoredRows < 15 ? 'PRELIMINARY_LOW_SAMPLE' : 'EMPIRICAL_VALIDATION_ACTIVE',
    monotonicity,
    bands,
    note: 'L’affidabilità AI misura la solidità delle evidenze e del forecast; non è la probabilità di vincita. La validazione usa esiti reali, calibrazione della probabilità e Brier per fascia.'
  };
}

module.exports = {
  CALCIO_RELIABILITY_CALIBRATION_VERSION,
  BANDS,
  bandForScore,
  resolveDeclaredReliability,
  probabilityForRow,
  wilsonInterval,
  buildReliabilityCalibration
};
