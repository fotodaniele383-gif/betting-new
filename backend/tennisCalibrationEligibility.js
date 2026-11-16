'use strict';

const crypto = require('crypto');

const TENNIS_CALIBRATION_ELIGIBILITY_VERSION = 'TENNIS_CALIBRATION_ELIGIBILITY_V2_PATCH7';
const TENNIS_CALIBRATION_DATASET_VERSION = 'TENNIS_CALIBRATION_DATASET_V2_PATCH7';
const TENNIS_CALIBRATION_LEDGER_TABLE = 'tennis_calibration_eligibility';

const ELIGIBILITY_STATES = Object.freeze({
  CLV_ELIGIBLE: 'CLV_ELIGIBLE',
  PRODUCTION_ELIGIBLE: 'PRODUCTION_ELIGIBLE',
  SETTLEMENT_ONLY: 'SETTLEMENT_ONLY',
  LEGACY_UNVERIFIED: 'LEGACY_UNVERIFIED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  CONFLICT: 'CONFLICT',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  VOID_EXCLUDED: 'VOID_EXCLUDED'
});

const LEDGER_SCHEMA = Object.freeze([
  ['bet_id', 'INTEGER PRIMARY KEY'],
  ['eligibility_status', 'TEXT NOT NULL'],
  ['eligibility_reasons', 'TEXT NOT NULL'],
  ['segment_key', 'TEXT NOT NULL'],
  ['settlement_eligible', 'INTEGER NOT NULL DEFAULT 0'],
  ['clv_eligible', 'INTEGER NOT NULL DEFAULT 0'],
  ['production_eligible', 'INTEGER NOT NULL DEFAULT 0'],
  ['snapshot_hash', 'TEXT NOT NULL'],
  ['dataset_version', 'TEXT NOT NULL'],
  ['evaluated_at', 'TEXT NOT NULL'],
  ['operation_id', 'TEXT'],
  ['prediction_snapshot_id', 'TEXT'],
  ['prediction_snapshot_hash', 'TEXT'],
  ['prediction_snapshot_status', 'TEXT'],
  ['prediction_snapshot_captured_at', 'TEXT'],
  ['prediction_snapshot_version', 'TEXT']
]);

const READINESS_LIMITS = Object.freeze({
  minSettlementSample: 100,
  minClvSample: 50,
  maxBrier: 0.245,
  maxCalibrationGapPp: 7.5,
  maxExpectedCalibrationError: 0.08,
  minAverageClvPct: 0,
  minSegmentSample: 30
});

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function round(value, digits = 4) { const n = number(value); return n == null ? null : Number(n.toFixed(digits)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function uniq(values) { return [...new Set(values.filter(Boolean))]; }

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stableObject(value))).digest('hex');
}

function isTennisRow(row = {}) {
  const source = upper([row.sport_type, row.bet_type, row.strategy_tag, row.league].filter(Boolean).join(' '));
  return source.includes('TENNIS') || source.includes('ATP') || source.includes('WTA');
}

function normalizeProbabilityPct(row = {}) {
  const raw = number(
    row.calibrated_probability_pct ??
    row.estimated_prob ??
    row.estimatedProb ??
    row.model_probability ??
    row.probability
  );
  if (raw == null) return null;
  const pct = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return pct > 0 && pct < 100 ? pct : null;
}

function normalizeMarket(row = {}) {
  const source = upper([row.market_type, row.bet_type, row.prediction].filter(Boolean).join(' '));
  if (source.includes('TOTAL') || source.includes('OVER') || source.includes('UNDER')) return 'TOTALS';
  if (source.includes('HANDICAP') || source.includes('SPREAD')) return 'HANDICAP';
  if (source.includes('MONEY') || source.includes('H2H') || source.includes('WINNER') || ['1', '2'].includes(upper(row.prediction))) return 'MONEYLINE';
  return 'UNKNOWN';
}

