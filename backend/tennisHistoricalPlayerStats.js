'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizePlayerName, buildSafeIdentityCandidates } = require('./tennisPlayerIdentity');

const TENNIS_HISTORICAL_PLAYER_STATS_VERSION = 'TENNIS_HISTORICAL_PLAYER_STATS_V2_PATCH26';
const TENNIS_HISTORICAL_PLAYER_STATS_SCHEMA_VERSION = 'TENNIS_HISTORICAL_PLAYER_STATS_SCHEMA_V1_PATCH16';
const TENNIS_HISTORICAL_PLAYER_STATS_MODE = 'CANONICAL_DEEPSCAN_CONTEXT_NO_MODEL_GATE_STAKE_SETTLEMENT_AUTHORITY';
const TABLE_IMPORTS = 'tennis_historical_dataset_imports';
const TABLE_RECORDS = 'tennis_historical_player_records';
const DEFAULT_DATASET_PATH = path.resolve(__dirname, '..', 'data', 'tennisdb_historical_player_stats.json');

const state = {
  loaded: false,
  datasetPath: null,
  dataset: null,
  loadedAt: null,
  activeByName: new Map(),
  error: null
};

function finite(value, fallback = null) { if (value === null || value === undefined || value === '') return fallback; const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, decimals = 4) { const n = finite(value, null); return n === null ? null : Number(n.toFixed(decimals)); }
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function normalizeTour(value) {
  const text = String(value || '').toUpperCase();
  if (text.includes('WTA') || text.includes('WOMEN')) return 'WTA';
  if (text.includes('ATP') || text.includes('MEN')) return 'ATP';
  return null;
}
function parseDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function tableExists(db, table) {
  try { return Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n || 0) === 1; }
  catch (_) { return false; }
}
function triggerExists(db, trigger) {
  try { return Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger).n || 0) === 1; }
  catch (_) { return false; }
}

function reset() {
  state.loaded = false;
  state.datasetPath = null;
  state.dataset = null;
  state.loadedAt = null;
  state.activeByName = new Map();
  state.error = null;
}

function validateDataset(dataset) {
  if (!dataset || typeof dataset !== 'object') throw new Error('PATCH16_DATASET_INVALID');
  if (!String(dataset.version || '').includes('PATCH16')) throw new Error(`PATCH16_DATASET_VERSION_INVALID:${dataset.version}`);
  if (!Array.isArray(dataset.records)) throw new Error('PATCH16_DATASET_RECORDS_MISSING');
  if (dataset.authority?.modelProbability !== false || dataset.authority?.stake !== false || dataset.authority?.settlement !== false) {
    throw new Error('PATCH16_DATASET_AUTHORITY_CONTRACT_INVALID');
  }
  return true;
}

function loadDataset(datasetPath = DEFAULT_DATASET_PATH, options = {}) {
  const resolved = path.resolve(datasetPath);
  if (state.loaded && state.datasetPath === resolved && options.force !== true) return getStatus();
  reset();
  state.datasetPath = resolved;
  try {
    if (!fs.existsSync(resolved)) throw new Error(`PATCH16_DATASET_NOT_FOUND:${resolved}`);
    const dataset = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    validateDataset(dataset);
    const index = new Map();
    for (const record of dataset.records) {
      if (record.recordStatus !== 'ACTIVE') continue;
      const key = normalizePlayerName(record.normalizedName || record.playerName);
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(record);
    }
    for (const records of index.values()) records.sort((a, b) => Number(b.season) - Number(a.season));
    state.dataset = dataset;
    state.activeByName = index;
    state.loadedAt = new Date().toISOString();
    state.loaded = true;
    return getStatus();
  } catch (error) {
    state.error = error.message;
    if (options.optional === true) return getStatus();
    throw error;
  }
}

function ensureLoaded(options = {}) {
  if (!state.loaded) loadDataset(options.datasetPath || DEFAULT_DATASET_PATH, { optional: options.optional === true });
  return state.loaded;
}

