'use strict';

const VERSION = 'TENNIS_TOUR_DRIFT_AUTHORITY_V1_PATCH36';
const POLICY_VERSION = 'TENNIS_RETROSPECTIVE_FORWARD_AUTHORITY_SEPARATION_V1_PATCH36';
const MIN_FORWARD_RECENT = 30;
const MIN_FORWARD_PREVIOUS = 60;
const MIN_FORWARD_TOUR_ROWS = 30;
const MIN_FORWARD_OVERALL_ROWS = 60;

function finite(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }
function round(value, decimals = 4) { const n = finite(value, 0); return Number(n.toFixed(decimals)); }
function normalizeTour(value) { const text = String(value || '').toUpperCase(); return text.includes('WTA') ? 'WTA' : text.includes('ATP') ? 'ATP' : 'ALL'; }

function metricSummary(rows = []) {
  const valid = rows.filter(row => Number.isFinite(Number(row.production_probability_p1)) && [1, 2].includes(Number(row.actual_winner_side)));
  if (!valid.length) return { rows: 0, accuracyPct: null, brier: null, from: null, to: null };
  let correct = 0; let brier = 0;
  for (const row of valid) {
    const p1 = clamp(Number(row.production_probability_p1), 0.001, 0.999);
    const actualP1 = Number(row.actual_winner_side) === 1 ? 1 : 0;
    if ((p1 >= 0.5 ? 1 : 2) === Number(row.actual_winner_side)) correct += 1;
    brier += (p1 - actualP1) ** 2;
  }
  const dates = valid.map(row => String(row.match_start_at || '')).filter(Boolean).sort();
  return {
    rows: valid.length,
    accuracyPct: round(correct / valid.length * 100, 2),
    brier: round(brier / valid.length, 6),
    from: dates[0] || null,
    to: dates.at(-1) || null
  };
}

function evaluateWindow(rows = [], options = {}) {
  const recentSize = Math.max(1, Math.round(finite(options.recentSize, 60)));
  const previousSize = Math.max(1, Math.round(finite(options.previousSize, 120)));
  const minRecent = Math.max(1, Math.round(finite(options.minRecent, 20)));
  const minPrevious = Math.max(1, Math.round(finite(options.minPrevious, 40)));
  const sorted = [...rows].sort((a, b) => String(a.match_start_at || '').localeCompare(String(b.match_start_at || '')) || Number(a.bet_id || 0) - Number(b.bet_id || 0));
  const recentRows = sorted.slice(-recentSize);
  const previousRows = sorted.slice(Math.max(0, sorted.length - recentSize - previousSize), Math.max(0, sorted.length - recentSize));
  const recent = metricSummary(recentRows);
  const previous = metricSummary(previousRows);
  const accuracyDropPp = recent.accuracyPct === null || previous.accuracyPct === null ? null : round(previous.accuracyPct - recent.accuracyPct, 2);
  const brierWorsening = recent.brier === null || previous.brier === null ? null : round(recent.brier - previous.brier, 6);
  const sampleMature = recent.rows >= minRecent && previous.rows >= minPrevious;
  const degradationActive = sampleMature && ((accuracyDropPp !== null && accuracyDropPp >= 8) || (brierWorsening !== null && brierWorsening >= 0.02));
  let severity = 'NONE';
  if (degradationActive) {
    const score = Math.max(accuracyDropPp || 0, (brierWorsening || 0) * 300);
    severity = score >= 16 ? 'HIGH' : score >= 10 ? 'MEDIUM' : 'LOW';
  }
  return { recent, previous, recentSize, previousSize, minRecent, minPrevious, sampleMature, accuracyDropPp, brierWorsening, degradationActive, severity };
}

function analyzeChannel(rows = [], mode = 'RETROSPECTIVE_AS_OF_SAFE') {
  const normalized = rows.filter(row => String(row.evaluation_mode || mode) === mode);
  const options = mode === 'FORWARD_CERTIFIED'
    ? { recentSize: MIN_FORWARD_RECENT, previousSize: MIN_FORWARD_PREVIOUS, minRecent: MIN_FORWARD_RECENT, minPrevious: MIN_FORWARD_PREVIOUS }
    : { recentSize: 60, previousSize: 120, minRecent: 20, minPrevious: 40 };
  const byTour = {};
  for (const tour of ['ATP', 'WTA']) byTour[tour] = evaluateWindow(normalized.filter(row => normalizeTour(row.tour) === tour), options);
  return {
    mode,
    rows: normalized.length,
    overall: evaluateWindow(normalized, options),
    byTour
  };
}