function inferTour(row = {}) {
  const source = upper([row.tour_type, row.league, row.strategy_tag].filter(Boolean).join(' '));
  if (source.includes('WTA') || source.includes('WOMEN')) return 'WTA';
  if (source.includes('ATP') || source.includes('MEN')) return 'ATP';
  return 'UNKNOWN';
}

function normalizeSurface(row = {}) {
  const surface = upper(row.surface);
  if (surface.includes('CLAY')) return 'CLAY';
  if (surface.includes('GRASS')) return 'GRASS';
  if (surface.includes('HARD')) return 'HARD';
  if (surface.includes('CARPET')) return 'CARPET';
  return 'UNKNOWN';
}

function oddsBand(value) {
  const odd = number(value);
  if (!(odd > 1)) return 'UNKNOWN_ODD';
  if (odd < 1.5) return '1.01-1.49';
  if (odd < 1.8) return '1.50-1.79';
  if (odd < 2.2) return '1.80-2.19';
  if (odd < 3) return '2.20-2.99';
  return '3.00+';
}

function tournamentCategory(row = {}) {
  const source = upper([row.league, row.tournament_category, row.tournament_name].filter(Boolean).join(' '));
  if (source.includes('GRAND SLAM')) return 'GRAND_SLAM';
  if (source.includes('MASTERS 1000') || source.includes('WTA 1000')) return 'MASTERS_1000';
  if (source.includes('ATP500') || source.includes('ATP 500') || source.includes('WTA500') || source.includes('WTA 500')) return '500';
  if (source.includes('ATP250') || source.includes('ATP 250') || source.includes('WTA250') || source.includes('WTA 250')) return '250';
  if (source.includes('CHALLENGER')) return 'CHALLENGER';
  return source ? 'OTHER' : 'UNKNOWN';
}

function buildSegmentKey(row = {}) {
  return [
    inferTour(row),
    normalizeSurface(row),
    normalizeMarket(row),
    oddsBand(row.odd ?? row.opening_odd),
    tournamentCategory(row),
    text(row.model_version) || 'UNKNOWN_MODEL'
  ].join('|');
}

function isValidEventIdentity(row = {}) {
  const status = upper(row.tennis_event_identity_status);
  return ['PROVIDER_KEYED', 'CANONICAL_FALLBACK'].includes(status) &&
    Boolean(text(row.tennis_event_fingerprint)) &&
    Boolean(text(row.tennis_market_fingerprint));
}

function isVerifiedSettlement(row = {}) {
  const resolved = ['WON', 'LOST'].includes(upper(row.status));
  if (!resolved || upper(row.settlement_contract_status) !== 'VERIFIED') return false;
  if (!text(row.settlement_contract_version) || !text(row.settlement_evidence_hash) || !text(row.settlement_source_event_id)) return false;
  if (!text(row.settlement_event_fingerprint) || !text(row.settlement_market_fingerprint)) return false;
  if (text(row.tennis_event_fingerprint) && text(row.settlement_event_fingerprint) !== text(row.tennis_event_fingerprint)) return false;
  if (text(row.tennis_market_fingerprint) && text(row.settlement_market_fingerprint) !== text(row.tennis_market_fingerprint)) return false;
  return true;
}

function calculateClvPct(row = {}) {
  const direct = number(row.clv_pct ?? row.clv_edge);
  if (direct != null) return direct;
  const opening = number(row.opening_odd ?? row.open_odd ?? row.odd);
  const closing = number(row.closing_odd ?? row.clv);
  if (!(opening > 1) || !(closing > 1)) return null;
  return ((opening / closing) - 1) * 100;
}

function isVerifiedClv(row = {}) {
  if (upper(row.clv_contract_status) !== 'VERIFIED' || !text(row.clv_contract_version)) return false;
  if (!text(row.clv_bookmaker) || !text(row.clv_source_event_id)) return false;
  if (!text(row.clv_event_fingerprint) || !text(row.clv_market_fingerprint)) return false;
  if (text(row.tennis_event_fingerprint) && text(row.clv_event_fingerprint) !== text(row.tennis_event_fingerprint)) return false;
  if (text(row.tennis_market_fingerprint) && text(row.clv_market_fingerprint) !== text(row.tennis_market_fingerprint)) return false;
  return calculateClvPct(row) != null;
}


