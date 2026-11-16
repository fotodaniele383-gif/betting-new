'use strict';

const crypto = require('crypto');
const tennisQualityGateV2 = require('./tennisQualityGateV2');

const TENNIS_HISTORICAL_COMBINATION_VERSION = 'TENNIS_HISTORICAL_COMBINATION_EVIDENCE_V1_PATCH13';
const TENNIS_HISTORICAL_COMBINATION_MODE = 'PAPER_TRADING_RESOLVED_DS_GATE_READ_ONLY';
const PRIOR_STRENGTH = 12;
const CONFIDENCE_Z = 1.96;

const DEEP_SCAN_LABEL = Object.freeze({
  VALUE_CONFIRMED: 'VALUE CONFERMATO / MICRO',
  MODEL_RISK: 'RISCHIO MODELLO',
  TECHNICAL_EDGE: 'EDGE TECNICO',
  HIGH_RISK: 'ALTO RISCHIO',
  WATCHLIST: 'WATCHLIST LOW EDGE',
  WAIT_IN_PLAY: 'ATTENDI IN-PLAY',
  UNKNOWN: 'SENZA DEEPSCAN'
});

function numberOr(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const m = 10 ** digits;
  return Math.round(numberOr(value, 0) * m) / m;
}

function upper(...parts) {
  return parts.flat().map(value => String(value ?? '')).join(' ').toUpperCase();
}

function cleanLabel(value) {
  return String(value || 'ALTRO').replace(/^🎾\s*/u, '').replace(/\s+/g, ' ').trim() || 'ALTRO';
}

function sha256Object(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeDeepScanLabel(input = {}) {
  const code = tennisQualityGateV2.normalizeDeepScanClass(input);
  return DEEP_SCAN_LABEL[code] || 'ALTRO';
}

function normalizeQualityLabel(input = {}) {
  const explicit = upper(input.quality_final_code, input.quality_final_label, input.code, input.label);
  if (explicit.includes('HARD')) return 'BLOCCATA HARD';
  if (explicit.includes('SOFT')) return 'BLOCCATA SOFT';
  if (explicit.includes('WATCHLIST')) return 'WATCHLIST MICRO';
  if (explicit.includes('WITH_CAP') || explicit.includes('CON CAP')) return 'APPROVATA CON CAP';
  if (explicit.includes('APPROV')) return 'APPROVATA';
  return cleanLabel(tennisQualityGateV2.deriveHistoricalFinalQuality(input));
}

function isTennisRow(row = {}) {
  const text = upper(row.sport_type, row.sport, row.bet_type, row.strategy_tag, row.league);
  return text.includes('TENNIS') || text.includes('ATP') || text.includes('WTA');
}

function isResolvedRow(row = {}) {
  const status = upper(row.status).trim();
  return status === 'WON' || status === 'LOST';
}

function isCurrentQualityRow(row = {}) {
  const quality = upper(row.data_quality).trim();
  return quality === 'CURRENT' || quality === 'CURRENT_BOOTSTRAP';
}

function isSingleRow(row = {}) {
  return !upper(row.bet_type, row.betType).includes('MULTI_');
}

function parseTimestamp(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function filterHistoricalRows(rows = [], options = {}) {
  const excludeBetId = numberOr(options.excludeBetId, null);
  const cutoffId = numberOr(options.cutoffId, null);
  const asOfMs = parseTimestamp(options.asOf || options.calculatedAt || null);
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (!isTennisRow(row) || !isResolvedRow(row) || !isCurrentQualityRow(row) || !isSingleRow(row)) return false;
    const id = numberOr(row.id, null);
    if (excludeBetId !== null && id === excludeBetId) return false;
    if (cutoffId !== null && id !== null && id > cutoffId) return false;
    if (asOfMs !== null) {
      const evidenceMs = parseTimestamp(row.settled_at || row.settlement_observed_at || row.match_date);
      if (evidenceMs !== null && evidenceMs > asOfMs) return false;
    }
    return true;
  });
}

function wilsonInterval(wins, total, z = CONFIDENCE_Z) {
  const n = Math.max(0, numberOr(total, 0));
  const w = Math.max(0, Math.min(n, numberOr(wins, 0)));
  if (n === 0) return { lowPct: null, highPct: null };
  const p = w / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denominator;
  return {
    lowPct: round(Math.max(0, center - margin) * 100, 2),
    highPct: round(Math.min(1, center + margin) * 100, 2)
  };
}

function reliabilityFromSample(total) {
  const n = Math.max(0, numberOr(total, 0));
  if (n === 0) return 'NO_SAMPLE';
  if (n < 5) return 'VERY_LOW';
  if (n < 12) return 'LOW';
  if (n < 30) return 'MEDIUM';
  return 'HIGH';
}

