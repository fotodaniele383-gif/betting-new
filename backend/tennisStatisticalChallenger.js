'use strict';

const crypto = require('crypto');
const historicalPerformance = require('./tennisHistoricalValidationPerformance');

const TENNIS_STATISTICAL_CHALLENGER_VERSION = 'TENNIS_STATISTICAL_CHALLENGER_V1_PATCH18';
const TENNIS_STATISTICAL_CHALLENGER_SCHEMA_VERSION = 'TENNIS_STATISTICAL_CHALLENGER_SCHEMA_V1_PATCH18';
const MODE = 'SHADOW_TEMPORAL_CROSS_FIT_NO_PRODUCTION_AUTHORITY';
const TABLE_RUNS = 'tennis_statistical_challenger_runs';
const TABLE_PREDICTIONS = 'tennis_statistical_challenger_predictions';
const DEFAULT_FOLD_COUNT = 5;
const DEFAULT_MIN_TRAIN_ROWS = 50;
const DEFAULT_MAX_HISTORICAL_WEIGHT = 0.50;
const DEFAULT_WEIGHT_STEP = 0.05;
const DEFAULT_BOOTSTRAP_ITERATIONS = 2000;
const DEFAULT_BOOTSTRAP_SEED = 18017;

function text(value) { return String(value == null ? '' : value).trim(); }
function finite(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, decimals = 6) { const n = finite(value, null); return n === null ? null : Number(n.toFixed(decimals)); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex'); }
function safeJsonParse(value, fallback = null) { try { return JSON.parse(value); } catch (_) { return fallback; } }
function tableExists(db, table) {
  try { return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table)); }
  catch (_) { return false; }
}
function triggerExists(db, trigger) {
  try { return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='trigger' AND name=? LIMIT 1").get(trigger)); }
  catch (_) { return false; }
}
function normalizeProbability(value) {
  const n = finite(value, null);
  if (n === null) return null;
  if (n > 1 && n <= 100) return clamp(n / 100, 0.001, 0.999);
  if (n >= 0 && n <= 1) return clamp(n, 0.001, 0.999);
  return null;
}
function brier(probabilityP1, actualWinnerSide) {
  const p = normalizeProbability(probabilityP1);
  if (p === null || ![1, 2].includes(Number(actualWinnerSide))) return null;
  const y = Number(actualWinnerSide) === 1 ? 1 : 0;
  return (p - y) ** 2;
}
function logLoss(probabilityP1, actualWinnerSide) {
  const p = normalizeProbability(probabilityP1);
  if (p === null || ![1, 2].includes(Number(actualWinnerSide))) return null;
  const selected = Number(actualWinnerSide) === 1 ? p : 1 - p;
  return -Math.log(clamp(selected, 0.001, 0.999));
}
function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}
function percentile(sorted, probability) {
  if (!sorted.length) return null;
  const index = clamp(Math.floor(probability * sorted.length), 0, sorted.length - 1);
  return sorted[index];
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function weightGrid(options = {}) {
  const maxWeight = clamp(finite(options.maxHistoricalWeight, DEFAULT_MAX_HISTORICAL_WEIGHT), 0, 1);
  const step = clamp(finite(options.weightStep, DEFAULT_WEIGHT_STEP), 0.01, 0.50);
  const values = [];
  for (let value = 0; value <= maxWeight + 1e-12; value += step) values.push(round(value, 8));
  if (values.at(-1) !== round(maxWeight, 8)) values.push(round(maxWeight, 8));
  return [...new Set(values)].sort((a, b) => a - b);
}
function blendProbability(productionP1, historicalP1, historicalWeight) {
  const production = normalizeProbability(productionP1);
  const historical = normalizeProbability(historicalP1);
  const weight = clamp(finite(historicalWeight, 0), 0, 1);
  if (production === null || historical === null) return null;
  return clamp((1 - weight) * production + weight * historical, 0.001, 0.999);
}

function normalizeEvaluation(row = {}) {
  const payload = safeJsonParse(row.payload_json, {}) || {};
  const production = normalizeProbability(row.production_probability_p1 ?? row.productionProbabilityP1 ?? payload.productionProbabilityP1);
  const historical = normalizeProbability(row.validation_probability_p1 ?? row.historicalProbabilityP1 ?? row.validationProbabilityP1 ?? payload.validationProbabilityP1);
  const actualWinnerSide = Number(row.actual_winner_side ?? row.actualWinnerSide ?? payload.actualWinnerSide);
  const matchStartAt = text(row.match_start_at ?? row.matchStartAt ?? payload.matchStartAt);
  const evaluationId = text(row.evaluation_id ?? row.evaluationId ?? payload.evaluationId);
  if (!evaluationId || !matchStartAt || production === null || historical === null || ![1, 2].includes(actualWinnerSide)) return null;
  return {
    evaluationId,
    betId: Number(row.bet_id ?? row.betId ?? payload.betId),
    tour: text(row.tour ?? payload.tour).toUpperCase() || 'UNKNOWN',
    matchStartAt,
    actualWinnerSide,
    productionProbabilityP1: production,
    historicalProbabilityP1: historical,
    confidenceScore: finite(row.confidence_score ?? row.confidenceScore ?? payload.confidenceScore, null),
    agreementStatus: text(row.agreement_status ?? row.agreementStatus ?? payload.agreementStatus) || 'UNKNOWN',
    seasonP1: finite(row.season_p1 ?? row.seasonP1 ?? payload.seasonP1, null),
    seasonP2: finite(row.season_p2 ?? row.seasonP2 ?? payload.seasonP2, null),
    sourceDatasetId: text(row.source_dataset_id ?? row.sourceDatasetId ?? payload.sourceDatasetId) || null,
    sourceEvaluationHash: text(row.evaluation_hash ?? row.sourceEvaluationHash ?? payload.evaluationHash) || sha256(payload)
  };
}
function loadRetrospectiveEvaluations(db) {
  if (!tableExists(db, historicalPerformance.TABLE_EVALUATIONS)) return [];
  return db.prepare(`SELECT * FROM ${historicalPerformance.TABLE_EVALUATIONS} WHERE evaluation_mode='RETROSPECTIVE_AS_OF_SAFE' ORDER BY match_start_at, bet_id, evaluation_id`)
    .all()
    .map(normalizeEvaluation)
    .filter(Boolean);
}
function temporalBoundaries(totalRows, foldCount = DEFAULT_FOLD_COUNT) {
  const count = Math.max(2, Math.floor(finite(foldCount, DEFAULT_FOLD_COUNT)));
  const boundaries = [];
  for (let index = 0; index <= count; index += 1) boundaries.push(Math.floor(totalRows * index / count));
  boundaries[boundaries.length - 1] = totalRows;
  return boundaries;
}
function selectBlendWeight(trainingRows, options = {}) {
  if (!Array.isArray(trainingRows) || !trainingRows.length) return { weight: 0, trainingBrier: null, grid: weightGrid(options) };
  const grid = weightGrid(options);
  let best = null;
  for (const weight of grid) {
    const scores = trainingRows.map(row => brier(blendProbability(row.productionProbabilityP1, row.historicalProbabilityP1, weight), row.actualWinnerSide));
    const trainingBrier = mean(scores);
    const candidate = { weight, trainingBrier };
    if (!best || trainingBrier < best.trainingBrier - 1e-12 || (Math.abs(trainingBrier - best.trainingBrier) <= 1e-12 && weight < best.weight)) best = candidate;
  }
  return { ...best, grid };
}
function buildPrediction(row, foldIndex, trainingRows, selection, options = {}) {
  const challengerP1 = blendProbability(row.productionProbabilityP1, row.historicalProbabilityP1, selection.weight);
  const challengerBrier = brier(challengerP1, row.actualWinnerSide);
  const productionBrier = brier(row.productionProbabilityP1, row.actualWinnerSide);
  const historicalBrier = brier(row.historicalProbabilityP1, row.actualWinnerSide);
  const challengerSide = challengerP1 >= 0.5 ? 1 : 2;
  const productionSide = row.productionProbabilityP1 >= 0.5 ? 1 : 2;
  const historicalSide = row.historicalProbabilityP1 >= 0.5 ? 1 : 2;
  const core = {
    version: TENNIS_STATISTICAL_CHALLENGER_VERSION,
    mode: MODE,
    sourceEvaluationId: row.evaluationId,
    betId: row.betId,
    foldIndex,
    trainedRows: trainingRows,
    blendWeightHistorical: round(selection.weight, 4),
    trainingBrier: round(selection.trainingBrier, 6),
    tour: row.tour,
    matchStartAt: row.matchStartAt,
    actualWinnerSide: row.actualWinnerSide,
    productionProbabilityP1: round(row.productionProbabilityP1, 6),
    historicalProbabilityP1: round(row.historicalProbabilityP1, 6),
    challengerProbabilityP1: round(challengerP1, 6),
    productionBrier: round(productionBrier, 6),
    historicalBrier: round(historicalBrier, 6),
    challengerBrier: round(challengerBrier, 6),
    pairedBrierImprovement: round(productionBrier - challengerBrier, 6),
    productionLogLoss: round(logLoss(row.productionProbabilityP1, row.actualWinnerSide), 6),
    historicalLogLoss: round(logLoss(row.historicalProbabilityP1, row.actualWinnerSide), 6),
    challengerLogLoss: round(logLoss(challengerP1, row.actualWinnerSide), 6),
    productionCorrect: productionSide === row.actualWinnerSide ? 1 : 0,
    historicalCorrect: historicalSide === row.actualWinnerSide ? 1 : 0,
    challengerCorrect: challengerSide === row.actualWinnerSide ? 1 : 0,
    challengerChangedSide: challengerSide !== productionSide ? 1 : 0,
    confidenceScore: row.confidenceScore,
    confidenceBand: row.confidenceScore === null ? 'UNKNOWN' : row.confidenceScore < 40 ? 'LOW' : row.confidenceScore < 70 ? 'MEDIUM' : 'HIGH',
    agreementStatus: row.agreementStatus,
    seasonPair: `${row.seasonP1 || 'NA'}-${row.seasonP2 || 'NA'}`,
    sourceDatasetId: row.sourceDatasetId,
    sourceEvaluationHash: row.sourceEvaluationHash,
    modelProbabilityAuthority: false,
    deepScanDecisionAuthority: false,
    qualityGateAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false,
    automaticPromotionAuthority: false
  };
  const predictionHash = sha256(core);
  return { ...core, predictionHash, predictionId: `TSCP18_${predictionHash.slice(0, 24)}`, createdAt: options.createdAt || new Date().toISOString() };
}
function temporalCrossFit(evaluations = [], options = {}) {
  const sorted = evaluations.map(normalizeEvaluation).filter(Boolean).sort((a, b) => a.matchStartAt.localeCompare(b.matchStartAt) || a.betId - b.betId || a.evaluationId.localeCompare(b.evaluationId));
  const foldCount = Math.max(2, Math.floor(finite(options.foldCount, DEFAULT_FOLD_COUNT)));
  const minTrainRows = Math.max(1, Math.floor(finite(options.minTrainRows, DEFAULT_MIN_TRAIN_ROWS)));
  const boundaries = temporalBoundaries(sorted.length, foldCount);
  const folds = [];
  const predictions = [];
  for (let foldIndex = 1; foldIndex < foldCount; foldIndex += 1) {
    const trainEnd = boundaries[foldIndex];
    const testStart = boundaries[foldIndex];
    const testEnd = boundaries[foldIndex + 1];
    const training = sorted.slice(0, trainEnd);
    const testing = sorted.slice(testStart, testEnd);
    if (training.length < minTrainRows || !testing.length) {
      folds.push({ foldIndex, status: 'SKIPPED_INSUFFICIENT_TRAINING', trainingRows: training.length, testRows: testing.length, testStart, testEnd });
      continue;
    }
    const selection = selectBlendWeight(training, options);
    const foldPredictions = testing.map(row => buildPrediction(row, foldIndex, training.length, selection, options));
    predictions.push(...foldPredictions);
    folds.push({
      foldIndex,
      status: 'OOS_EVALUATED',
      trainingRows: training.length,
      testRows: testing.length,
      testStart,
      testEnd,
      selectedHistoricalWeight: round(selection.weight, 4),
      trainingBrier: round(selection.trainingBrier, 6),
      testStartAt: testing[0]?.matchStartAt || null,
      testEndAt: testing.at(-1)?.matchStartAt || null
    });
  }
  return {
    sourceRows: sorted.length,
    foldCount,
    warmupRows: boundaries[1] || 0,
    boundaries,
    folds,
    predictions,
    policy: {
      ordering: 'MATCH_START_AT_BET_ID_EVALUATION_ID_ASC',
      training: 'STRICTLY_PRIOR_ROWS_ONLY',
      selectionMetric: 'MINIMUM_TRAINING_BRIER',
      tieBreak: 'LOWEST_HISTORICAL_WEIGHT',
      weightGrid: weightGrid(options),
      minTrainRows,
      productionMutation: false
    }
  };
}
function summarizePredictions(predictions = []) {
  return {
    rows: predictions.length,
    challengerBrier: round(mean(predictions.map(item => item.challengerBrier)), 6),
    productionBrier: round(mean(predictions.map(item => item.productionBrier)), 6),
    historicalBrier: round(mean(predictions.map(item => item.historicalBrier)), 6),
    brierImprovementVsProduction: round(mean(predictions.map(item => item.pairedBrierImprovement)), 6),
    challengerLogLoss: round(mean(predictions.map(item => item.challengerLogLoss)), 6),
    productionLogLoss: round(mean(predictions.map(item => item.productionLogLoss)), 6),
    historicalLogLoss: round(mean(predictions.map(item => item.historicalLogLoss)), 6),
    logLossImprovementVsProduction: round(mean(predictions.map(item => item.productionLogLoss - item.challengerLogLoss)), 6),
    challengerAccuracyPct: predictions.length ? round(predictions.filter(item => item.challengerCorrect === 1).length / predictions.length * 100, 2) : null,
    productionAccuracyPct: predictions.length ? round(predictions.filter(item => item.productionCorrect === 1).length / predictions.length * 100, 2) : null,
    historicalAccuracyPct: predictions.length ? round(predictions.filter(item => item.historicalCorrect === 1).length / predictions.length * 100, 2) : null,
    changedSideRows: predictions.filter(item => item.challengerChangedSide === 1).length,
    averageHistoricalWeight: round(mean(predictions.map(item => item.blendWeightHistorical)), 4)
  };
}
function deterministicBootstrap(predictions = [], options = {}) {
  const deltas = predictions.map(item => finite(item.pairedBrierImprovement, null)).filter(Number.isFinite);
  const iterations = Math.max(200, Math.floor(finite(options.bootstrapIterations, DEFAULT_BOOTSTRAP_ITERATIONS)));
  const seed = Math.floor(finite(options.bootstrapSeed, DEFAULT_BOOTSTRAP_SEED));
  if (!deltas.length) return { rows: 0, iterations, seed, meanImprovement: null, lower95: null, upper95: null, probabilityPositive: null, stablePositive: false };
  const random = mulberry32(seed + deltas.length * 97);
  const sampledMeans = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < deltas.length; index += 1) total += deltas[Math.floor(random() * deltas.length)];
    sampledMeans.push(total / deltas.length);
  }
  sampledMeans.sort((a, b) => a - b);
  const lower95 = percentile(sampledMeans, 0.025);
  const upper95 = percentile(sampledMeans, 0.975);
  return {
    rows: deltas.length,
    iterations,
    seed,
    meanImprovement: round(mean(deltas), 6),
    lower95: round(lower95, 6),
    upper95: round(upper95, 6),
    probabilityPositive: round(sampledMeans.filter(value => value > 0).length / sampledMeans.length, 4),
    stablePositive: lower95 > 0
  };
}
function segmentReport(predictions, keyFn, options = {}) {
  const groups = new Map();
  for (const item of predictions) {
    const key = text(keyFn(item)) || 'UNKNOWN';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Object.fromEntries([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows], index) => [key, {
    metrics: summarizePredictions(rows),
    bootstrap: deterministicBootstrap(rows, { ...options, bootstrapSeed: finite(options.bootstrapSeed, DEFAULT_BOOTSTRAP_SEED) + index * 7919 })
  }]));
}
function stabilityGuard(report) {
  const overall = report.bootstrap;
  const tourEntries = Object.values(report.byTour || {}).filter(item => Number(item?.metrics?.rows || 0) >= 50);
  const allToursStable = tourEntries.length > 0 && tourEntries.every(item => item.bootstrap?.stablePositive === true);
  const atLeastOneTourUnstable = tourEntries.some(item => item.bootstrap?.stablePositive !== true);
  let status = 'INSUFFICIENT_OOS_SAMPLE';
  if (Number(report.metrics?.rows || 0) >= 100 && overall?.stablePositive && allToursStable) status = 'OOS_IMPROVEMENT_STABLE_ALL_TOURS_RETROSPECTIVE_ONLY';
  else if (Number(report.metrics?.rows || 0) >= 100 && overall?.stablePositive && atLeastOneTourUnstable) status = 'OOS_IMPROVEMENT_OVERALL_COHORT_MIXED_RETROSPECTIVE_ONLY';
  else if (Number(report.metrics?.brierImprovementVsProduction || 0) > 0) status = 'OOS_IMPROVEMENT_UNCERTAIN_RETROSPECTIVE_ONLY';
  else if (Number(report.metrics?.rows || 0) > 0) status = 'NO_OOS_IMPROVEMENT_RETROSPECTIVE_ONLY';
  return {
    status,
    eligible: false,
    promotionAuthority: false,
    manualReviewRequired: true,
    productionMutationAllowed: false,
    conditions: {
      minimumOosRows100: Number(report.metrics?.rows || 0) >= 100,
      overallBootstrapLowerAboveZero: overall?.stablePositive === true,
      allToursWith50RowsStable: allToursStable,
      noMixedTourEvidence: !atLeastOneTourUnstable
    },
    reason: status === 'OOS_IMPROVEMENT_OVERALL_COHORT_MIXED_RETROSPECTIVE_ONLY'
      ? 'Il blend cross-fitted migliora il Brier complessivo fuori campione, ma almeno un circuito non ha intervallo bootstrap interamente positivo.'
      : status === 'OOS_IMPROVEMENT_STABLE_ALL_TOURS_RETROSPECTIVE_ONLY'
        ? 'Il miglioramento fuori campione è statisticamente stabile nei circuiti osservati, ma resta retrospettivo e non può modificare il modello.'
        : 'Il campione non dimostra ancora un miglioramento fuori campione sufficientemente stabile per una revisione production.'
  };
}
function buildTemporalCrossFitReport(evaluations = [], options = {}) {
  const startedAt = options.startedAt || new Date().toISOString();
  const crossFit = temporalCrossFit(evaluations, options);
  const metrics = summarizePredictions(crossFit.predictions);
  const bootstrap = deterministicBootstrap(crossFit.predictions, options);
  const byTour = segmentReport(crossFit.predictions, item => item.tour, options);
  const report = {
    success: true,
    patch: '18',
    version: TENNIS_STATISTICAL_CHALLENGER_VERSION,
    schemaVersion: TENNIS_STATISTICAL_CHALLENGER_SCHEMA_VERSION,
    mode: MODE,
    generatedAt: options.generatedAt || new Date().toISOString(),
    startedAt,
    completedAt: new Date().toISOString(),
    sourceEvaluations: crossFit.sourceRows,
    warmupRows: crossFit.warmupRows,
    oosRows: crossFit.predictions.length,
    folds: crossFit.folds,
    policy: crossFit.policy,
    metrics,
    bootstrap,
    byTour,
    byMonth: segmentReport(crossFit.predictions, item => item.matchStartAt.slice(0, 7), options),
    byConfidenceBand: segmentReport(crossFit.predictions, item => item.confidenceBand, options),
    byAgreement: segmentReport(crossFit.predictions, item => item.agreementStatus, options),
    bySeasonPair: segmentReport(crossFit.predictions, item => item.seasonPair, options),
    authority: {
      modelProbability: false,
      deepScanDecision: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      automaticPromotion: false,
      historicalBetMutation: false
    },
    note: 'Challenger statistico temporale cross-fitted: il peso storico di ogni fold è scelto soltanto sui match precedenti. Output shadow-only.'
  };
  report.stabilityGuard = stabilityGuard(report);
  if (options.includePredictions !== false) report.predictions = crossFit.predictions;
  return report;
}

function ensureStatisticalChallengerSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('PATCH18_DB_ADAPTER_REQUIRED');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_RUNS} (
      run_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      source_evaluations INTEGER NOT NULL,
      warmup_rows INTEGER NOT NULL,
      oos_rows INTEGER NOT NULL,
      fold_count INTEGER NOT NULL,
      challenger_brier REAL,
      production_brier REAL,
      historical_brier REAL,
      brier_improvement REAL,
      bootstrap_lower95 REAL,
      bootstrap_upper95 REAL,
      stability_status TEXT NOT NULL,
      report_json TEXT NOT NULL,
      report_hash TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${TABLE_PREDICTIONS} (
      prediction_id TEXT PRIMARY KEY,
      run_id TEXT,
      source_evaluation_id TEXT NOT NULL,
      bet_id INTEGER NOT NULL,
      fold_index INTEGER NOT NULL,
      trained_rows INTEGER NOT NULL,
      historical_weight REAL NOT NULL,
      tour TEXT,
      match_start_at TEXT NOT NULL,
      actual_winner_side INTEGER NOT NULL,
      production_probability_p1 REAL NOT NULL,
      historical_probability_p1 REAL NOT NULL,
      challenger_probability_p1 REAL NOT NULL,
      production_brier REAL NOT NULL,
      historical_brier REAL NOT NULL,
      challenger_brier REAL NOT NULL,
      paired_brier_improvement REAL NOT NULL,
      prediction_hash TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      version TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_stat_challenger_bet ON ${TABLE_PREDICTIONS}(bet_id, match_start_at);
    CREATE INDEX IF NOT EXISTS idx_tennis_stat_challenger_tour ON ${TABLE_PREDICTIONS}(tour, fold_index, match_start_at);
    CREATE TRIGGER IF NOT EXISTS trg_tennis_stat_challenger_runs_no_update BEFORE UPDATE ON ${TABLE_RUNS} BEGIN SELECT RAISE(ABORT,'PATCH18_IMMUTABLE_RUN'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_stat_challenger_runs_no_delete BEFORE DELETE ON ${TABLE_RUNS} BEGIN SELECT RAISE(ABORT,'PATCH18_IMMUTABLE_RUN'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_stat_challenger_predictions_no_update BEFORE UPDATE ON ${TABLE_PREDICTIONS} BEGIN SELECT RAISE(ABORT,'PATCH18_IMMUTABLE_PREDICTION'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_stat_challenger_predictions_no_delete BEFORE DELETE ON ${TABLE_PREDICTIONS} BEGIN SELECT RAISE(ABORT,'PATCH18_IMMUTABLE_PREDICTION'); END;
  `);
  return {
    version: TENNIS_STATISTICAL_CHALLENGER_SCHEMA_VERSION,
    tables: [TABLE_RUNS, TABLE_PREDICTIONS],
    immutableTriggers: [
      'trg_tennis_stat_challenger_runs_no_update',
      'trg_tennis_stat_challenger_runs_no_delete',
      'trg_tennis_stat_challenger_predictions_no_update',
      'trg_tennis_stat_challenger_predictions_no_delete'
    ]
  };
}
function persistPrediction(db, prediction, runId) {
  const existing = db.prepare(`SELECT prediction_id FROM ${TABLE_PREDICTIONS} WHERE prediction_hash=?`).get(prediction.predictionHash);
  if (existing) return { inserted: false, duplicate: true, predictionId: existing.prediction_id };
  db.prepare(`INSERT INTO ${TABLE_PREDICTIONS} (
    prediction_id,run_id,source_evaluation_id,bet_id,fold_index,trained_rows,historical_weight,tour,match_start_at,actual_winner_side,
    production_probability_p1,historical_probability_p1,challenger_probability_p1,production_brier,historical_brier,challenger_brier,
    paired_brier_improvement,prediction_hash,payload_json,created_at,version
  ) VALUES (${Array(21).fill('?').join(',')})`).run(
    prediction.predictionId, runId, prediction.sourceEvaluationId, prediction.betId, prediction.foldIndex, prediction.trainedRows,
    prediction.blendWeightHistorical, prediction.tour, prediction.matchStartAt, prediction.actualWinnerSide,
    prediction.productionProbabilityP1, prediction.historicalProbabilityP1, prediction.challengerProbabilityP1,
    prediction.productionBrier, prediction.historicalBrier, prediction.challengerBrier, prediction.pairedBrierImprovement,
    prediction.predictionHash, JSON.stringify(prediction), prediction.createdAt, TENNIS_STATISTICAL_CHALLENGER_VERSION
  );
  return { inserted: true, duplicate: false, predictionId: prediction.predictionId };
}
function persistReport(db, report) {
  ensureStatisticalChallengerSchema(db);
  const { predictions = [], persistence: _ignored, generatedAt: _generatedAt, startedAt: _startedAt, completedAt: _completedAt, ...stableCore } = report;
  const reportHash = sha256(stableCore);
  const existing = db.prepare(`SELECT run_id FROM ${TABLE_RUNS} WHERE report_hash=?`).get(reportHash);
  if (existing) return { inserted: false, duplicate: true, runId: existing.run_id, reportHash, insertedPredictions: 0, duplicatePredictions: predictions.length };
  const startedAt = report.startedAt || report.generatedAt || new Date().toISOString();
  const completedAt = report.completedAt || new Date().toISOString();
  const runId = `TSCR18_${completedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}_${reportHash.slice(0, 8)}`;
  const storedReport = { ...report, predictions: undefined, persistence: undefined };
  delete storedReport.predictions;
  delete storedReport.persistence;
  db.prepare(`INSERT INTO ${TABLE_RUNS} (
    run_id,started_at,completed_at,source_evaluations,warmup_rows,oos_rows,fold_count,challenger_brier,production_brier,historical_brier,
    brier_improvement,bootstrap_lower95,bootstrap_upper95,stability_status,report_json,report_hash,version
  ) VALUES (${Array(17).fill('?').join(',')})`).run(
    runId, startedAt, completedAt, report.sourceEvaluations, report.warmupRows, report.oosRows, report.folds.length,
    report.metrics.challengerBrier, report.metrics.productionBrier, report.metrics.historicalBrier,
    report.metrics.brierImprovementVsProduction, report.bootstrap.lower95, report.bootstrap.upper95,
    report.stabilityGuard.status, JSON.stringify(storedReport), reportHash, TENNIS_STATISTICAL_CHALLENGER_VERSION
  );
  let insertedPredictions = 0; let duplicatePredictions = 0;
  for (const prediction of predictions) {
    const result = persistPrediction(db, prediction, runId);
    if (result.inserted) insertedPredictions += 1; else duplicatePredictions += 1;
  }
  return { inserted: true, duplicate: false, runId, reportHash, insertedPredictions, duplicatePredictions };
}
function runStatisticalChallengerAudit(db, options = {}) {
  ensureStatisticalChallengerSchema(db);
  const evaluations = options.evaluations || loadRetrospectiveEvaluations(db);
  const report = buildTemporalCrossFitReport(evaluations, { ...options, includePredictions: options.includePredictions !== false });
  if (options.persist !== false) report.persistence = persistReport(db, report);
  return report;
}
function getLatestReport(db) {
  if (!tableExists(db, TABLE_RUNS)) return null;
  const row = db.prepare(`SELECT * FROM ${TABLE_RUNS} ORDER BY completed_at DESC LIMIT 1`).get();
  return row ? { ...row, report: safeJsonParse(row.report_json, null) } : null;
}
function getBetPrediction(db, betId) {
  if (!tableExists(db, TABLE_PREDICTIONS)) return { success: false, status: 'SCHEMA_MISSING', betId: Number(betId), predictions: [] };
  const rows = db.prepare(`SELECT * FROM ${TABLE_PREDICTIONS} WHERE bet_id=? ORDER BY match_start_at,fold_index`).all(Number(betId));
  return { success: true, status: rows.length ? 'AVAILABLE' : 'NO_PREDICTION', betId: Number(betId), predictions: rows.map(row => ({ ...row, payload: safeJsonParse(row.payload_json, null) })), readOnly: true };
}
function getStatisticalChallengerHealth(db) {
  const tablesPresent = tableExists(db, TABLE_RUNS) && tableExists(db, TABLE_PREDICTIONS);
  if (!tablesPresent) return {
    success: false,
    status: 'SCHEMA_MISSING',
    version: TENNIS_STATISTICAL_CHALLENGER_VERSION,
    schemaVersion: TENNIS_STATISTICAL_CHALLENGER_SCHEMA_VERSION,
    mode: MODE,
    tablesPresent: false,
    runs: 0,
    predictions: 0,
    authority: { modelProbability: false, qualityGate: false, stake: false, settlement: false, automaticPromotion: false }
  };
  const runs = Number(db.prepare(`SELECT COUNT(*) n FROM ${TABLE_RUNS}`).get().n || 0);
  const predictions = Number(db.prepare(`SELECT COUNT(*) n FROM ${TABLE_PREDICTIONS}`).get().n || 0);
  const immutableTriggers = [
    'trg_tennis_stat_challenger_runs_no_update',
    'trg_tennis_stat_challenger_runs_no_delete',
    'trg_tennis_stat_challenger_predictions_no_update',
    'trg_tennis_stat_challenger_predictions_no_delete'
  ].every(name => triggerExists(db, name));
  const latest = getLatestReport(db);
  const report = latest?.report || null;
  return {
    success: immutableTriggers,
    status: !immutableTriggers ? 'INTEGRITY_ERROR' : report?.stabilityGuard?.status || (runs ? 'READY_NO_REPORT_PAYLOAD' : 'READY_NO_RUN'),
    version: TENNIS_STATISTICAL_CHALLENGER_VERSION,
    schemaVersion: TENNIS_STATISTICAL_CHALLENGER_SCHEMA_VERSION,
    mode: MODE,
    tablesPresent,
    immutableTriggers,
    runs,
    predictions,
    latest: report,
    metrics: report?.metrics || null,
    bootstrap: report?.bootstrap || null,
    stabilityGuard: report?.stabilityGuard || { status: 'NO_AUDIT', eligible: false, promotionAuthority: false },
    authority: { modelProbability: false, deepScanDecision: false, qualityGate: false, stake: false, settlement: false, automaticPromotion: false, historicalBetMutation: false },
    note: report?.stabilityGuard?.status === 'OOS_IMPROVEMENT_OVERALL_COHORT_MIXED_RETROSPECTIVE_ONLY'
      ? 'Miglioramento Brier complessivo fuori campione, ma stabilità per circuito non ancora uniforme. Nessuna modifica production.'
      : 'Challenger statistico disponibile esclusivamente come audit shadow cross-fitted.'
  };
}

module.exports = {
  TENNIS_STATISTICAL_CHALLENGER_VERSION,
  TENNIS_STATISTICAL_CHALLENGER_SCHEMA_VERSION,
  MODE,
  TABLE_RUNS,
  TABLE_PREDICTIONS,
  DEFAULT_FOLD_COUNT,
  DEFAULT_MIN_TRAIN_ROWS,
  DEFAULT_MAX_HISTORICAL_WEIGHT,
  DEFAULT_WEIGHT_STEP,
  DEFAULT_BOOTSTRAP_ITERATIONS,
  DEFAULT_BOOTSTRAP_SEED,
  weightGrid,
  blendProbability,
  normalizeEvaluation,
  loadRetrospectiveEvaluations,
  temporalBoundaries,
  selectBlendWeight,
  temporalCrossFit,
  summarizePredictions,
  deterministicBootstrap,
  buildTemporalCrossFitReport,
  stabilityGuard,
  ensureStatisticalChallengerSchema,
  persistReport,
  runStatisticalChallengerAudit,
  getLatestReport,
  getBetPrediction,
  getStatisticalChallengerHealth
};