function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function applyPredictionSnapshotToRow(row = {}, snapshot = null) {
  if (!snapshot) return { ...row };
  const payload = safeJsonParse(snapshot.payload_json, {}) || {};
  return {
    ...row,
    estimated_prob: payload.model_probability_pct ?? row.estimated_prob,
    calibrated_probability_pct: payload.model_probability_pct ?? row.calibrated_probability_pct,
    odd: payload.opening_odd ?? row.odd,
    opening_odd: payload.opening_odd ?? row.opening_odd,
    market_implied_prob: payload.market_probability_pct ?? row.market_implied_prob,
    edge_pp: payload.edge_pp ?? row.edge_pp,
    edge: payload.edge_pp ?? row.edge,
    ev_pct: payload.ev_pct ?? row.ev_pct,
    prediction: payload.predicted_side ?? row.prediction,
    internal_side: payload.predicted_side ?? row.internal_side,
    point_line: payload.point_line ?? row.point_line,
    market_type: payload.market_type ?? row.market_type,
    model_version: payload.model_version ?? row.model_version,
    metric_version: payload.metric_version ?? row.metric_version,
    engine_version: payload.engine_version ?? row.engine_version,
    stake: payload.stake_final ?? row.stake,
    stake_base_before_deepscan: payload.stake_proposed ?? row.stake_base_before_deepscan,
    tennis_event_fingerprint: payload.event_fingerprint ?? row.tennis_event_fingerprint,
    tennis_market_fingerprint: payload.market_fingerprint ?? row.tennis_market_fingerprint,
    _prediction_snapshot_id: snapshot.snapshot_id || null,
    _prediction_snapshot_hash: snapshot.snapshot_hash || null,
    _prediction_snapshot_status: snapshot.snapshot_status || null,
    _prediction_snapshot_captured_at: snapshot.captured_at || null,
    _prediction_snapshot_version: snapshot.snapshot_version || null,
    _prediction_snapshot_anchor: Number(snapshot.is_calibration_anchor || 0) === 1
  };
}

function hasValidPredictionSnapshot(row = {}) {
  return row._prediction_snapshot_anchor === true &&
    upper(row._prediction_snapshot_status) === 'VALID_PREMATCH' &&
    Boolean(text(row._prediction_snapshot_id)) &&
    Boolean(text(row._prediction_snapshot_hash)) &&
    Boolean(text(row._prediction_snapshot_version));
}

function sourceSnapshot(row = {}) {
  return {
    id: row.id,
    status: row.status,
    data_quality: row.data_quality,
    estimated_prob: row.estimated_prob,
    calibrated_probability_pct: row.calibrated_probability_pct,
    odd: row.odd,
    stake: row.stake,
    profit: row.profit,
    sport_type: row.sport_type,
    bet_type: row.bet_type,
    strategy_tag: row.strategy_tag,
    market_type: row.market_type,
    prediction: row.prediction,
    point_line: row.point_line,
    tour_type: row.tour_type,
    surface: row.surface,
    league: row.league,
    model_version: row.model_version,
    metric_version: row.metric_version,
    tennis_event_identity_status: row.tennis_event_identity_status,
    tennis_event_fingerprint: row.tennis_event_fingerprint,
    tennis_market_fingerprint: row.tennis_market_fingerprint,
    settlement_contract_status: row.settlement_contract_status,
    settlement_contract_version: row.settlement_contract_version,
    settlement_source: row.settlement_source,
    settlement_source_event_id: row.settlement_source_event_id,
    settlement_evidence_hash: row.settlement_evidence_hash,
    settlement_event_fingerprint: row.settlement_event_fingerprint,
    settlement_market_fingerprint: row.settlement_market_fingerprint,
    clv_contract_status: row.clv_contract_status,
    clv_contract_version: row.clv_contract_version,
    clv_bookmaker: row.clv_bookmaker,
    clv_source_event_id: row.clv_source_event_id,
    clv_event_fingerprint: row.clv_event_fingerprint,
    clv_market_fingerprint: row.clv_market_fingerprint,
    clv_pct: row.clv_pct,
    clv_edge: row.clv_edge,
    closing_odd: row.closing_odd,
    clv: row.clv,
    prediction_snapshot_id: row._prediction_snapshot_id,
    prediction_snapshot_hash: row._prediction_snapshot_hash,
    prediction_snapshot_status: row._prediction_snapshot_status,
    prediction_snapshot_captured_at: row._prediction_snapshot_captured_at,
    prediction_snapshot_version: row._prediction_snapshot_version
  };
}