function summarizeRows(rows = []) {
  let wins = 0;
  let losses = 0;
  let operationalResolved = 0;
  let operationalWins = 0;
  let stake = 0;
  let profit = 0;
  let maxResolvedId = 0;
  for (const row of rows) {
    const status = upper(row.status).trim();
    if (status === 'WON') wins += 1;
    else if (status === 'LOST') losses += 1;
    const rowStake = Math.max(0, numberOr(row.stake ?? row.invested, 0));
    if (rowStake > 0) {
      operationalResolved += 1;
      if (status === 'WON') operationalWins += 1;
      stake += rowStake;
      profit += numberOr(row.profit, 0);
    }
    maxResolvedId = Math.max(maxResolvedId, numberOr(row.id, 0));
  }
  const resolved = wins + losses;
  return {
    resolved,
    wins,
    losses,
    winRatePct: resolved > 0 ? round((wins / resolved) * 100, 2) : null,
    operationalResolved,
    operationalWins,
    operationalWinRatePct: operationalResolved > 0 ? round((operationalWins / operationalResolved) * 100, 2) : null,
    stake: round(stake, 2),
    profit: round(profit, 2),
    operationalRoiPct: stake > 0 ? round((profit / stake) * 100, 2) : null,
    maxResolvedId
  };
}

function buildCombinationEvidenceFromRows(rows = [], current = {}, options = {}) {
  const historical = filterHistoricalRows(rows, options);
  const deepScan = cleanLabel(options.deepScanLabel || normalizeDeepScanLabel(current.deepScan || current));
  const quality = cleanLabel(options.qualityLabel || normalizeQualityLabel(current.qualityDecision || current));
  const matching = historical.filter(row => normalizeDeepScanLabel(row) === deepScan && normalizeQualityLabel(row) === quality);
  const global = summarizeRows(historical);
  const exact = summarizeRows(matching);
  const globalRate = global.resolved > 0 ? global.wins / global.resolved : 0.5;
  const adjustedRatePct = exact.resolved > 0
    ? round(((exact.wins + PRIOR_STRENGTH * globalRate) / (exact.resolved + PRIOR_STRENGTH)) * 100, 2)
    : null;
  const interval = wilsonInterval(exact.wins, exact.resolved);
  const key = `${deepScan}|||${quality}`;
  const reliability = reliabilityFromSample(exact.resolved);
  const calculatedAt = options.calculatedAt || new Date().toISOString();
  const evidenceHash = sha256Object({
    version: TENNIS_HISTORICAL_COMBINATION_VERSION,
    key,
    exact: {
      resolved: exact.resolved,
      wins: exact.wins,
      losses: exact.losses,
      operationalResolved: exact.operationalResolved,
      stake: exact.stake,
      profit: exact.profit,
      maxResolvedId: exact.maxResolvedId
    },
    global: { resolved: global.resolved, wins: global.wins, maxResolvedId: global.maxResolvedId },
    priorStrength: PRIOR_STRENGTH
  });

  return {
    success: true,
    version: TENNIS_HISTORICAL_COMBINATION_VERSION,
    mode: TENNIS_HISTORICAL_COMBINATION_MODE,
    key,
    deepScan,
    quality,
    resolved: exact.resolved,
    wins: exact.wins,
    losses: exact.losses,
    winRatePct: exact.winRatePct,
    adjustedRatePct,
    ci95LowPct: interval.lowPct,
    ci95HighPct: interval.highPct,
    reliability,
    operationalResolved: exact.operationalResolved,
    operationalWins: exact.operationalWins,
    operationalWinRatePct: exact.operationalWinRatePct,
    operationalStake: exact.stake,
    operationalProfit: exact.profit,
    operationalRoiPct: exact.operationalRoiPct,
    globalResolved: global.resolved,
    globalWinRatePct: global.winRatePct,
    priorStrength: PRIOR_STRENGTH,
    sourceMaxResolvedId: global.maxResolvedId,
    evidenceHash,
    calculatedAt,
    asOf: options.asOf || calculatedAt,
    historicalOnly: true,
    currentResultUsed: false,
    currentClvUsed: false,
    stakeAuthority: false,
    probabilityMeaning: 'EMPIRICAL_RESOLVED_WIN_RATE_NOT_MATCH_PROBABILITY',
    note: exact.resolved === 0
      ? 'Nessun esito storico risolto per questa combinazione DeepScan × Gate.'
      : reliability === 'VERY_LOW' || reliability === 'LOW'
        ? 'Win rate empirico disponibile, ma il campione è insufficiente per autorizzare stake o promozioni.'
        : 'Win rate empirico storico della combinazione DeepScan × Gate; informativo e senza autorità operativa.'
  };
}