function getStatus(options = {}) {
  if (!state.loaded && options.initialize !== false) {
    try { loadDataset(options.datasetPath || DEFAULT_DATASET_PATH, { optional: true }); } catch (_) {}
  }
  const dataset = state.dataset;
  return {
    success: state.loaded,
    loaded: state.loaded,
    status: state.loaded ? ((dataset?.quality?.warningCount || 0) > 0 ? 'READY_WITH_QUARANTINE' : 'READY') : 'UNAVAILABLE',
    version: TENNIS_HISTORICAL_PLAYER_STATS_VERSION,
    schemaVersion: TENNIS_HISTORICAL_PLAYER_STATS_SCHEMA_VERSION,
    mode: TENNIS_HISTORICAL_PLAYER_STATS_MODE,
    datasetPath: state.datasetPath || path.resolve(options.datasetPath || DEFAULT_DATASET_PATH),
    datasetId: dataset?.datasetId || null,
    datasetHash: dataset?.datasetHash || null,
    importedAt: dataset?.importedAt || null,
    sourceObservedAt: dataset?.sourceObservedAt || null,
    activeRecords: dataset?.quality?.activeRecords || 0,
    quarantinedRecords: dataset?.quality?.quarantinedRecords || 0,
    activeByTour: dataset?.quality?.activeByTour || { ATP: 0, WTA: 0 },
    seasons: dataset?.quality?.seasons || { ATP: [], WTA: [] },
    linkCoveragePct: dataset?.quality?.linkCoveragePct ?? null,
    formatParity: dataset?.source?.formatParity?.status || null,
    warningCount: dataset?.quality?.warningCount || 0,
    warningCodes: [...new Set((dataset?.warnings || []).map(item => item.code))],
    modelProbabilityAuthority: false,
    deepScanContextAuthority: true,
    qualityGateAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false,
    temporalLeakageGuard: true,
    error: state.error
  };
}

function inferTourForName(normalized, requestedTour) {
  const explicit = normalizeTour(requestedTour);
  if (explicit) return explicit;
  const records = state.activeByName.get(normalized) || [];
  const tours = [...new Set(records.map(item => item.tour))];
  return tours.length === 1 ? tours[0] : null;
}

function resolveHistoricalIdentity(playerName, requestedTour) {
  const exact = normalizePlayerName(playerName);
  const candidates = buildSafeIdentityCandidates(playerName);
  const explicitTour = normalizeTour(requestedTour);
  const matches = [];
  for (const candidate of candidates) {
    const rows = state.activeByName.get(candidate) || [];
    const filtered = explicitTour ? rows.filter(row => row.tour === explicitTour) : rows;
    if (filtered.length) matches.push({ normalizedName: candidate, rows: filtered, status: candidate === exact ? 'EXACT' : 'SAFE_SUFFIX_ALIAS' });
  }
  const unique = [...new Map(matches.map(item => [item.normalizedName, item])).values()];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return { normalizedName: null, rows: [], status: 'CONFLICT', reason: 'MULTIPLE_HISTORICAL_IDENTITY_CANDIDATES' };
  return { normalizedName: exact, rows: [], status: 'UNAVAILABLE', reason: 'PLAYER_NOT_FOUND' };
}

function getPlayerHistory(playerName, tour, asOf, options = {}) {
  ensureLoaded(options);
  const asOfDate = parseDate(asOf || new Date());
  const identity = resolveHistoricalIdentity(playerName, tour);
  const resolvedTour = normalizeTour(tour) || inferTourForName(identity.normalizedName, null);
  if (!state.loaded || !asOfDate || !identity.normalizedName || !resolvedTour) return [];
  return (identity.rows.length ? identity.rows : (state.activeByName.get(identity.normalizedName) || []))
    .filter(record => record.tour === resolvedTour)
    .map(record => ({ record, temporal: isTemporallyEligible(record, asOfDate, state.dataset) }))
    .filter(item => item.temporal.eligible)
    .map(item => item.record)
    .sort((a, b) => Number(b.season) - Number(a.season));
}

function sourceFreshness(observedAt, asOfDate) {
  const observed = parseDate(observedAt);
  if (!observed || !asOfDate) return { status: 'UNAVAILABLE', ageDays: null };
  const ageDays = Math.max(0, (asOfDate.getTime() - observed.getTime()) / 86400000);
  return { status: ageDays <= 21 ? 'CURRENT' : ageDays <= 45 ? 'AGING' : 'STALE', ageDays: round(ageDays, 1) };
}