function buildEligibilityRecord(row = {}, options = {}) {
  if (!isTennisRow(row)) return null;
  const reasons = [];
  const status = upper(row.status);
  const settlementContractStatus = upper(row.settlement_contract_status);
  const clvContractStatus = upper(row.clv_contract_status);
  const identityStatus = upper(row.tennis_event_identity_status);
  const settlementSource = upper(row.settlement_source);
  const probability = normalizeProbabilityPct(row);
  const dataQualityValid = ['CURRENT', 'CURRENT_BOOTSTRAP'].includes(upper(row.data_quality));
  const eventIdentityValid = isValidEventIdentity(row);
  const settlementValid = isVerifiedSettlement(row);
  const clvValid = isVerifiedClv(row);
  const market = normalizeMarket(row);
  const tour = inferTour(row);
  const surface = normalizeSurface(row);
  const oddValid = number(row.odd) > 1;
  const modelVersionValid = Boolean(text(row.model_version));
  const predictionSnapshotRequired = options.requirePredictionSnapshot === true;
  const predictionSnapshotValid = hasValidPredictionSnapshot(row);

  let eligibilityStatus;
  let settlementEligible = false;
  let productionEligible = false;
  let clvEligible = false;

  if (['VOID', 'PUSH'].includes(status)) {
    eligibilityStatus = ELIGIBILITY_STATES.VOID_EXCLUDED;
    reasons.push('VOID_OR_PUSH_EXCLUDED_FROM_PREDICTIVE_METRICS');
  } else if (
    settlementContractStatus === 'CONFLICT' || clvContractStatus === 'CONFLICT' ||
    identityStatus.includes('CONFLICT') || identityStatus.includes('COLLISION') ||
    identityStatus.includes('DUPLICATE')
  ) {
    eligibilityStatus = ELIGIBILITY_STATES.CONFLICT;
    reasons.push('CONTRACT_OR_IDENTITY_CONFLICT');
  } else if (settlementContractStatus === 'MANUAL_REVIEW' || settlementSource.includes('MANUAL')) {
    eligibilityStatus = ELIGIBILITY_STATES.MANUAL_REVIEW;
    reasons.push('MANUAL_SETTLEMENT_NOT_ALLOWED_FOR_CERTIFIED_CALIBRATION');
  } else if (!settlementContractStatus || !text(row.settlement_contract_version) || !identityStatus || !text(row.tennis_event_identity_version)) {
    eligibilityStatus = ELIGIBILITY_STATES.LEGACY_UNVERIFIED;
    reasons.push('PRE_CONTRACT_LEGACY_RECORD');
    if (!settlementContractStatus) reasons.push('SETTLEMENT_CONTRACT_UNCLASSIFIED');
    if (!identityStatus) reasons.push('EVENT_IDENTITY_UNCLASSIFIED');
  } else if (!settlementValid) {
    eligibilityStatus = ELIGIBILITY_STATES.INSUFFICIENT_DATA;
    reasons.push('SETTLEMENT_NOT_VERIFIED');
    if (!['WON', 'LOST'].includes(status)) reasons.push('RESULT_NOT_WON_OR_LOST');
  } else {
    if (!dataQualityValid) reasons.push('DATA_QUALITY_NOT_CURRENT');
    if (probability == null) reasons.push('MODEL_PROBABILITY_INVALID');
    if (!oddValid) reasons.push('OPENING_ODD_INVALID');
    if (!eventIdentityValid) reasons.push('EVENT_IDENTITY_NOT_CERTIFIED');
    if (predictionSnapshotRequired && !predictionSnapshotValid) reasons.push('PREDICTION_SNAPSHOT_MISSING_OR_INVALID');

    settlementEligible = dataQualityValid && probability != null && settlementValid && (!predictionSnapshotRequired || predictionSnapshotValid);
    const completeProductionMetadata = settlementEligible && oddValid && eventIdentityValid && market !== 'UNKNOWN' && tour !== 'UNKNOWN' && modelVersionValid;
    productionEligible = completeProductionMetadata;
    clvEligible = completeProductionMetadata && clvValid;

    if (clvEligible) {
      eligibilityStatus = ELIGIBILITY_STATES.CLV_ELIGIBLE;
    } else if (productionEligible) {
      eligibilityStatus = ELIGIBILITY_STATES.PRODUCTION_ELIGIBLE;
      reasons.push('CLV_NOT_VERIFIED');
    } else if (settlementEligible) {
      eligibilityStatus = ELIGIBILITY_STATES.SETTLEMENT_ONLY;
      if (market === 'UNKNOWN') reasons.push('MARKET_UNKNOWN');
      if (tour === 'UNKNOWN') reasons.push('TOUR_UNKNOWN');
      if (surface === 'UNKNOWN') reasons.push('SURFACE_UNKNOWN_NON_BLOCKING_FOR_BRIER');
      if (!modelVersionValid) reasons.push('MODEL_VERSION_MISSING');
    } else {
      eligibilityStatus = ELIGIBILITY_STATES.INSUFFICIENT_DATA;
    }
  }

  const evaluatedAt = options.evaluatedAt || new Date().toISOString();
  const snapshotHash = sha256(sourceSnapshot(row));
  return {
    bet_id: Number(row.id),
    eligibility_status: eligibilityStatus,
    eligibility_reasons: JSON.stringify(uniq(reasons)),
    segment_key: buildSegmentKey(row),
    settlement_eligible: settlementEligible ? 1 : 0,
    clv_eligible: clvEligible ? 1 : 0,
    production_eligible: productionEligible ? 1 : 0,
    snapshot_hash: snapshotHash,
    dataset_version: TENNIS_CALIBRATION_DATASET_VERSION,
    evaluated_at: evaluatedAt,
    operation_id: options.operationId || null,
    prediction_snapshot_id: row._prediction_snapshot_id || null,
    prediction_snapshot_hash: row._prediction_snapshot_hash || null,
    prediction_snapshot_status: row._prediction_snapshot_status || null,
    prediction_snapshot_captured_at: row._prediction_snapshot_captured_at || null,
    prediction_snapshot_version: row._prediction_snapshot_version || null,
    _probabilityPct: probability,
    _clvPct: calculateClvPct(row)
  };
}