function loadHistoricalRows(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('DB_ADAPTER_REQUIRED');
  const limit = Math.max(100, Math.min(100000, Math.trunc(numberOr(options.limit, 100000))));
  return db.prepare(`
    SELECT *
    FROM ai_forward_test
    WHERE UPPER(COALESCE(status,'')) IN ('WON','LOST')
      AND UPPER(COALESCE(data_quality,'')) IN ('CURRENT','CURRENT_BOOTSTRAP')
      AND (UPPER(COALESCE(sport_type,''))='TENNIS'
           OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
           OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'
           OR UPPER(COALESCE(league,'')) LIKE '%ATP%'
           OR UPPER(COALESCE(league,'')) LIKE '%WTA%')
      AND UPPER(COALESCE(bet_type,'')) NOT LIKE 'MULTI_%'
    ORDER BY id
    LIMIT ?
  `).all(limit);
}

function resolveHistoricalCombinationEvidence(db, current = {}, options = {}) {
  const rows = Array.isArray(options.rows) ? options.rows : loadHistoricalRows(db, options);
  return buildCombinationEvidenceFromRows(rows, current, options);
}

function buildCombinationMatrix(db, options = {}) {
  const rows = Array.isArray(options.rows) ? filterHistoricalRows(options.rows, options) : loadHistoricalRows(db, options);
  const grouped = new Map();
  for (const row of rows) {
    const deepScan = normalizeDeepScanLabel(row);
    const quality = normalizeQualityLabel(row);
    const key = `${deepScan}|||${quality}`;
    if (!grouped.has(key)) grouped.set(key, { deepScan, quality, rows: [] });
    grouped.get(key).rows.push(row);
  }
  const global = summarizeRows(rows);
  const matrix = [...grouped.values()].map(group => buildCombinationEvidenceFromRows(rows, {}, {
    ...options,
    rows,
    deepScanLabel: group.deepScan,
    qualityLabel: group.quality,
    calculatedAt: options.calculatedAt
  })).sort((a, b) => b.resolved - a.resolved || (b.winRatePct ?? -1) - (a.winRatePct ?? -1) || a.key.localeCompare(b.key));
  return {
    success: true,
    version: TENNIS_HISTORICAL_COMBINATION_VERSION,
    mode: TENNIS_HISTORICAL_COMBINATION_MODE,
    readOnly: true,
    historicalOnly: true,
    currentResultUsed: false,
    currentClvUsed: false,
    stakeAuthority: false,
    resolvedRows: global.resolved,
    wins: global.wins,
    losses: global.losses,
    overallWinRatePct: global.winRatePct,
    sourceMaxResolvedId: global.maxResolvedId,
    combinations: matrix,
    warnings: [
      'Il win rate storico non è la probabilità matematica del singolo match.',
      'Campione, intervallo di confidenza e ROI operativo devono essere letti insieme.',
      'Il dato non modifica probabilità, DeepScan, Quality Gate o stake.'
    ]
  };
}

function toPersistenceFields(evidence = {}) {
  return {
    historical_combo_key: evidence.key || null,
    historical_combo_deepscan: evidence.deepScan || null,
    historical_combo_quality: evidence.quality || null,
    historical_combo_resolved: numberOr(evidence.resolved, 0),
    historical_combo_wins: numberOr(evidence.wins, 0),
    historical_combo_losses: numberOr(evidence.losses, 0),
    historical_combo_win_rate_pct: evidence.winRatePct,
    historical_combo_adjusted_rate_pct: evidence.adjustedRatePct,
    historical_combo_ci_low_pct: evidence.ci95LowPct,
    historical_combo_ci_high_pct: evidence.ci95HighPct,
    historical_combo_operational_resolved: numberOr(evidence.operationalResolved, 0),
    historical_combo_operational_roi_pct: evidence.operationalRoiPct,
    historical_combo_reliability: evidence.reliability || 'NO_SAMPLE',
    historical_combo_source_max_id: numberOr(evidence.sourceMaxResolvedId, 0),
    historical_combo_evidence_hash: evidence.evidenceHash || null,
    historical_combo_version: evidence.version || TENNIS_HISTORICAL_COMBINATION_VERSION,
    historical_combo_calculated_at: evidence.calculatedAt || new Date().toISOString()
  };
}

module.exports = {
  TENNIS_HISTORICAL_COMBINATION_VERSION,
  TENNIS_HISTORICAL_COMBINATION_MODE,
  PRIOR_STRENGTH,
  DEEP_SCAN_LABEL,
  normalizeDeepScanLabel,
  normalizeQualityLabel,
  isTennisRow,
  isResolvedRow,
  isCurrentQualityRow,
  isSingleRow,
  parseTimestamp,
  filterHistoricalRows,
  wilsonInterval,
  reliabilityFromSample,
  summarizeRows,
  buildCombinationEvidenceFromRows,
  loadHistoricalRows,
  resolveHistoricalCombinationEvidence,
  buildCombinationMatrix,
  toPersistenceFields
};