function isTemporallyEligible(record, asOfDate, dataset) {
  const season = Number(record.season);
  const asOfYear = asOfDate.getUTCFullYear();
  if (season > asOfYear) return { eligible: false, reason: 'FUTURE_SEASON_REJECTED' };
  if (season < asOfYear) {
    const seasonEnd = Date.UTC(season + 1, 0, 1, 0, 0, 0);
    return asOfDate.getTime() >= seasonEnd
      ? { eligible: true, reason: 'COMPLETED_SEASON_SAFE' }
      : { eligible: false, reason: 'COMPLETED_SEASON_NOT_ENDED' };
  }
  const observedAt = parseDate(record.observedAt || dataset.sourceObservedAt || dataset.importedAt);
  if (!observedAt) return { eligible: false, reason: 'SOURCE_OBSERVED_AT_MISSING' };
  return asOfDate.getTime() >= observedAt.getTime()
    ? { eligible: true, reason: 'CURRENT_SEASON_AS_OF_AFTER_SOURCE_SNAPSHOT' }
    : { eligible: false, reason: 'CURRENT_SEASON_TEMPORAL_LEAKAGE_BLOCKED' };
}

function getPlayerSnapshot(playerName, tour, asOf, options = {}) {
  ensureLoaded(options);
  const asOfDate = parseDate(asOf || new Date());
  const requestedNormalized = normalizePlayerName(playerName);
  const identity = resolveHistoricalIdentity(playerName, tour);
  const normalized = identity.normalizedName || requestedNormalized;
  if (!state.loaded) return { status: 'UNAVAILABLE', reason: state.error || 'DATASET_NOT_LOADED', playerName, normalizedName: normalized, authority: 'SHADOW_ONLY' };
  if (!asOfDate) return { status: 'CONFLICT', reason: 'AS_OF_INVALID', playerName, normalizedName: normalized, authority: 'SHADOW_ONLY' };
  if (identity.status === 'CONFLICT') return { status: 'CONFLICT', reason: identity.reason, playerName, normalizedName: requestedNormalized, authority: 'SHADOW_ONLY' };
  const resolvedTour = inferTourForName(normalized, tour);
  if (!resolvedTour) return { status: 'CONFLICT', reason: 'TOUR_AMBIGUOUS_OR_NOT_FOUND', playerName, normalizedName: normalized, authority: 'SHADOW_ONLY' };
  const candidates = (identity.rows.length ? identity.rows : (state.activeByName.get(normalized) || [])).filter(item => item.tour === resolvedTour);
  const rejected = [];
  for (const record of candidates) {
    const temporal = isTemporallyEligible(record, asOfDate, state.dataset);
    if (!temporal.eligible) { rejected.push({ season: record.season, reason: temporal.reason }); continue; }
    const sample = resolvedTour === 'ATP'
      ? finite(record.metrics?.sampleMatches, 0)
      : finite(record.metrics?.wins, 0) + finite(record.metrics?.losses, 0);
    const confidence = clamp(sample / (resolvedTour === 'ATP' ? 35 : 45) * 100, 0, 100);
    const core = {
      version: TENNIS_HISTORICAL_PLAYER_STATS_VERSION,
      status: 'AVAILABLE_AUXILIARY',
      playerName: record.playerName,
      requestedPlayerName: String(playerName || ''),
      normalizedName: normalized,
      tour: resolvedTour,
      season: record.season,
      country: record.country,
      metrics: record.metrics,
      sample,
      confidenceScore: round(confidence, 2),
      sourceUrl: record.sourceUrl,
      providerIdentity: record.providerIdentity,
      sourceObservedAt: record.observedAt || state.dataset.sourceObservedAt,
      asOfAt: asOfDate.toISOString(),
      temporalStatus: temporal.reason,
      recordId: record.recordId,
      evidenceHash: record.evidenceHash,
      identityStatus: record.identityStatus,
      identityResolution: identity.status,
      requestedNormalizedName: requestedNormalized,
      sourceFreshness: sourceFreshness(record.observedAt || state.dataset.sourceObservedAt || state.dataset.importedAt, asOfDate),
      authority: 'CANONICAL_DEEPSCAN_CONTEXT_ONLY',
      modelProbabilityAuthority: false,
      qualityGateAuthority: false,
      stakeAuthority: false,
      settlementAuthority: false
    };
    return { ...core, snapshotHash: sha256(core) };
  }
  return {
    version: TENNIS_HISTORICAL_PLAYER_STATS_VERSION,
    status: candidates.length ? 'TEMPORAL_BLOCKED' : 'UNAVAILABLE',
    reason: candidates.length ? 'NO_AS_OF_SAFE_SEASON' : 'PLAYER_NOT_FOUND',
    playerName: String(playerName || ''), normalizedName: normalized, tour: resolvedTour,
    asOfAt: asOfDate.toISOString(), rejected, authority: 'CANONICAL_DEEPSCAN_CONTEXT_ONLY',
    identityResolution: identity.status, requestedNormalizedName: requestedNormalized,
    modelProbabilityAuthority: false, qualityGateAuthority: false, stakeAuthority: false, settlementAuthority: false
  };
}

