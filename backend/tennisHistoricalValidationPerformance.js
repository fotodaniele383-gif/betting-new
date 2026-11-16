'use strict';

const crypto = require('crypto');
const historicalPlayerStats = require('./tennisHistoricalPlayerStats');
const { normalizePlayerName } = require('./tennisPlayerIdentity');

const TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION = 'TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_V1_PATCH17';
const TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_SCHEMA_VERSION = 'TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_SCHEMA_V1_PATCH17';
const MODE = 'SHADOW_MEASUREMENT_ONLY_NO_MODEL_GATE_STAKE_SETTLEMENT_AUTHORITY';
const TABLE_RUNS = 'tennis_historical_validation_audit_runs';
const TABLE_EVALUATIONS = 'tennis_historical_validation_evaluations';
const DEFAULT_SIGNAL_THRESHOLD = 0.56;

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function finite(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, decimals = 6) { const n = finite(value, null); return n === null ? null : Number(n.toFixed(decimals)); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex'); }
function tableExists(db, table) {
  try { return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table)); }
  catch (_) { return false; }
}
function triggerExists(db, trigger) {
  try { return Boolean(db.prepare("SELECT 1 present FROM sqlite_master WHERE type='trigger' AND name=? LIMIT 1").get(trigger)); }
  catch (_) { return false; }
}
function safeJsonParse(value, fallback = null) { try { return JSON.parse(value); } catch (_) { return fallback; } }

function parseMatchDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const raw = text(value);
  if (!raw) return null;

  // IMPORTANT: parse Italian dd/mm/yyyy explicitly before Date.parse/new Date.
  // V8 may otherwise interpret values such as 02/07/2026 as February 7,
  // silently corrupting the as-of-safe season selection.
  let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  const direct = new Date(raw);
  return Number.isFinite(direct.getTime()) ? direct : null;
}

function isTennisRow(row = {}) {
  const marker = upper([row.sport_type, row.bet_type, row.strategy_tag, row.league, row.tour_type].filter(Boolean).join(' '));
  return marker.includes('TENNIS') || marker.includes('ATP') || marker.includes('WTA');
}
function isMoneylineRow(row = {}) {
  const prediction = text(row.prediction);
  if (!['1', '2'].includes(prediction)) return false;
  const market = upper([row.market_type, row.strategy_tag].filter(Boolean).join(' '));
  if (market.includes('TOTAL') || market.includes('OVER') || market.includes('UNDER')) return false;
  return true;
}
function resolveTour(row = {}) {
  const marker = upper([row.tour_type, row.league, row.strategy_tag, row.bet_type].filter(Boolean).join(' '));
  if (marker.includes('WTA') || marker.includes('WOMEN')) return 'WTA';
  if (marker.includes('ATP') || marker.includes('MEN')) return 'ATP';
  return null;
}
function resolveActualWinnerSide(row = {}) {
  const direct = Number(row.winner_side);
  if ([1, 2].includes(direct)) return direct;
  const home = normalizePlayerName(row.home_team || row.home || row.player1);
  const away = normalizePlayerName(row.away_team || row.away || row.player2);
  const winner = normalizePlayerName(row.settlement_winner_name || row.winner_player_name || row.winner_name);
  if (winner && winner === home) return 1;
  if (winner && winner === away) return 2;
  const prediction = Number(row.prediction);
  const status = upper(row.status);
  if ([1, 2].includes(prediction) && status === 'WON') return prediction;
  if ([1, 2].includes(prediction) && status === 'LOST') return prediction === 1 ? 2 : 1;
  return null;
}
function normalizeProbability(value) {
  const n = finite(value, null);
  if (n === null) return null;
  if (n > 1 && n <= 100) return clamp(n / 100, 0.001, 0.999);
  if (n >= 0 && n <= 1) return clamp(n, 0.001, 0.999);
  return null;
}
function productionProbabilityP1(row = {}) {
  const selected = normalizeProbability(row.estimated_prob ?? row.estimatedProb ?? row.probability);
  const prediction = Number(row.prediction);
  if (selected === null || ![1, 2].includes(prediction)) return null;
  return prediction === 1 ? selected : 1 - selected;
}
function signalSide(probabilityP1, threshold = DEFAULT_SIGNAL_THRESHOLD) {
  const p = normalizeProbability(probabilityP1);
  const t = clamp(finite(threshold, DEFAULT_SIGNAL_THRESHOLD), 0.51, 0.75);
  if (p === null) return null;
  if (p >= t) return 1;
  if (p <= 1 - t) return 2;
  return 0;
}
function brier(probabilityP1, actualSide) {
  const p = normalizeProbability(probabilityP1);
  if (p === null || ![1, 2].includes(Number(actualSide))) return null;
  const y = Number(actualSide) === 1 ? 1 : 0;
  return (p - y) ** 2;
}
function logLoss(probabilityP1, actualSide) {
  const p = normalizeProbability(probabilityP1);
  if (p === null || ![1, 2].includes(Number(actualSide))) return null;
  const selected = Number(actualSide) === 1 ? p : 1 - p;
  return -Math.log(clamp(selected, 0.001, 0.999));
}

function ensureHistoricalValidationPerformanceSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('PATCH17_DB_ADAPTER_REQUIRED');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_RUNS} (
      run_id TEXT PRIMARY KEY,
      run_mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      candidate_rows INTEGER NOT NULL,
      eligible_rows INTEGER NOT NULL,
      covered_rows INTEGER NOT NULL,
      actionable_rows INTEGER NOT NULL,
      signal_correct INTEGER NOT NULL,
      coverage_pct REAL,
      signal_accuracy_pct REAL,
      validation_brier REAL,
      production_brier REAL,
      brier_delta REAL,
      forward_certified_rows INTEGER NOT NULL,
      performance_gate_status TEXT NOT NULL,
      report_json TEXT NOT NULL,
      report_hash TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${TABLE_EVALUATIONS} (
      evaluation_id TEXT PRIMARY KEY,
      run_id TEXT,
      evaluation_mode TEXT NOT NULL,
      bet_id INTEGER NOT NULL,
      prediction_snapshot_id TEXT,
      tour TEXT,
      match_start_at TEXT NOT NULL,
      player1_name TEXT NOT NULL,
      player2_name TEXT NOT NULL,
      predicted_side INTEGER,
      actual_winner_side INTEGER NOT NULL,
      production_probability_p1 REAL,
      validation_probability_p1 REAL NOT NULL,
      validation_probability_selected REAL,
      validation_label TEXT,
      validation_signal_side INTEGER,
      validation_signal_correct INTEGER,
      production_correct INTEGER,
      agreement_status TEXT,
      confidence_score REAL,
      season_p1 INTEGER,
      season_p2 INTEGER,
      validation_brier REAL,
      production_brier REAL,
      validation_log_loss REAL,
      production_log_loss REAL,
      source_dataset_id TEXT,
      validation_hash TEXT NOT NULL,
      evaluation_hash TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      version TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_hist_validation_eval_bet ON ${TABLE_EVALUATIONS}(bet_id, evaluation_mode);
    CREATE INDEX IF NOT EXISTS idx_tennis_hist_validation_eval_mode ON ${TABLE_EVALUATIONS}(evaluation_mode, tour, match_start_at);
    CREATE TRIGGER IF NOT EXISTS trg_tennis_hist_validation_runs_no_update BEFORE UPDATE ON ${TABLE_RUNS} BEGIN SELECT RAISE(ABORT,'PATCH17_IMMUTABLE_RUN'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_hist_validation_runs_no_delete BEFORE DELETE ON ${TABLE_RUNS} BEGIN SELECT RAISE(ABORT,'PATCH17_IMMUTABLE_RUN'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_hist_validation_evals_no_update BEFORE UPDATE ON ${TABLE_EVALUATIONS} BEGIN SELECT RAISE(ABORT,'PATCH17_IMMUTABLE_EVALUATION'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_hist_validation_evals_no_delete BEFORE DELETE ON ${TABLE_EVALUATIONS} BEGIN SELECT RAISE(ABORT,'PATCH17_IMMUTABLE_EVALUATION'); END;
  `);
  return {
    version: TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_SCHEMA_VERSION,
    tables: [TABLE_RUNS, TABLE_EVALUATIONS],
    immutableTriggers: [
      'trg_tennis_hist_validation_runs_no_update',
      'trg_tennis_hist_validation_runs_no_delete',
      'trg_tennis_hist_validation_evals_no_update',
      'trg_tennis_hist_validation_evals_no_delete'
    ]
  };
}

function buildEvaluation(row = {}, validation = {}, options = {}) {
  const mode = options.mode || 'RETROSPECTIVE_AS_OF_SAFE';
  const matchDate = parseMatchDate(options.matchStartAt || row.canonical_match_datetime || row.match_date || row.commence_time);
  const actualSide = resolveActualWinnerSide(row);
  const predictedSide = [1, 2].includes(Number(row.prediction)) ? Number(row.prediction) : null;
  const validationP1 = normalizeProbability(validation.validationProbabilityP1);
  const productionP1 = productionProbabilityP1(row);
  if (!matchDate || ![1, 2].includes(actualSide) || validationP1 === null) return null;
  const threshold = options.signalThreshold || DEFAULT_SIGNAL_THRESHOLD;
  const histSide = signalSide(validationP1, threshold);
  const selectedHistProbability = predictedSide === 1 ? validationP1 : predictedSide === 2 ? 1 - validationP1 : null;
  const productionSide = productionP1 === null ? predictedSide : (productionP1 >= 0.5 ? 1 : 2);
  const agreement = histSide === 0 ? 'HISTORICAL_BALANCED' : histSide && productionSide ? (histSide === productionSide ? 'AGREES_WITH_PRODUCTION' : 'DISAGREES_WITH_PRODUCTION') : 'UNRESOLVED';
  const createdAt = options.createdAt || new Date().toISOString();
  const core = {
    version: TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION,
    mode,
    betId: Number(row.id || row.bet_id),
    predictionSnapshotId: options.predictionSnapshotId || null,
    tour: validation.tour || resolveTour(row),
    matchStartAt: matchDate.toISOString(),
    player1Name: text(row.home_team || row.home || row.player1),
    player2Name: text(row.away_team || row.away || row.player2),
    predictedSide,
    actualWinnerSide: actualSide,
    productionProbabilityP1: round(productionP1),
    validationProbabilityP1: round(validationP1),
    validationProbabilitySelected: round(selectedHistProbability),
    validationLabel: validation.label || null,
    validationSignalSide: histSide,
    validationSignalCorrect: histSide === 0 || histSide === null ? null : (histSide === actualSide ? 1 : 0),
    productionCorrect: productionSide ? (productionSide === actualSide ? 1 : 0) : null,
    agreementStatus: agreement,
    confidenceScore: round(validation.confidenceScore, 2),
    seasonP1: finite(validation.seasonP1, null),
    seasonP2: finite(validation.seasonP2, null),
    validationBrier: round(brier(validationP1, actualSide)),
    productionBrier: round(brier(productionP1, actualSide)),
    validationLogLoss: round(logLoss(validationP1, actualSide)),
    productionLogLoss: round(logLoss(productionP1, actualSide)),
    sourceDatasetId: options.datasetId || null,
    validationHash: validation.validationHash || sha256(validation),
    historicalBackfillAuthority: false,
    modelProbabilityAuthority: false,
    qualityGateAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false,
    createdAt
  };
  const hashCore = { ...core };
  delete hashCore.createdAt;
  const evaluationHash = sha256(hashCore);
  return { ...core, evaluationHash, evaluationId: `THVE17_${evaluationHash.slice(0, 24)}` };
}

function evaluateRetrospectiveRow(row = {}, options = {}) {
  if (!isTennisRow(row)) return { status: 'EXCLUDED', reason: 'NON_TENNIS' };
  if (!isMoneylineRow(row)) return { status: 'EXCLUDED', reason: 'NON_MONEYLINE_OR_INVALID_PREDICTION' };
  if (!['WON', 'LOST'].includes(upper(row.status))) return { status: 'EXCLUDED', reason: 'UNSETTLED_OR_VOID' };
  const matchDate = parseMatchDate(row.canonical_match_datetime || row.match_date || row.commence_time);
  if (!matchDate) return { status: 'EXCLUDED', reason: 'MATCH_DATE_INVALID' };
  const actual = resolveActualWinnerSide(row);
  if (![1, 2].includes(actual)) return { status: 'EXCLUDED', reason: 'ACTUAL_WINNER_UNRESOLVED' };
  const tour = resolveTour(row);
  const player1 = text(row.home_team || row.home || row.player1);
  const player2 = text(row.away_team || row.away || row.player2);
  if (!player1 || !player2) return { status: 'EXCLUDED', reason: 'PLAYER_NAMES_MISSING' };
  const validation = historicalPlayerStats.buildMatchValidation(player1, player2, tour, matchDate.toISOString(), {
    datasetPath: options.datasetPath,
    optional: true
  });
  if (validation.status !== 'READY_SHADOW_VALIDATION') return { status: 'ELIGIBLE_NOT_COVERED', reason: validation.status, validation };
  const datasetStatus = historicalPlayerStats.getStatus({ datasetPath: options.datasetPath, initialize: true });
  const evaluation = buildEvaluation(row, validation, {
    mode: 'RETROSPECTIVE_AS_OF_SAFE',
    datasetId: datasetStatus.datasetId,
    signalThreshold: options.signalThreshold,
    createdAt: options.createdAt
  });
  return evaluation ? { status: 'COVERED', evaluation, validation } : { status: 'ELIGIBLE_NOT_COVERED', reason: 'EVALUATION_BUILD_FAILED', validation };
}

function historicalValidationFromMatchupPayload(payload) {
  const parsed = typeof payload === 'string' ? safeJsonParse(payload, null) : payload;
  return parsed?.historicalValidation || parsed?.matchup?.historicalValidation || null;
}
function evaluateForwardRow(row = {}, matchupRow = {}, options = {}) {
  if (!isTennisRow(row) || !isMoneylineRow(row) || !['WON', 'LOST'].includes(upper(row.status))) return { status: 'EXCLUDED', reason: 'FORWARD_SOURCE_NOT_ELIGIBLE' };
  const validation = historicalValidationFromMatchupPayload(matchupRow.payload_json || matchupRow.payloadJson || matchupRow);
  if (!validation || validation.status !== 'READY_SHADOW_VALIDATION') return { status: 'ELIGIBLE_NOT_COVERED', reason: 'FORWARD_HISTORICAL_VALIDATION_MISSING' };
  const evaluation = buildEvaluation(row, validation, {
    mode: 'FORWARD_CERTIFIED',
    predictionSnapshotId: matchupRow.prediction_snapshot_id || options.predictionSnapshotId,
    datasetId: options.datasetId,
    signalThreshold: options.signalThreshold,
    matchStartAt: matchupRow.as_of_at || row.canonical_match_datetime || row.match_date,
    createdAt: options.createdAt
  });
  return evaluation ? { status: 'COVERED', evaluation, validation } : { status: 'ELIGIBLE_NOT_COVERED', reason: 'FORWARD_EVALUATION_BUILD_FAILED' };
}

function candidateRows(db, betId = null) {
  const where = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')";
  const settled = "UPPER(COALESCE(status,'')) IN ('WON','LOST') AND CAST(prediction AS TEXT) IN ('1','2')";
  if (Number(betId) > 0) return db.prepare(`SELECT * FROM ai_forward_test WHERE id=? AND ${where} AND ${settled}`).all(Number(betId));
  return db.prepare(`SELECT * FROM ai_forward_test WHERE ${where} AND ${settled} ORDER BY id`).all();
}
function collectRetrospectiveEvaluations(db, options = {}) {
  const rows = candidateRows(db, options.betId);
  const evaluations = []; const excluded = {};
  let eligibleRows = 0;
  for (const row of rows) {
    const result = evaluateRetrospectiveRow(row, options);
    if (result.status !== 'EXCLUDED') eligibleRows += 1;
    if (result.evaluation) evaluations.push(result.evaluation);
    else excluded[result.reason || result.status] = (excluded[result.reason || result.status] || 0) + 1;
  }
  return { candidateRows: rows.length, eligibleRows, evaluations, excluded };
}
function collectForwardEvaluations(db, options = {}) {
  if (!tableExists(db, 'tennis_matchup_feature_snapshots')) return { candidateRows: 0, eligibleRows: 0, evaluations: [], excluded: { MATCHUP_SCHEMA_MISSING: 1 } };
  const rows = candidateRows(db, options.betId);
  const evaluations = []; const excluded = {}; let eligibleRows = 0;
  for (const row of rows) {
    const matchup = db.prepare('SELECT * FROM tennis_matchup_feature_snapshots WHERE bet_id=? ORDER BY created_at LIMIT 1').get(Number(row.id));
    if (!matchup) { excluded.FORWARD_MATCHUP_SNAPSHOT_MISSING = (excluded.FORWARD_MATCHUP_SNAPSHOT_MISSING || 0) + 1; continue; }
    eligibleRows += 1;
    const result = evaluateForwardRow(row, matchup, options);
    if (result.evaluation) evaluations.push(result.evaluation);
    else excluded[result.reason || result.status] = (excluded[result.reason || result.status] || 0) + 1;
  }
  return { candidateRows: rows.length, eligibleRows, evaluations, excluded };
}

function calibrationBuckets(evaluations) {
  const buckets = new Map();
  for (const item of evaluations) {
    const p = item.validationProbabilityP1;
    if (!Number.isFinite(p)) continue;
    const lower = Math.floor(clamp(p, 0, 0.999999) * 10) / 10;
    const key = `${lower.toFixed(1)}-${(lower + 0.1).toFixed(1)}`;
    if (!buckets.has(key)) buckets.set(key, { bucket: key, count: 0, avgProbabilityP1: 0, actualP1Wins: 0 });
    const bucket = buckets.get(key); bucket.count += 1; bucket.avgProbabilityP1 += p; if (item.actualWinnerSide === 1) bucket.actualP1Wins += 1;
  }
  return [...buckets.values()].map(item => ({
    bucket: item.bucket,
    count: item.count,
    avgProbabilityP1: round(item.avgProbabilityP1 / item.count, 4),
    actualP1Rate: round(item.actualP1Wins / item.count, 4),
    calibrationGap: round(item.avgProbabilityP1 / item.count - item.actualP1Wins / item.count, 4)
  }));
}
function segmentMetrics(evaluations, keyFn) {
  const groups = new Map();
  for (const item of evaluations) {
    const key = text(keyFn(item)) || 'UNKNOWN';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Object.fromEntries([...groups.entries()].map(([key, items]) => [key, summarizeEvaluationMetrics(items)]));
}
function avg(items) { const values = items.filter(Number.isFinite); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function summarizeEvaluationMetrics(evaluations = []) {
  const actionable = evaluations.filter(item => [1, 2].includes(item.validationSignalSide));
  const correct = actionable.filter(item => item.validationSignalCorrect === 1).length;
  const productionKnown = evaluations.filter(item => item.productionCorrect !== null);
  const agreement = actionable.filter(item => item.agreementStatus === 'AGREES_WITH_PRODUCTION');
  const disagreement = actionable.filter(item => item.agreementStatus === 'DISAGREES_WITH_PRODUCTION');
  return {
    coveredRows: evaluations.length,
    actionableRows: actionable.length,
    balancedRows: evaluations.filter(item => item.validationSignalSide === 0).length,
    signalCorrect: correct,
    signalAccuracyPct: actionable.length ? round(correct / actionable.length * 100, 2) : null,
    productionAccuracyPct: productionKnown.length ? round(productionKnown.filter(item => item.productionCorrect === 1).length / productionKnown.length * 100, 2) : null,
    validationBrier: round(avg(evaluations.map(item => item.validationBrier)), 6),
    productionBrier: round(avg(evaluations.map(item => item.productionBrier)), 6),
    validationLogLoss: round(avg(evaluations.map(item => item.validationLogLoss)), 6),
    productionLogLoss: round(avg(evaluations.map(item => item.productionLogLoss)), 6),
    agreementRows: agreement.length,
    agreementProductionAccuracyPct: agreement.length ? round(agreement.filter(item => item.productionCorrect === 1).length / agreement.length * 100, 2) : null,
    disagreementRows: disagreement.length,
    disagreementProductionAccuracyPct: disagreement.length ? round(disagreement.filter(item => item.productionCorrect === 1).length / disagreement.length * 100, 2) : null,
    averageConfidenceScore: round(avg(evaluations.map(item => item.confidenceScore)), 2)
  };
}
function performanceGate(mode, metrics, coveragePct) {
  if (mode !== 'FORWARD_CERTIFIED') return {
    status: 'NOT_ELIGIBLE_RETROSPECTIVE_ONLY',
    eligible: false,
    promotionAuthority: false,
    reason: 'Il benchmark retrospettivo è diagnostico e non può promuovere pesi production.'
  };
  const brierDelta = metrics.productionBrier !== null && metrics.validationBrier !== null ? metrics.productionBrier - metrics.validationBrier : null;
  const conditions = {
    minimumActionableRows: metrics.actionableRows >= 100,
    minimumCoverage: coveragePct >= 60,
    minimumSignalAccuracy: finite(metrics.signalAccuracyPct, 0) >= 55,
    minimumBrierImprovement: brierDelta !== null && brierDelta >= 0.005
  };
  const eligible = Object.values(conditions).every(Boolean);
  return {
    status: eligible ? 'MANUAL_REVIEW_ELIGIBLE' : metrics.coveredRows ? 'INSUFFICIENT_FORWARD_EVIDENCE' : 'NO_FORWARD_SAMPLE',
    eligible,
    promotionAuthority: false,
    manualReviewRequired: true,
    brierImprovement: round(brierDelta, 6),
    conditions,
    reason: eligible
      ? 'Le soglie minime sono raggiunte, ma qualsiasi promozione richiede una patch separata e approvazione manuale.'
      : 'Il campione forward non dimostra ancora un miglioramento sufficiente e stabile.'
  };
}
function summarizeCollection(collection, mode, options = {}) {
  const metrics = summarizeEvaluationMetrics(collection.evaluations);
  const coveragePct = collection.eligibleRows ? round(collection.evaluations.length / collection.eligibleRows * 100, 2) : 0;
  const gate = performanceGate(mode, metrics, coveragePct);
  return {
    success: true,
    patch: '17',
    version: TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION,
    mode,
    generatedAt: options.generatedAt || new Date().toISOString(),
    candidateRows: collection.candidateRows,
    eligibleRows: collection.eligibleRows,
    coveredRows: collection.evaluations.length,
    coveragePct,
    excluded: collection.excluded,
    metrics,
    byTour: segmentMetrics(collection.evaluations, item => item.tour),
    bySeasonPair: segmentMetrics(collection.evaluations, item => `${item.seasonP1 || 'NA'}-${item.seasonP2 || 'NA'}`),
    calibrationBuckets: calibrationBuckets(collection.evaluations),
    performanceGate: gate,
    authority: {
      modelProbability: false,
      deepScanDecision: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      automaticPromotion: false,
      historicalBetMutation: false
    },
    note: mode === 'FORWARD_CERTIFIED'
      ? 'Misura le validazioni storiche salvate al momento della previsione e poi collegate a settlement certificati.'
      : 'Benchmark retrospettivo as-of-safe: usa solo la stagione disponibile prima del match e non riscrive le scommesse.'
  };
}

function persistEvaluation(db, evaluation, runId = null) {
  ensureHistoricalValidationPerformanceSchema(db);
  const existing = db.prepare(`SELECT evaluation_id FROM ${TABLE_EVALUATIONS} WHERE evaluation_hash=?`).get(evaluation.evaluationHash);
  if (existing) return { inserted: false, duplicate: true, evaluationId: existing.evaluation_id };
  db.prepare(`INSERT INTO ${TABLE_EVALUATIONS} (
    evaluation_id,run_id,evaluation_mode,bet_id,prediction_snapshot_id,tour,match_start_at,player1_name,player2_name,predicted_side,
    actual_winner_side,production_probability_p1,validation_probability_p1,validation_probability_selected,validation_label,
    validation_signal_side,validation_signal_correct,production_correct,agreement_status,confidence_score,season_p1,season_p2,
    validation_brier,production_brier,validation_log_loss,production_log_loss,source_dataset_id,validation_hash,evaluation_hash,payload_json,
    created_at,version
  ) VALUES (${Array(32).fill('?').join(',')})`).run(
    evaluation.evaluationId, runId, evaluation.mode, evaluation.betId, evaluation.predictionSnapshotId, evaluation.tour,
    evaluation.matchStartAt, evaluation.player1Name, evaluation.player2Name, evaluation.predictedSide, evaluation.actualWinnerSide,
    evaluation.productionProbabilityP1, evaluation.validationProbabilityP1, evaluation.validationProbabilitySelected,
    evaluation.validationLabel, evaluation.validationSignalSide, evaluation.validationSignalCorrect, evaluation.productionCorrect,
    evaluation.agreementStatus, evaluation.confidenceScore, evaluation.seasonP1, evaluation.seasonP2, evaluation.validationBrier,
    evaluation.productionBrier, evaluation.validationLogLoss, evaluation.productionLogLoss, evaluation.sourceDatasetId,
    evaluation.validationHash, evaluation.evaluationHash, JSON.stringify(evaluation), evaluation.createdAt,
    TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION
  );
  return { inserted: true, duplicate: false, evaluationId: evaluation.evaluationId };
}
function persistRun(db, report) {
  ensureHistoricalValidationPerformanceSchema(db);
  const startedAt = report.startedAt || report.generatedAt || new Date().toISOString();
  const completedAt = report.completedAt || new Date().toISOString();
  const { evaluations = [], persistence: _ignoredPersistence, ...reportSummary } = report;
  const reportCore = { ...reportSummary, startedAt, completedAt };
  const reportHash = sha256(reportCore);
  const existing = db.prepare(`SELECT run_id FROM ${TABLE_RUNS} WHERE report_hash=?`).get(reportHash);
  if (existing) return { inserted: false, duplicate: true, runId: existing.run_id, reportHash };
  const runId = `THVR17_${report.mode}_${completedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}_${reportHash.slice(0, 8)}`;
  db.prepare(`INSERT INTO ${TABLE_RUNS} (run_id,run_mode,started_at,completed_at,candidate_rows,eligible_rows,covered_rows,actionable_rows,signal_correct,coverage_pct,signal_accuracy_pct,validation_brier,production_brier,brier_delta,forward_certified_rows,performance_gate_status,report_json,report_hash,version) VALUES (${Array(19).fill('?').join(',')})`).run(
    runId, report.mode, startedAt, completedAt, report.candidateRows, report.eligibleRows, report.coveredRows,
    report.metrics.actionableRows, report.metrics.signalCorrect, report.coveragePct, report.metrics.signalAccuracyPct,
    report.metrics.validationBrier, report.metrics.productionBrier,
    report.metrics.productionBrier !== null && report.metrics.validationBrier !== null ? round(report.metrics.productionBrier - report.metrics.validationBrier) : null,
    report.mode === 'FORWARD_CERTIFIED' ? report.coveredRows : 0, report.performanceGate.status,
    JSON.stringify(reportCore), reportHash, TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION
  );
  let insertedEvaluations = 0; let duplicateEvaluations = 0;
  for (const evaluation of evaluations) {
    const result = persistEvaluation(db, evaluation, runId);
    if (result.inserted) insertedEvaluations += 1; else duplicateEvaluations += 1;
  }
  return { inserted: true, duplicate: false, runId, reportHash, insertedEvaluations, duplicateEvaluations };
}

function runRetrospectiveAudit(db, options = {}) {
  const startedAt = new Date().toISOString();
  const collection = collectRetrospectiveEvaluations(db, options);
  const report = summarizeCollection(collection, 'RETROSPECTIVE_AS_OF_SAFE', { generatedAt: options.generatedAt });
  report.startedAt = startedAt;
  report.completedAt = new Date().toISOString();
  if (options.includeEvaluations !== false) report.evaluations = collection.evaluations;
  if (options.persist === true) report.persistence = persistRun(db, report);
  return report;
}
function refreshForwardPerformance(db, options = {}) {
  const startedAt = new Date().toISOString();
  const collection = collectForwardEvaluations(db, options);
  const report = summarizeCollection(collection, 'FORWARD_CERTIFIED', { generatedAt: options.generatedAt });
  report.startedAt = startedAt;
  report.completedAt = new Date().toISOString();
  if (options.includeEvaluations !== false) report.evaluations = collection.evaluations;
  if (options.persist !== false) report.persistence = persistRun(db, report);
  return report;
}
function getLatestReport(db, mode = null) {
  if (!tableExists(db, TABLE_RUNS)) return null;
  const row = mode
    ? db.prepare(`SELECT * FROM ${TABLE_RUNS} WHERE run_mode=? ORDER BY completed_at DESC LIMIT 1`).get(mode)
    : db.prepare(`SELECT * FROM ${TABLE_RUNS} ORDER BY completed_at DESC LIMIT 1`).get();
  return row ? { ...row, report: safeJsonParse(row.report_json, null) } : null;
}
function getBetEvaluations(db, betId) {
  if (!tableExists(db, TABLE_EVALUATIONS)) return { success: false, status: 'SCHEMA_MISSING', betId: Number(betId), evaluations: [] };
  const rows = db.prepare(`SELECT * FROM ${TABLE_EVALUATIONS} WHERE bet_id=? ORDER BY created_at,evaluation_mode`).all(Number(betId));
  return { success: true, status: rows.length ? 'AVAILABLE' : 'NO_EVALUATION', betId: Number(betId), evaluations: rows.map(row => ({ ...row, payload: safeJsonParse(row.payload_json, null) })), readOnly: true };
}
function getPerformanceHealth(db) {
  const tablesPresent = tableExists(db, TABLE_RUNS) && tableExists(db, TABLE_EVALUATIONS);
  if (!tablesPresent) return {
    success: false, status: 'SCHEMA_MISSING', version: TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION,
    mode: MODE, tablesPresent: false, runs: 0, evaluations: 0, forwardEvaluations: 0, retrospectiveEvaluations: 0,
    authority: { modelProbability: false, qualityGate: false, stake: false, settlement: false, automaticPromotion: false }
  };
  const runs = Number(db.prepare(`SELECT COUNT(*) n FROM ${TABLE_RUNS}`).get().n || 0);
  const counts = db.prepare(`SELECT COUNT(*) evaluations, SUM(CASE WHEN evaluation_mode='FORWARD_CERTIFIED' THEN 1 ELSE 0 END) forwardEvaluations, SUM(CASE WHEN evaluation_mode='RETROSPECTIVE_AS_OF_SAFE' THEN 1 ELSE 0 END) retrospectiveEvaluations FROM ${TABLE_EVALUATIONS}`).get();
  const triggers = [
    'trg_tennis_hist_validation_runs_no_update','trg_tennis_hist_validation_runs_no_delete',
    'trg_tennis_hist_validation_evals_no_update','trg_tennis_hist_validation_evals_no_delete'
  ];
  const immutable = triggers.every(name => triggerExists(db, name));
  const latestForward = getLatestReport(db, 'FORWARD_CERTIFIED');
  const latestRetrospective = getLatestReport(db, 'RETROSPECTIVE_AS_OF_SAFE');
  const forwardCount = Number(counts.forwardEvaluations || 0);
  return {
    success: immutable,
    status: !immutable ? 'INTEGRITY_ERROR' : forwardCount > 0 ? 'FORWARD_MEASUREMENT_ACTIVE' : latestRetrospective ? 'RETROSPECTIVE_BASELINE_READY_NO_FORWARD_SAMPLE' : 'READY_NO_MEASUREMENT',
    version: TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION,
    schemaVersion: TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_SCHEMA_VERSION,
    mode: MODE,
    tablesPresent,
    immutableTriggers: immutable,
    runs,
    evaluations: Number(counts.evaluations || 0),
    forwardEvaluations: forwardCount,
    retrospectiveEvaluations: Number(counts.retrospectiveEvaluations || 0),
    latestForward: latestForward?.report || null,
    latestRetrospective: latestRetrospective?.report || null,
    performanceGate: latestForward?.report?.performanceGate || { status: 'NO_FORWARD_SAMPLE', eligible: false, promotionAuthority: false },
    authority: { modelProbability: false, deepScanDecision: false, qualityGate: false, stake: false, settlement: false, automaticPromotion: false, historicalBetMutation: false },
    note: forwardCount > 0
      ? 'Misurazione forward attiva; qualsiasi promozione richiede una patch separata e revisione manuale.'
      : 'Baseline retrospettiva disponibile. Il segnale resta shadow finché non esiste un campione forward certificato.'
  };
}

module.exports = {
  TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_VERSION,
  TENNIS_HISTORICAL_VALIDATION_PERFORMANCE_SCHEMA_VERSION,
  MODE,
  TABLE_RUNS,
  TABLE_EVALUATIONS,
  DEFAULT_SIGNAL_THRESHOLD,
  parseMatchDate,
  isTennisRow,
  isMoneylineRow,
  resolveTour,
  resolveActualWinnerSide,
  productionProbabilityP1,
  signalSide,
  ensureHistoricalValidationPerformanceSchema,
  evaluateRetrospectiveRow,
  evaluateForwardRow,
  collectRetrospectiveEvaluations,
  collectForwardEvaluations,
  summarizeEvaluationMetrics,
  summarizeCollection,
  runRetrospectiveAudit,
  refreshForwardPerformance,
  getLatestReport,
  getBetEvaluations,
  getPerformanceHealth,
  persistEvaluation,
  persistRun
};