function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + ((v - m) ** 2), 0) / (values.length - 1));
}

function wilsonInterval(wins, n, z = 1.96) {
  if (!n) return { low: null, high: null };
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p) / n) + (z * z) / (4 * n * n))) / d;
  return { low: round(clamp(c - m, 0, 1) * 100, 2), high: round(clamp(c + m, 0, 1) * 100, 2) };
}

function metricSummary(rows, recordsById, options = {}) {
  const eligibleRows = rows.filter(row => recordsById.get(Number(row.id))?.settlement_eligible === 1 && ['WON', 'LOST'].includes(upper(row.status)));
  const observations = eligibleRows.map(row => {
    const pPct = normalizeProbabilityPct(row);
    return { row, pPct, p: pPct / 100, y: upper(row.status) === 'WON' ? 1 : 0 };
  }).filter(x => x.pPct != null);
  const n = observations.length;
  const wins = observations.reduce((sum, x) => sum + x.y, 0);
  const probs = observations.map(x => x.p);
  const outcomes = observations.map(x => x.y);
  const brierValues = observations.map(x => (x.p - x.y) ** 2);
  const logLossValues = observations.map(x => {
    const p = clamp(x.p, 1e-6, 1 - 1e-6);
    return -(x.y * Math.log(p) + (1 - x.y) * Math.log(1 - p));
  });
  const avgP = mean(probs);
  const hitRate = n ? wins / n : null;
  const avgBrier = mean(brierValues);
  const baselineBrier = n && hitRate != null ? mean(outcomes.map(y => (hitRate - y) ** 2)) : null;
  const brierSkill = avgBrier != null && baselineBrier > 0 ? 1 - (avgBrier / baselineBrier) : null;
  const brierSe = n > 1 ? stdDev(brierValues) / Math.sqrt(n) : null;

  const bucketCount = Math.max(2, Number(options.bucketCount || 10));
  const buckets = [];
  let ece = 0;
  for (let i = 0; i < bucketCount; i += 1) {
    const low = i / bucketCount;
    const high = (i + 1) / bucketCount;
    const bucket = observations.filter(x => x.p >= low && (i === bucketCount - 1 ? x.p <= high : x.p < high));
    if (!bucket.length) continue;
    const bucketP = mean(bucket.map(x => x.p));
    const bucketY = mean(bucket.map(x => x.y));
    const gap = Math.abs(bucketP - bucketY);
    ece += gap * (bucket.length / Math.max(n, 1));
    buckets.push({
      range: `${Math.round(low * 100)}-${Math.round(high * 100)}`,
      sample: bucket.length,
      predictedPct: round(bucketP * 100, 2),
      observedPct: round(bucketY * 100, 2),
      gapPp: round((bucketP - bucketY) * 100, 2)
    });
  }

  const productionRows = rows.filter(row => recordsById.get(Number(row.id))?.production_eligible === 1 && ['WON', 'LOST'].includes(upper(row.status)));
  const totalStake = productionRows.reduce((sum, row) => sum + Math.max(0, number(row.stake) || 0), 0);
  const totalProfit = productionRows.reduce((sum, row) => sum + (number(row.profit) || 0), 0);

  const clvRows = rows.filter(row => recordsById.get(Number(row.id))?.clv_eligible === 1);
  const clvValues = clvRows.map(calculateClvPct).filter(v => v != null);

  return {
    sample: n,
    wins,
    losses: Math.max(0, n - wins),
    meanPredictedProbabilityPct: avgP == null ? null : round(avgP * 100, 2),
    observedWinRatePct: hitRate == null ? null : round(hitRate * 100, 2),
    calibrationGapPp: avgP == null || hitRate == null ? null : round((avgP - hitRate) * 100, 2),
    absoluteCalibrationGapPp: avgP == null || hitRate == null ? null : round(Math.abs(avgP - hitRate) * 100, 2),
    brierScore: avgBrier == null ? null : round(avgBrier, 4),
    brierBaseline: baselineBrier == null ? null : round(baselineBrier, 4),
    brierSkillScore: brierSkill == null ? null : round(brierSkill, 4),
    brier95Ci: avgBrier == null || brierSe == null ? { low: null, high: null } : {
      low: round(clamp(avgBrier - 1.96 * brierSe, 0, 1), 4),
      high: round(clamp(avgBrier + 1.96 * brierSe, 0, 1), 4)
    },
    logLoss: n ? round(mean(logLossValues), 4) : null,
    expectedCalibrationError: n ? round(ece, 4) : null,
    winRate95Ci: wilsonInterval(wins, n),
    calibrationBuckets: buckets,
    productionSample: productionRows.length,
    totalStake: round(totalStake, 2) || 0,
    totalProfit: round(totalProfit, 2) || 0,
    roiPct: totalStake > 0 ? round((totalProfit / totalStake) * 100, 2) : null,
    clvSample: clvValues.length,
    averageClvPct: clvValues.length ? round(mean(clvValues), 2) : null,
    positiveClvRatePct: clvValues.length ? round((clvValues.filter(v => v > 0).length / clvValues.length) * 100, 2) : null
  };
}