function logistic(value) { return 1 / (1 + Math.exp(-value)); }
function addComponent(components, name, probabilityP1, weight, details) {
  if (!Number.isFinite(Number(probabilityP1)) || !(weight > 0)) return;
  components.push({ name, probabilityP1: clamp(Number(probabilityP1), 0.05, 0.95), weight, details });
}
function buildAtpValidation(p1, p2) {
  const a = p1.metrics || {}; const b = p2.metrics || {}; const components = [];
  const diffProb = (x, y, scale) => logistic((Number(x) - Number(y)) / scale);
  if (finite(a.totalPointsWonPct, null) !== null && finite(b.totalPointsWonPct, null) !== null) addComponent(components, 'TOTAL_POINTS_WON', diffProb(a.totalPointsWonPct, b.totalPointsWonPct, 0.018), 0.30, { p1: a.totalPointsWonPct, p2: b.totalPointsWonPct });
  if (finite(a.servicePointsWonPct, null) !== null && finite(b.servicePointsWonPct, null) !== null) addComponent(components, 'SERVICE_POINTS_WON', diffProb(a.servicePointsWonPct, b.servicePointsWonPct, 0.025), 0.18, { p1: a.servicePointsWonPct, p2: b.servicePointsWonPct });
  if (finite(a.returnPointsWonPct, null) !== null && finite(b.returnPointsWonPct, null) !== null) addComponent(components, 'RETURN_POINTS_WON', diffProb(a.returnPointsWonPct, b.returnPointsWonPct, 0.025), 0.18, { p1: a.returnPointsWonPct, p2: b.returnPointsWonPct });
  if (finite(a.firstServePointsWonPct, null) !== null && finite(b.firstServePointsWonPct, null) !== null) addComponent(components, 'FIRST_SERVE_POINTS', diffProb(a.firstServePointsWonPct, b.firstServePointsWonPct, 0.035), 0.10, { p1: a.firstServePointsWonPct, p2: b.firstServePointsWonPct });
  if (finite(a.secondServePointsWonPct, null) !== null && finite(b.secondServePointsWonPct, null) !== null) addComponent(components, 'SECOND_SERVE_POINTS', diffProb(a.secondServePointsWonPct, b.secondServePointsWonPct, 0.035), 0.10, { p1: a.secondServePointsWonPct, p2: b.secondServePointsWonPct });
  if (finite(a.breakPointsConvertedPct, null) !== null && finite(b.breakPointsConvertedPct, null) !== null) addComponent(components, 'BREAK_CONVERSION', diffProb(a.breakPointsConvertedPct, b.breakPointsConvertedPct, 0.05), 0.07, { p1: a.breakPointsConvertedPct, p2: b.breakPointsConvertedPct });
  if (finite(a.breakPointsSavedPct, null) !== null && finite(b.breakPointsSavedPct, null) !== null) addComponent(components, 'BREAK_POINTS_SAVED', diffProb(a.breakPointsSavedPct, b.breakPointsSavedPct, 0.05), 0.07, { p1: a.breakPointsSavedPct, p2: b.breakPointsSavedPct });
  return components;
}
function buildWtaValidation(p1, p2) {
  const a = p1.metrics || {}; const b = p2.metrics || {}; const components = [];
  if (finite(a.elo, null) !== null && finite(b.elo, null) !== null) addComponent(components, 'ELO', 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400)), 0.30, { p1: a.elo, p2: b.elo });
  if (finite(a.winPct, null) !== null && finite(b.winPct, null) !== null) addComponent(components, 'WIN_RATE', logistic((a.winPct - b.winPct) / 0.07), 0.20, { p1: a.winPct, p2: b.winPct });
  if (finite(a.setWinPct, null) !== null && finite(b.setWinPct, null) !== null) addComponent(components, 'SET_WIN_RATE', logistic((a.setWinPct - b.setWinPct) / 0.07), 0.16, { p1: a.setWinPct, p2: b.setWinPct });
  if (finite(a.setMargin, null) !== null && finite(b.setMargin, null) !== null) addComponent(components, 'SET_MARGIN', logistic((a.setMargin - b.setMargin) / 1.2), 0.10, { p1: a.setMargin, p2: b.setMargin });
  if (finite(a.rank, null) !== null && finite(b.rank, null) !== null && a.rank > 0 && b.rank > 0) addComponent(components, 'RANK', logistic(Math.log(b.rank / a.rank) * 1.1), 0.10, { p1: a.rank, p2: b.rank });
  if (finite(a.winsVsExpected, null) !== null && finite(b.winsVsExpected, null) !== null) addComponent(components, 'WINS_VS_EXPECTED', logistic((a.winsVsExpected - b.winsVsExpected) / 3), 0.08, { p1: a.winsVsExpected, p2: b.winsVsExpected });
  if (finite(a.strengthOfSchedulePct, null) !== null && finite(b.strengthOfSchedulePct, null) !== null) addComponent(components, 'STRENGTH_OF_SCHEDULE', logistic((a.strengthOfSchedulePct - b.strengthOfSchedulePct) / 0.08), 0.06, { p1: a.strengthOfSchedulePct, p2: b.strengthOfSchedulePct });
  return components;
}