function buildReport(rows = [], options = {}) {
  const retrospective = analyzeChannel(rows, 'RETROSPECTIVE_AS_OF_SAFE');
  const forward = analyzeChannel(rows, 'FORWARD_CERTIFIED');
  const forwardTourMature = Object.fromEntries(['ATP', 'WTA'].map(tour => [tour, forward.byTour[tour].recent.rows + forward.byTour[tour].previous.rows >= MIN_FORWARD_TOUR_ROWS]));
  const forwardOverallMature = forward.rows >= MIN_FORWARD_OVERALL_ROWS && forward.overall.sampleMature;
  const probabilityAdjustmentAuthority = forwardOverallMature && forward.overall.degradationActive;
  const compatibility = retrospective.overall;
  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    retrospective,
    forward,
    recent: compatibility.recent,
    previous: compatibility.previous,
    recentSize: compatibility.recentSize,
    previousSize: compatibility.previousSize,
    accuracyDropPp: compatibility.accuracyDropPp,
    brierWorsening: compatibility.brierWorsening,
    degradationActive: compatibility.degradationActive,
    severity: compatibility.severity,
    diagnosticChannel: 'RETROSPECTIVE_AS_OF_SAFE',
    confidenceAdjustmentAuthority: compatibility.degradationActive,
    probabilityAdjustmentAuthority,
    probabilityAuthoritySource: probabilityAdjustmentAuthority ? 'FORWARD_CERTIFIED_MATURE' : 'NONE',
    forwardOverallMature,
    forwardTourMature,
    hardExclusion: false,
    policy: probabilityAdjustmentAuthority
      ? 'FORWARD_CERTIFIED_BOUNDED_SHRINK_ALLOWED'
      : 'RETROSPECTIVE_DIAGNOSTIC_CONFIDENCE_ONLY_NO_PROBABILITY_MUTATION',
    authority: {
      retrospectiveDiagnostic: true,
      confidencePenalty: compatibility.degradationActive,
      probabilityAdjustment: probabilityAdjustmentAuthority,
      productionProbability: false,
      deepScanDecision: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      automaticPromotion: false
    },
    thresholds: {
      minForwardRecent: MIN_FORWARD_RECENT,
      minForwardPrevious: MIN_FORWARD_PREVIOUS,
      minForwardTourRows: MIN_FORWARD_TOUR_ROWS,
      minForwardOverallRows: MIN_FORWARD_OVERALL_ROWS
    }
  };
}

function loadFromDb(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') return buildReport([], options);
  try {
    const rows = db.prepare(`
      SELECT bet_id, match_start_at, actual_winner_side, production_probability_p1,
             evaluation_mode, UPPER(COALESCE(tour,'')) AS tour
      FROM tennis_historical_validation_evaluations
      WHERE evaluation_mode IN ('RETROSPECTIVE_AS_OF_SAFE','FORWARD_CERTIFIED')
      ORDER BY match_start_at ASC, bet_id ASC
    `).all();
    return buildReport(rows, options);
  } catch (error) {
    return { ...buildReport([], options), error: error.message };
  }
}

function authorityForTour(report = {}, tour = 'ALL') {
  const normalizedTour = normalizeTour(tour);
  const forward = normalizedTour === 'ALL' ? report.forward?.overall : report.forward?.byTour?.[normalizedTour];
  const mature = normalizedTour === 'ALL'
    ? report.forwardOverallMature === true
    : report.forwardTourMature?.[normalizedTour] === true && report.forwardOverallMature === true;
  const allowed = mature && forward?.degradationActive === true && report.probabilityAdjustmentAuthority === true;
  return {
    tour: normalizedTour,
    mature,
    degradationActive: forward?.degradationActive === true,
    probabilityAdjustmentAuthority: allowed,
    reason: allowed ? 'FORWARD_CERTIFIED_MATURE_DEGRADATION' : 'NO_MATURE_FORWARD_AUTHORITY'
  };
}

function health(report = null) {
  const value = report || buildReport([]);
  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    retrospectiveRows: value.retrospective?.rows || 0,
    forwardRows: value.forward?.rows || 0,
    retrospectiveDegradation: value.retrospective?.overall?.degradationActive === true,
    probabilityAdjustmentAuthority: value.probabilityAdjustmentAuthority === true,
    confidenceAdjustmentAuthority: value.confidenceAdjustmentAuthority === true,
    authority: value.authority,
    thresholds: value.thresholds
  };
}

module.exports = {
  VERSION,
  POLICY_VERSION,
  MIN_FORWARD_RECENT,
  MIN_FORWARD_PREVIOUS,
  MIN_FORWARD_TOUR_ROWS,
  MIN_FORWARD_OVERALL_ROWS,
  normalizeTour,
  metricSummary,
  evaluateWindow,
  analyzeChannel,
  buildReport,
  loadFromDb,
  authorityForTour,
  health
};