function segmentReports(rows, recordsById, limits = READINESS_LIMITS) {
  const dimensions = {
    byTour: row => inferTour(row),
    bySurface: row => normalizeSurface(row),
    byMarket: row => normalizeMarket(row),
    byOddsBand: row => oddsBand(row.odd),
    byTournamentCategory: row => tournamentCategory(row),
    byModelVersion: row => text(row.model_version) || 'UNKNOWN_MODEL'
  };
  const output = {};
  for (const [name, getter] of Object.entries(dimensions)) {
    const groups = new Map();
    for (const row of rows) {
      const key = getter(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    output[name] = [...groups.entries()].map(([key, groupRows]) => {
      const metrics = metricSummary(groupRows, recordsById);
      return { key, ...metrics, reliableSample: metrics.sample >= limits.minSegmentSample };
    }).filter(item => item.sample > 0).sort((a, b) => b.sample - a.sample);
  }
  return output;
}

function buildCalibrationReadinessReport(rows = [], ledgerRows = [], options = {}) {
  const evaluatedAt = options.evaluatedAt || new Date().toISOString();
  const operationId = options.operationId || null;
  const snapshotRows = Array.isArray(options.predictionSnapshots) ? options.predictionSnapshots : [];
  const anchorsByBet = new Map(snapshotRows
    .filter(snapshot => Number(snapshot.is_calibration_anchor || 0) === 1)
    .map(snapshot => [Number(snapshot.bet_id), snapshot]));
  const requirePredictionSnapshot = options.requirePredictionSnapshot === true || snapshotRows.length > 0;
  const effectiveRows = rows.map(row => applyPredictionSnapshotToRow(row, anchorsByBet.get(Number(row.id)) || null));
  const records = effectiveRows.map(row => buildEligibilityRecord(row, { evaluatedAt, operationId, requirePredictionSnapshot })).filter(Boolean);
  const recordsById = new Map(records.map(record => [record.bet_id, record]));
  const ledgerById = new Map((ledgerRows || []).map(row => [Number(row.bet_id), row]));
  const ledgerMissing = records.filter(record => !ledgerById.has(record.bet_id)).length;
  const ledgerMismatch = records.filter(record => {
    const ledger = ledgerById.get(record.bet_id);
    return ledger && (ledger.snapshot_hash !== record.snapshot_hash || ledger.eligibility_status !== record.eligibility_status || ledger.dataset_version !== TENNIS_CALIBRATION_DATASET_VERSION);
  }).length;
  const ledgerOrphans = [...ledgerById.keys()].filter(id => !recordsById.has(id)).length;
  const ledgerFresh = ledgerMissing === 0 && ledgerMismatch === 0 && ledgerOrphans === 0 && ledgerById.size === records.length;

  const counts = Object.fromEntries(Object.values(ELIGIBILITY_STATES).map(state => [state, 0]));
  for (const record of records) counts[record.eligibility_status] = (counts[record.eligibility_status] || 0) + 1;
  const metrics = metricSummary(effectiveRows, recordsById, options);
  const limits = { ...READINESS_LIMITS, ...(options.limits || {}) };
  const checks = {
    ledgerFresh,
    settlementSample: metrics.sample >= limits.minSettlementSample,
    clvSample: metrics.clvSample >= limits.minClvSample,
    brier: metrics.brierScore != null && metrics.brierScore <= limits.maxBrier,
    calibrationGap: metrics.absoluteCalibrationGapPp != null && metrics.absoluteCalibrationGapPp <= limits.maxCalibrationGapPp,
    expectedCalibrationError: metrics.expectedCalibrationError != null && metrics.expectedCalibrationError <= limits.maxExpectedCalibrationError,
    averageClv: metrics.averageClvPct != null && metrics.averageClvPct >= limits.minAverageClvPct
  };
  const readinessReasons = [];
  if (!checks.ledgerFresh) readinessReasons.push('ELIGIBILITY_LEDGER_STALE');
  if (!checks.settlementSample) readinessReasons.push(`SETTLEMENT_SAMPLE_${metrics.sample}_BELOW_${limits.minSettlementSample}`);
  if (!checks.clvSample) readinessReasons.push(`CLV_SAMPLE_${metrics.clvSample}_BELOW_${limits.minClvSample}`);
  if (!checks.brier) readinessReasons.push('BRIER_NOT_READY');
  if (!checks.calibrationGap) readinessReasons.push('CALIBRATION_GAP_NOT_READY');
  if (!checks.expectedCalibrationError) readinessReasons.push('ECE_NOT_READY');
  if (!checks.averageClv) readinessReasons.push('CLV_QUALITY_NOT_READY');
  const ready = Object.values(checks).every(Boolean);
  const readinessStatus = ready ? 'READY_SHADOW_ONLY' : (!ledgerFresh ? 'DEGRADED_LEDGER' : 'NOT_READY');

  return {
    success: true,
    sport: 'TENNIS',
    version: TENNIS_CALIBRATION_ELIGIBILITY_VERSION,
    datasetVersion: TENNIS_CALIBRATION_DATASET_VERSION,
    generatedAt: evaluatedAt,
    operationId,
    mode: 'SHADOW_EVALUATION_ONLY',
    recommendationOnly: true,
    autoApplyCalibration: false,
    operationalModelChanged: false,
    sourceRows: records.length,
    eligibilityCounts: counts,
    eligible: {
      settlement: records.filter(r => r.settlement_eligible === 1).length,
      production: records.filter(r => r.production_eligible === 1).length,
      clv: records.filter(r => r.clv_eligible === 1).length
    },
    ledger: {
      table: TENNIS_CALIBRATION_LEDGER_TABLE,
      rows: ledgerById.size,
      expectedRows: records.length,
      missing: ledgerMissing,
      mismatch: ledgerMismatch,
      orphans: ledgerOrphans,
      fresh: ledgerFresh
    },
    predictionSnapshots: {
      required: requirePredictionSnapshot,
      suppliedRows: snapshotRows.length,
      anchors: anchorsByBet.size,
      validAnchorCoveragePct: records.length ? round((anchorsByBet.size / records.length) * 100, 2) : 0,
      version: snapshotRows[0]?.snapshot_version || null
    },
    readiness: {
      status: readinessStatus,
      ready,
      checks,
      reasons: readinessReasons,
      limits
    },
    metrics,
    segments: segmentReports(effectiveRows, recordsById, limits),
    note: 'Patch 7 valuta il dataset usando, quando disponibile, lo snapshot predittivo immutabile. Resta shadow-only e non modifica probabilità, soglie, gate o stake.'
  };
}

module.exports = {
  TENNIS_CALIBRATION_ELIGIBILITY_VERSION,
  TENNIS_CALIBRATION_DATASET_VERSION,
  TENNIS_CALIBRATION_LEDGER_TABLE,
  ELIGIBILITY_STATES,
  LEDGER_SCHEMA,
  READINESS_LIMITS,
  isTennisRow,
  normalizeProbabilityPct,
  normalizeMarket,
  inferTour,
  normalizeSurface,
  oddsBand,
  tournamentCategory,
  buildSegmentKey,
  isValidEventIdentity,
  isVerifiedSettlement,
  isVerifiedClv,
  calculateClvPct,
  sourceSnapshot,
  applyPredictionSnapshotToRow,
  hasValidPredictionSnapshot,
  buildEligibilityRecord,
  buildCalibrationReadinessReport,
  metricSummary
};