function buildMatchValidation(player1, player2, tour, asOf, options = {}) {
  const p1 = getPlayerSnapshot(player1, tour, asOf, options);
  const p2 = getPlayerSnapshot(player2, tour, asOf, options);
  const resolvedTour = normalizeTour(tour) || (p1.tour === p2.tour ? p1.tour : null);
  const problems = [];
  if (p1.status !== 'AVAILABLE_AUXILIARY') problems.push(`P1_${p1.status}`);
  if (p2.status !== 'AVAILABLE_AUXILIARY') problems.push(`P2_${p2.status}`);
  if (!resolvedTour) problems.push('TOUR_UNRESOLVED');
  const components = problems.length ? [] : (resolvedTour === 'ATP' ? buildAtpValidation(p1, p2) : buildWtaValidation(p1, p2));
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const raw = totalWeight > 0 ? components.reduce((sum, item) => sum + item.probabilityP1 * item.weight, 0) / totalWeight : 0.5;
  const confidence = Math.min(finite(p1.confidenceScore, 0), finite(p2.confidenceScore, 0));
  const shrink = clamp(0.20 + confidence / 100 * 0.65, 0.20, 0.85);
  const probabilityP1 = clamp(0.5 + (raw - 0.5) * shrink, 0.12, 0.88);
  const label = problems.length ? 'HISTORICAL_VALIDATION_INSUFFICIENT' : probabilityP1 >= 0.56 ? 'HISTORICAL_VALIDATES_P1' : probabilityP1 <= 0.44 ? 'HISTORICAL_VALIDATES_P2' : 'HISTORICAL_BALANCED';
  const core = {
    version: TENNIS_HISTORICAL_PLAYER_STATS_VERSION,
    mode: TENNIS_HISTORICAL_PLAYER_STATS_MODE,
    status: problems.length ? 'INSUFFICIENT_EVIDENCE' : 'READY_SHADOW_VALIDATION',
    player1: String(player1 || ''), player2: String(player2 || ''), tour: resolvedTour,
    asOfAt: parseDate(asOf || new Date())?.toISOString() || null,
    seasonP1: p1.season || null, seasonP2: p2.season || null,
    validationProbabilityP1: round(probabilityP1, 6), validationProbabilityP2: round(1 - probabilityP1, 6),
    confidenceScore: round(confidence, 2), label, components, problems,
    p1RecordId: p1.recordId || null, p2RecordId: p2.recordId || null,
    p1SnapshotHash: p1.snapshotHash || null, p2SnapshotHash: p2.snapshotHash || null,
    modelProbabilityChanged: false,
    qualityGateAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false,
    historicalBackfillAuthority: false
  };
  return { ...core, validationHash: sha256(core), p1, p2 };
}

function ensureHistoricalStatsSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('PATCH16_DB_ADAPTER_REQUIRED');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_IMPORTS} (
      dataset_id TEXT PRIMARY KEY,
      dataset_hash TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      source_observed_at TEXT,
      primary_format TEXT NOT NULL,
      source_file TEXT,
      source_hash TEXT,
      raw_records INTEGER NOT NULL,
      active_records INTEGER NOT NULL,
      quarantined_records INTEGER NOT NULL,
      warning_count INTEGER NOT NULL,
      quality_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      authority_json TEXT NOT NULL,
      version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${TABLE_RECORDS} (
      record_id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      tour TEXT NOT NULL,
      season INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      country TEXT,
      source_url TEXT,
      provider_identity TEXT,
      source_section_index INTEGER,
      source_row INTEGER,
      record_status TEXT NOT NULL,
      identity_status TEXT NOT NULL,
      observed_at TEXT,
      metrics_json TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,
      version TEXT NOT NULL,
      FOREIGN KEY(dataset_id) REFERENCES ${TABLE_IMPORTS}(dataset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_historical_player_lookup ON ${TABLE_RECORDS}(tour, normalized_name, season, record_status);
    CREATE INDEX IF NOT EXISTS idx_tennis_historical_dataset ON ${TABLE_RECORDS}(dataset_id, record_status);
    CREATE TRIGGER IF NOT EXISTS trg_tennis_historical_imports_no_update BEFORE UPDATE ON ${TABLE_IMPORTS} BEGIN SELECT RAISE(ABORT,'PATCH16_IMMUTABLE_IMPORT'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_historical_imports_no_delete BEFORE DELETE ON ${TABLE_IMPORTS} BEGIN SELECT RAISE(ABORT,'PATCH16_IMMUTABLE_IMPORT'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_historical_records_no_update BEFORE UPDATE ON ${TABLE_RECORDS} BEGIN SELECT RAISE(ABORT,'PATCH16_IMMUTABLE_RECORD'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_historical_records_no_delete BEFORE DELETE ON ${TABLE_RECORDS} BEGIN SELECT RAISE(ABORT,'PATCH16_IMMUTABLE_RECORD'); END;
  `);
  return {
    version: TENNIS_HISTORICAL_PLAYER_STATS_SCHEMA_VERSION,
    tables: [TABLE_IMPORTS, TABLE_RECORDS],
    immutableTriggers: ['trg_tennis_historical_imports_no_update','trg_tennis_historical_imports_no_delete','trg_tennis_historical_records_no_update','trg_tennis_historical_records_no_delete']
  };
}

function persistDatasetToDb(db, dataset = null) {
  ensureHistoricalStatsSchema(db);
  const data = dataset || state.dataset || (() => { loadDataset(); return state.dataset; })();
  validateDataset(data);
  const existing = db.prepare(`SELECT dataset_id FROM ${TABLE_IMPORTS} WHERE dataset_id=?`).get(data.datasetId);
  if (existing) {
    const counts = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN record_status='ACTIVE' THEN 1 ELSE 0 END) active FROM ${TABLE_RECORDS} WHERE dataset_id=?`).get(data.datasetId);
    return { inserted: false, duplicate: true, datasetId: data.datasetId, records: Number(counts.total || 0), activeRecords: Number(counts.active || 0) };
  }
  const primary = (data.source?.sourceFiles || []).find(item => item.role === 'PRIMARY_XLSX') || {};
  db.prepare(`INSERT INTO ${TABLE_IMPORTS} (dataset_id,dataset_hash,imported_at,source_observed_at,primary_format,source_file,source_hash,raw_records,active_records,quarantined_records,warning_count,quality_json,source_json,authority_json,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    data.datasetId, data.datasetHash, data.importedAt, data.sourceObservedAt, data.source?.primaryFormat || 'XLSX', primary.file || null, primary.sha256 || null,
    Number(data.quality?.rawRecords || data.records.length), Number(data.quality?.activeRecords || 0), Number(data.quality?.quarantinedRecords || 0), Number(data.quality?.warningCount || 0),
    JSON.stringify(data.quality || {}), JSON.stringify(data.source || {}), JSON.stringify(data.authority || {}), TENNIS_HISTORICAL_PLAYER_STATS_VERSION
  );
  const insert = db.prepare(`INSERT INTO ${TABLE_RECORDS} (record_id,dataset_id,tour,season,player_name,normalized_name,country,source_url,provider_identity,source_section_index,source_row,record_status,identity_status,observed_at,metrics_json,evidence_hash,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let inserted = 0;
  for (const record of data.records) {
    insert.run(record.recordId, data.datasetId, record.tour, Number(record.season), record.playerName, record.normalizedName, record.country || null, record.sourceUrl || null, record.providerIdentity || null, Number(record.sourceSectionIndex || 0), Number(record.sourceRow || 0), record.recordStatus, record.identityStatus, record.observedAt || data.sourceObservedAt || null, JSON.stringify(record.metrics || {}), record.evidenceHash, TENNIS_HISTORICAL_PLAYER_STATS_VERSION);
    inserted += 1;
  }
  return { inserted: true, duplicate: false, datasetId: data.datasetId, records: inserted, activeRecords: Number(data.quality?.activeRecords || 0) };
}

function getDatabaseHealth(db) {
  const tablesPresent = tableExists(db, TABLE_IMPORTS) && tableExists(db, TABLE_RECORDS);
  if (!tablesPresent) return { success: false, status: 'SCHEMA_MISSING', tablesPresent, version: TENNIS_HISTORICAL_PLAYER_STATS_VERSION };
  const counts = db.prepare(`SELECT COUNT(*) datasets, COALESCE(SUM(active_records),0) activeRecords, COALESCE(SUM(quarantined_records),0) quarantinedRecords FROM ${TABLE_IMPORTS}`).get();
  const recordCounts = db.prepare(`SELECT COUNT(*) records, SUM(CASE WHEN record_status='ACTIVE' THEN 1 ELSE 0 END) activeRecords FROM ${TABLE_RECORDS}`).get();
  const triggers = ['trg_tennis_historical_imports_no_update','trg_tennis_historical_imports_no_delete','trg_tennis_historical_records_no_update','trg_tennis_historical_records_no_delete'];
  const immutable = triggers.every(name => triggerExists(db, name));
  const orphan = Number(db.prepare(`SELECT COUNT(*) n FROM ${TABLE_RECORDS} r LEFT JOIN ${TABLE_IMPORTS} i ON i.dataset_id=r.dataset_id WHERE i.dataset_id IS NULL`).get().n || 0);
  return {
    success: immutable && orphan === 0,
    status: Number(counts.datasets || 0) ? (immutable && orphan === 0 ? 'READY_WITH_IMPORTED_DATA' : 'INTEGRITY_ERROR') : 'SCHEMA_READY_NO_DATA',
    version: TENNIS_HISTORICAL_PLAYER_STATS_VERSION,
    tablesPresent,
    immutableTriggers: immutable,
    orphanRecords: orphan,
    datasets: Number(counts.datasets || 0),
    records: Number(recordCounts.records || 0),
    activeRecords: Number(recordCounts.activeRecords || 0),
    quarantinedRecords: Number(counts.quarantinedRecords || 0),
    modelProbabilityAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false
  };
}

module.exports = {
  TENNIS_HISTORICAL_PLAYER_STATS_VERSION,
  TENNIS_HISTORICAL_PLAYER_STATS_SCHEMA_VERSION,
  TENNIS_HISTORICAL_PLAYER_STATS_MODE,
  TABLE_IMPORTS,
  TABLE_RECORDS,
  DEFAULT_DATASET_PATH,
  loadDataset,
  getStatus,
  getPlayerSnapshot,
  getPlayerHistory,
  resolveHistoricalIdentity,
  buildMatchValidation,
  ensureHistoricalStatsSchema,
  persistDatasetToDb,
  getDatabaseHealth,
  normalizeTour,
  reset
};
