'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const playerDataRefresh = require('./tennisPlayerDataRefresh');
const historicalPlayerStats = require('./tennisHistoricalPlayerStats');
const tourDataReadiness = require('./tennisTourDataReadiness');

const TENNIS_INFORMATION_RETRIEVAL_VERSION = 'TENNIS_INFORMATION_RETRIEVAL_V3_PATCH23';
const TENNIS_INFORMATION_RETRIEVAL_POLICY_VERSION = 'TENNIS_INFORMATION_RETRIEVAL_POLICY_V1_PATCH23';
const TENNIS_INFORMATION_RETRIEVAL_COMPATIBILITY_VERSION = 'TENNIS_INFORMATION_RETRIEVAL_COMPATIBILITY_R1_SCHEMA_ADAPTIVE';
const TENNIS_INFORMATION_RETRIEVAL_SCHEMA_VERSION = 'TENNIS_INFORMATION_RETRIEVAL_SCHEMA_V1_PATCH15';
const TENNIS_INFORMATION_RETRIEVAL_MODE = 'CERTIFICATION_READ_ONLY_NO_MODEL_STAKE_AUTHORITY';
const TABLE_RUNS = 'tennis_information_retrieval_runs';
const TABLE_CHECKS = 'tennis_information_source_checks';
const TABLE_RECEIPTS = 'tennis_prediction_evidence_receipts';
const CHANNELS = Object.freeze({
  DEEPSCAN: 'DEEPSCAN',
  AI_ANALYSIS: 'AI_ANALYSIS',
  PAPER_TRADING: 'PAPER_TRADING'
});
const STATUSES = Object.freeze({ PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL', NOT_CONFIGURED: 'NOT_CONFIGURED', OPTIONAL_NOT_CONFIGURED: 'OPTIONAL_NOT_CONFIGURED', NOT_TESTED: 'NOT_TESTED' });
const RECEIPT_PHASES = Object.freeze({ PREDICTION_CAPTURE: 'PREDICTION_CAPTURE', DEEPSCAN_COMPLETE: 'DEEPSCAN_COMPLETE' });
const SOURCE_TIERS = Object.freeze({
  LOCAL_STRUCTURED: 'LOCAL_STRUCTURED',
  PROVIDER_STRUCTURED: 'PROVIDER_STRUCTURED',
  CONTEXT_NEWS: 'CONTEXT_NEWS',
  COMMUNITY_STRUCTURED: 'COMMUNITY_STRUCTURED',
  WEAK_WEB_FALLBACK: 'WEAK_WEB_FALLBACK',
  INTERNAL_CONTRACT: 'INTERNAL_CONTRACT'
});
const SOURCE_REGISTRY = Object.freeze({
  DEEPSCAN_LOCAL_NEWS_CACHE: Object.freeze({ channel: CHANNELS.DEEPSCAN, tier: SOURCE_TIERS.CONTEXT_NEWS, authority: 'CONTEXT_ONLY' }),
  DEEPSCAN_GOOGLE_NEWS_RSS: Object.freeze({ channel: CHANNELS.DEEPSCAN, tier: SOURCE_TIERS.CONTEXT_NEWS, authority: 'CONTEXT_ONLY' }),
  DEEPSCAN_BING_NEWS_RSS: Object.freeze({ channel: CHANNELS.DEEPSCAN, tier: SOURCE_TIERS.CONTEXT_NEWS, authority: 'CONTEXT_ONLY' }),
  DEEPSCAN_DUCKDUCKGO_H2H: Object.freeze({ channel: CHANNELS.DEEPSCAN, tier: SOURCE_TIERS.WEAK_WEB_FALLBACK, authority: 'CONTEXT_ONLY' }),
  AI_PLAYER_DATA_LOCAL: Object.freeze({ channel: CHANNELS.AI_ANALYSIS, tier: SOURCE_TIERS.LOCAL_STRUCTURED, authority: 'QUANTITATIVE_INPUT' }),
  AI_TENNISDB_HISTORICAL_PLAYER_STATS: Object.freeze({ channel: CHANNELS.AI_ANALYSIS, tier: SOURCE_TIERS.LOCAL_STRUCTURED, authority: 'AUXILIARY_VALIDATION_SHADOW' }),
  AI_REFERENCE_MARKET_TWO_WAY: Object.freeze({ channel: CHANNELS.AI_ANALYSIS, tier: SOURCE_TIERS.PROVIDER_STRUCTURED, authority: 'MARKET_REFERENCE' }),
  AI_CANONICAL_EVENT_IDENTITY: Object.freeze({ channel: CHANNELS.AI_ANALYSIS, tier: SOURCE_TIERS.INTERNAL_CONTRACT, authority: 'IDENTITY_GUARD' }),
  AI_TOURNAMENT_SURFACE: Object.freeze({ channel: CHANNELS.AI_ANALYSIS, tier: SOURCE_TIERS.INTERNAL_CONTRACT, authority: 'FEATURE_CONTEXT' }),
  PAPER_SETTLEMENT_CONTRACT: Object.freeze({ channel: CHANNELS.PAPER_TRADING, tier: SOURCE_TIERS.INTERNAL_CONTRACT, authority: 'AUTO_SETTLEMENT_GUARD' }),
  PAPER_ODDS_API_SCORES: Object.freeze({ channel: CHANNELS.PAPER_TRADING, tier: SOURCE_TIERS.PROVIDER_STRUCTURED, authority: 'STRUCTURED_RESULT' }),
  PAPER_TENNISMYLIFE_RESULTS: Object.freeze({ channel: CHANNELS.PAPER_TRADING, tier: SOURCE_TIERS.COMMUNITY_STRUCTURED, authority: 'PROPOSE_OR_VERIFY_BY_CONTRACT' }),
  PAPER_SETTLEMENT_SOURCE_HISTORY: Object.freeze({ channel: CHANNELS.PAPER_TRADING, tier: SOURCE_TIERS.INTERNAL_CONTRACT, authority: 'AUDIT_ONLY' }),
  PAPER_DUCKDUCKGO_SCORE_FALLBACK: Object.freeze({ channel: CHANNELS.PAPER_TRADING, tier: SOURCE_TIERS.WEAK_WEB_FALLBACK, authority: 'PROPOSE_ONLY' })
});

function sha256Text(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256Json(value) { return sha256Text(stableJson(value)); }
function clamp(value, min = 0, max = 100) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }
function round(value, decimals = 2) { const p = 10 ** decimals; return Math.round((Number(value) + Number.EPSILON) * p) / p; }
function iso(value = new Date()) { const d = value instanceof Date ? value : new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString(); }
function safeJsonParse(value, fallback = null) { try { return JSON.parse(value); } catch (_) { return fallback; } }
function normalizeText(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function cacheKey(playerName) { return String(playerName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_'); }
function safeTableName(name) { if (!/^[a-z0-9_]+$/i.test(String(name || ''))) throw new Error('INVALID_TABLE_NAME'); return name; }
function tableExists(db, table) { return Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table).n || 0) === 1; }
function triggerExists(db, trigger) { return Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger).n || 0) === 1; }
function getColumns(db, table) { return new Set(db.prepare(`PRAGMA table_info(${safeTableName(table)})`).all().map(row => row.name)); }
function tennisWhere(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `(UPPER(COALESCE(${p}sport_type,''))='TENNIS' OR UPPER(COALESCE(${p}bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(${p}strategy_tag,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(${p}league,'')) LIKE '%ATP%' OR UPPER(COALESCE(${p}league,'')) LIKE '%WTA%')`;
}
function tennisWhereForColumns(columns, alias = '') {
  const cols = columns instanceof Set ? columns : new Set(columns || []);
  const p = alias ? `${alias}.` : '';
  const clauses = [];
  if (cols.has('sport_type')) clauses.push(`UPPER(COALESCE(${p}sport_type,''))='TENNIS'`);
  if (cols.has('bet_type')) clauses.push(`UPPER(COALESCE(${p}bet_type,'')) LIKE '%TENNIS%'`);
  if (cols.has('strategy_tag')) clauses.push(`UPPER(COALESCE(${p}strategy_tag,'')) LIKE '%TENNIS%'`);
  if (cols.has('league')) {
    clauses.push(`UPPER(COALESCE(${p}league,'')) LIKE '%ATP%'`);
    clauses.push(`UPPER(COALESCE(${p}league,'')) LIKE '%WTA%'`);
  }
  return clauses.length ? `(${clauses.join(' OR ')})` : null;
}
function resolvePlayerNamePair(columns) {
  const cols = columns instanceof Set ? columns : new Set(columns || []);
  return [
    ['home_team', 'away_team'],
    ['tennis_player1_identity', 'tennis_player2_identity'],
    ['provider_home_team', 'provider_away_team'],
    ['predicted_player_name', 'opponent_player_name']
  ].find(([left, right]) => cols.has(left) && cols.has(right)) || null;
}
function statusFromScore(score, options = {}) {
  if (options.fail === true) return STATUSES.FAIL;
  if (options.notConfigured === true) return STATUSES.NOT_CONFIGURED;
  const n = Number(score);
  if (n >= 80) return STATUSES.PASS;
  if (n >= 50) return STATUSES.WARN;
  return STATUSES.FAIL;
}
function combineStatus(items = []) {
  const statuses = items
    .filter(item => item && item.scoreExcluded !== true && item.status !== STATUSES.OPTIONAL_NOT_CONFIGURED)
    .map(item => item.status)
    .filter(Boolean);
  if (statuses.includes(STATUSES.FAIL)) return STATUSES.FAIL;
  if (statuses.includes(STATUSES.WARN) || statuses.includes(STATUSES.NOT_CONFIGURED) || statuses.includes(STATUSES.NOT_TESTED)) return STATUSES.WARN;
  return STATUSES.PASS;
}
function weightedScore(items = []) {
  let sum = 0; let weight = 0;
  for (const item of items) {
    const w = Math.max(0, Number(item.weight ?? 1));
    sum += clamp(item.score) * w; weight += w;
  }
  return weight > 0 ? round(sum / weight, 2) : 0;
}
function weightedCheckScore(items = []) {
  return weightedScore(items
    .filter(item => item && item.scoreExcluded !== true)
    .map(item => ({ score: item.score, weight: item.healthWeight ?? 1 })));
}
function sourceCheck(sourceId, status, score, details = {}, extra = {}) {
  const registry = SOURCE_REGISTRY[sourceId] || {};
  const observedAt = extra.observedAt || new Date().toISOString();
  const safeDetails = details && typeof details === 'object' ? details : { message: String(details || '') };
  const evidence = {
    sourceId,
    channel: registry.channel || extra.channel || null,
    sourceTier: registry.tier || extra.sourceTier || null,
    authority: registry.authority || null,
    status,
    score: round(clamp(score), 2),
    observedAt,
    optional: extra.optional === true,
    scoreExcluded: extra.scoreExcluded === true,
    healthWeight: Math.max(0, Number(extra.healthWeight ?? 1)),
    details: safeDetails
  };
  return { ...evidence, latencyMs: Number.isFinite(Number(extra.latencyMs)) ? Number(extra.latencyMs) : null, evidenceHash: sha256Json(evidence) };
}

function ensureInformationRetrievalSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('DB_ADAPTER_REQUIRED');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE_RUNS} (
      run_id TEXT PRIMARY KEY,
      run_mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      overall_status TEXT NOT NULL,
      overall_score REAL NOT NULL,
      deep_scan_status TEXT NOT NULL,
      deep_scan_score REAL NOT NULL,
      ai_analysis_status TEXT NOT NULL,
      ai_analysis_score REAL NOT NULL,
      paper_trading_status TEXT NOT NULL,
      paper_trading_score REAL NOT NULL,
      network_used INTEGER NOT NULL DEFAULT 0,
      source_count INTEGER NOT NULL DEFAULT 0,
      pass_count INTEGER NOT NULL DEFAULT 0,
      warn_count INTEGER NOT NULL DEFAULT 0,
      fail_count INTEGER NOT NULL DEFAULT 0,
      probe_players_json TEXT,
      report_json TEXT NOT NULL,
      report_hash TEXT NOT NULL,
      version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${TABLE_CHECKS} (
      check_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_tier TEXT,
      authority TEXT,
      status TEXT NOT NULL,
      score REAL NOT NULL,
      latency_ms REAL,
      observed_at TEXT NOT NULL,
      details_json TEXT,
      evidence_hash TEXT NOT NULL,
      version TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES ${TABLE_RUNS}(run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_info_checks_run ON ${TABLE_CHECKS}(run_id, channel);
    CREATE TABLE IF NOT EXISTS ${TABLE_RECEIPTS} (
      receipt_id TEXT PRIMARY KEY,
      bet_id INTEGER NOT NULL,
      prediction_snapshot_id TEXT,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      overall_score REAL NOT NULL,
      deep_scan_score REAL NOT NULL,
      ai_analysis_score REAL NOT NULL,
      paper_trading_score REAL NOT NULL,
      source_boundary_id INTEGER,
      source_summary_json TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      version TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_prediction_receipts_bet ON ${TABLE_RECEIPTS}(bet_id, phase, created_at);
    CREATE TRIGGER IF NOT EXISTS trg_tennis_info_runs_no_update BEFORE UPDATE ON ${TABLE_RUNS} BEGIN SELECT RAISE(ABORT,'PATCH15_RETRIEVAL_RUN_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_info_runs_no_delete BEFORE DELETE ON ${TABLE_RUNS} BEGIN SELECT RAISE(ABORT,'PATCH15_RETRIEVAL_RUN_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_info_checks_no_update BEFORE UPDATE ON ${TABLE_CHECKS} BEGIN SELECT RAISE(ABORT,'PATCH15_RETRIEVAL_CHECK_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_info_checks_no_delete BEFORE DELETE ON ${TABLE_CHECKS} BEGIN SELECT RAISE(ABORT,'PATCH15_RETRIEVAL_CHECK_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_prediction_receipts_no_update BEFORE UPDATE ON ${TABLE_RECEIPTS} BEGIN SELECT RAISE(ABORT,'PATCH15_PREDICTION_RECEIPT_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_prediction_receipts_no_delete BEFORE DELETE ON ${TABLE_RECEIPTS} BEGIN SELECT RAISE(ABORT,'PATCH15_PREDICTION_RECEIPT_IMMUTABLE'); END;
  `);
  return { version: TENNIS_INFORMATION_RETRIEVAL_SCHEMA_VERSION, tables: [TABLE_RUNS, TABLE_CHECKS, TABLE_RECEIPTS], immutable: true };
}

function selectProbePlayers(db, limit = 2) {
  if (!db || !tableExists(db, 'ai_forward_test')) return [];
  const max = Math.max(1, Math.min(4, Number(limit) || 2));
  const cols = getColumns(db, 'ai_forward_test');
  const pair = resolvePlayerNamePair(cols);
  const where = tennisWhereForColumns(cols);
  if (!pair || !where) return [];
  const [left, right] = pair;
  const order = [];
  if (cols.has('status')) order.push(`CASE WHEN UPPER(COALESCE(status,''))='PENDING' THEN 0 ELSE 1 END`);
  if (cols.has('id')) order.push('id DESC');
  const orderSql = order.length ? `ORDER BY ${order.join(', ')}` : '';
  try {
    const rows = db.prepare(`
      SELECT ${left} AS player1, ${right} AS player2
      FROM ai_forward_test
      WHERE ${where}
        AND COALESCE(${left},'') <> '' AND COALESCE(${right},'') <> ''
      ${orderSql}
      LIMIT ?
    `).all(max);
    const result = [];
    for (const row of rows) {
      for (const name of [row.player1, row.player2]) if (name && !result.some(item => normalizeText(item) === normalizeText(name))) result.push(name);
    }
    return result.slice(0, max);
  } catch (_) {
    return [];
  }
}

function uniquePlayers(players = []) {
  const result = [];
  for (const player of players) {
    const clean = String(player || '').trim();
    if (clean && !result.some(item => normalizeText(item) === normalizeText(clean))) result.push(clean);
  }
  return result;
}
function resolvePlayerTargetFromDb(db, player) {
  if (!db || !player || !tableExists(db, 'ai_forward_test')) return null;
  const cols = getColumns(db, 'ai_forward_test');
  const pair = resolvePlayerNamePair(cols);
  if (!pair) return null;
  const [left, right] = pair;
  const selectFields = ['league','strategy_tag','bet_type','sport_type','tour_type','tournament_category','tournament_level'].filter(field => cols.has(field));
  if (!selectFields.length) return null;
  const order = [];
  if (cols.has('status')) order.push(`CASE WHEN UPPER(COALESCE(status,''))='PENDING' THEN 0 ELSE 1 END`);
  if (cols.has('id')) order.push('id DESC');
  const orderSql = order.length ? `ORDER BY ${order.join(', ')}` : '';
  try {
    const rows = db.prepare(`SELECT ${selectFields.join(',')} FROM ai_forward_test
      WHERE LOWER(COALESCE(${left},''))=LOWER(?) OR LOWER(COALESCE(${right},''))=LOWER(?)
      ${orderSql} LIMIT 12`).all(player, player);
    for (const row of rows) {
      const targetId = tourDataReadiness.resolveTargetId(row);
      if (targetId) return targetId;
    }
  } catch (_) {}
  return null;
}
function resolveProbeScope(db, players = [], options = {}) {
  const probePlayers = uniquePlayers(players);
  let report = options.tourDataReadinessReport || null;
  if (!report) {
    try { report = tourDataReadiness.buildTargetReadiness({ dataDir: options.dataDir || path.join(__dirname, 'sackmann_data'), now: options.now, projectRoot: options.projectRoot, multiProviderHealth: options.multiProviderHealth }); }
    catch (error) { report = { success: false, status: 'ERROR', targets: [], tours: [], error: error.message, sourceFreshnessNotMasked: false }; }
  }
  const explicitTarget = tourDataReadiness.resolveTargetId(options);
  const playerTargets = probePlayers.map(player => ({ player, targetId: explicitTarget || resolvePlayerTargetFromDb(db, player) }));
  let targetIds = [...new Set(playerTargets.map(item => item.targetId).filter(Boolean))];
  let resolutionFallback = null;
  if (!targetIds.length && explicitTarget) targetIds = [explicitTarget];
  if (!targetIds.length && Array.isArray(report.targets) && report.targets.length) {
    const worst = [...report.targets].sort((a, b) => ({ CURRENT: 0, AGING: 1, STALE: 2, UNAVAILABLE: 3, ERROR: 4 }[b.status] ?? 99) - ({ CURRENT: 0, AGING: 1, STALE: 2, UNAVAILABLE: 3, ERROR: 4 }[a.status] ?? 99))[0];
    if (worst?.targetId) targetIds = [worst.targetId];
    resolutionFallback = 'WORST_AVAILABLE_TARGET_FAIL_CLOSED';
  }
  const selectedTargets = targetIds.map(targetId => (report.targets || []).find(item => item.targetId === targetId)).filter(Boolean);
  const status = selectedTargets.length ? tourDataReadiness.worstStatus(selectedTargets.map(item => item.status)) : 'UNAVAILABLE';
  const dataAgeDays = selectedTargets.map(item => Number(item.dataAgeDays)).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? null;
  const latestTimes = selectedTargets.map(item => item.latestMatchAt ? new Date(item.latestMatchAt).getTime() : NaN).filter(Number.isFinite);
  const latestMatchAt = latestTimes.length ? new Date(Math.min(...latestTimes)).toISOString() : null;
  const tours = [...new Set(selectedTargets.map(item => item.tour).filter(Boolean))];
  return {
    version: TENNIS_INFORMATION_RETRIEVAL_POLICY_VERSION,
    readinessVersion: report.version || tourDataReadiness.TENNIS_TOUR_DATA_READINESS_VERSION,
    probePlayers,
    playerTargets,
    targetIds,
    tours,
    targetScope: targetIds.length === 1 ? targetIds[0] : targetIds.length > 1 ? 'MIXED_TARGETS' : 'UNRESOLVED',
    tourScope: tours.length === 1 ? tours[0] : tours.length > 1 ? 'MIXED_TOURS' : null,
    status,
    dataAgeDays,
    latestMatchAt,
    selectedTargets,
    unresolvedPlayers: playerTargets.filter(item => !item.targetId).map(item => item.player),
    resolutionFallback,
    sourceFreshnessNotMasked: report.sourceFreshnessNotMasked === true,
    aggregateStatusIgnored: true,
    reportStatus: report.status || null
  };
}

function inspectNewsCacheFile(filePath, playerName, now = new Date()) {
  if (!fs.existsSync(filePath)) return { exists: false, articles: 0, relevant: 0, fresh: false, ageHours: null, parseErrors: 0, duplicateTitles: 0, futureDates: 0 };
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const articles = Array.isArray(payload.articles) ? payload.articles : [];
    const timestamp = Number(payload.timestamp);
    const ageHours = Number.isFinite(timestamp) ? Math.max(0, (now.getTime() - timestamp) / 3600000) : null;
    const playerNorm = normalizeText(playerName);
    const surname = playerNorm.split(' ').pop();
    const titles = new Set(); let duplicates = 0; let relevant = 0; let parseErrors = 0; let futureDates = 0;
    for (const article of articles) {
      const title = normalizeText(article?.title || '');
      const text = normalizeText(`${article?.title || ''} ${article?.fullText || ''}`);
      if (title && titles.has(title)) duplicates += 1; else if (title) titles.add(title);
      if ((playerNorm && text.includes(playerNorm)) || (surname && text.includes(surname))) relevant += 1;
      if (article?.pubDate) {
        const date = new Date(article.pubDate);
        if (!Number.isFinite(date.getTime())) parseErrors += 1;
        else if (date.getTime() > now.getTime() + 24 * 3600000) futureDates += 1;
      }
    }
    return { exists: true, articles: articles.length, relevant, relevancePct: articles.length ? round(relevant / articles.length * 100, 2) : 0, fresh: ageHours != null && ageHours <= 3, recent24h: ageHours != null && ageHours <= 24, ageHours: ageHours == null ? null : round(ageHours, 2), parseErrors, duplicateTitles: duplicates, futureDates };
  } catch (error) { return { exists: true, articles: 0, relevant: 0, fresh: false, ageHours: null, parseErrors: 1, duplicateTitles: 0, futureDates: 0, error: error.message }; }
}

function auditDeepScanLocal(db, options = {}) {
  const cacheDir = path.resolve(options.cacheDir || path.join(__dirname, 'cache_news'));
  const now = options.now ? new Date(options.now) : new Date();
  const explicitProbePlayers = uniquePlayers(Array.isArray(options.players) ? options.players : []);
  const probePlayers = explicitProbePlayers.length ? explicitProbePlayers.slice(0, 2) : selectProbePlayers(db, 2);
  const canaryPlayers = uniquePlayers(Array.isArray(options.canaryPlayers) ? options.canaryPlayers : (explicitProbePlayers.length ? [] : selectProbePlayers(db, 4).slice(probePlayers.length)));
  const files = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(name => name.endsWith('.json')) : [];
  let validFiles = 0; let filesWithArticles = 0; let freshFiles = 0; let articleCount = 0; let parseErrors = 0; let futureDates = 0;
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
      validFiles += 1;
      const articles = Array.isArray(data.articles) ? data.articles : [];
      if (articles.length) filesWithArticles += 1;
      articleCount += articles.length;
      const ts = Number(data.timestamp);
      if (Number.isFinite(ts) && now.getTime() - ts <= 3 * 3600000) freshFiles += 1;
      for (const article of articles) if (article?.pubDate) {
        const d = new Date(article.pubDate); if (!Number.isFinite(d.getTime())) parseErrors += 1; else if (d.getTime() > now.getTime() + 24 * 3600000) futureDates += 1;
      }
    } catch (_) { parseErrors += 1; }
  }
  const selected = probePlayers.map(player => ({ player, ...inspectNewsCacheFile(path.join(cacheDir, `${cacheKey(player)}.json`), player, now) }));
  const canaries = canaryPlayers.map(player => ({ player, ...inspectNewsCacheFile(path.join(cacheDir, `${cacheKey(player)}.json`), player, now) }));
  const selectedCoverage = selected.length ? selected.filter(item => item.exists && item.articles > 0).length / selected.length : 0;
  const globalValidPct = files.length ? validFiles / files.length : 0;
  const articleFilePct = validFiles ? filesWithArticles / validFiles : 0;
  const freshnessPct = validFiles ? freshFiles / validFiles : 0;
  const score = round(25 * globalValidPct + 25 * articleFilePct + 25 * selectedCoverage + 25 * Math.min(1, freshnessPct * 4), 2);
  const status = files.length === 0 || validFiles === 0 ? STATUSES.FAIL : score >= 80 ? STATUSES.PASS : STATUSES.WARN;
  const check = sourceCheck('DEEPSCAN_LOCAL_NEWS_CACHE', status, score, { cacheDir, files: files.length, validFiles, filesWithArticles, freshFiles, articleCount, parseErrors, futureDates, probePlayers: selected, canaryPlayers: canaries, ttlHours: 3, scoreUsesProbePlayersOnly: true });
  return { channel: CHANNELS.DEEPSCAN, status, score, checks: [check], players: probePlayers, probePlayers, canaryPlayers, note: status === STATUSES.PASS ? 'Cache contestuale DeepScan disponibile e corrente per i giocatori del probe.' : 'Cache DeepScan disponibile ma parziale o non fresca; i giocatori canary sono separati dal punteggio del probe.' };
}

function countCoverage(db, expression, where = tennisWhere()) {
  const row = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN ${expression} THEN 1 ELSE 0 END) covered FROM ai_forward_test WHERE ${where}`).get() || {};
  const total = Number(row.total || 0); const covered = Number(row.covered || 0);
  return { total, covered, pct: total ? round(covered / total * 100, 2) : 0 };
}

function auditAiAnalysisLocal(db, options = {}) {
  const checks = [];
  const probePlayers = uniquePlayers(Array.isArray(options.players) && options.players.length ? options.players : selectProbePlayers(db, 2));
  const probeScope = resolveProbeScope(db, probePlayers, options);
  const freshnessStatus = probeScope.status;
  const freshnessScore = freshnessStatus === 'CURRENT' ? 100 : freshnessStatus === 'AGING' ? 72 : freshnessStatus === 'STALE' ? 35 : 0;
  const playerDataStatus = freshnessStatus === 'CURRENT' ? STATUSES.PASS : ['AGING','STALE'].includes(freshnessStatus) ? STATUSES.WARN : STATUSES.FAIL;
  let aggregateHealth = options.playerDataHealth || null;
  if (!aggregateHealth) {
    try { aggregateHealth = playerDataRefresh.getPlayerDataHealth({ dataDir: options.dataDir || path.join(__dirname, 'sackmann_data'), initialize: true }); }
    catch (error) { aggregateHealth = { status: 'ERROR', healthy: false, error: error.message }; }
  }
  checks.push(sourceCheck('AI_PLAYER_DATA_LOCAL', playerDataStatus, freshnessScore, {
    status: freshnessStatus,
    tour: probeScope.tourScope,
    targetId: probeScope.targetScope,
    targetIds: probeScope.targetIds,
    playerTargets: probeScope.playerTargets,
    sourceProviderIds: probeScope.selectedTargets.map(item => item.providerId).filter(Boolean),
    latestMatchAt: probeScope.latestMatchAt,
    dataAgeDays: probeScope.dataAgeDays,
    selectedTargets: probeScope.selectedTargets,
    unresolvedPlayers: probeScope.unresolvedPlayers,
    resolutionFallback: probeScope.resolutionFallback,
    readinessVersion: probeScope.readinessVersion,
    sourceFreshnessNotMasked: probeScope.sourceFreshnessNotMasked,
    aggregateStatusIgnored: true,
    aggregateCompatibility: { status: aggregateHealth.status || null, latestMatchAt: aggregateHealth.latestMatchAt || null, dataAgeDays: aggregateHealth.dataAgeDays ?? null },
    matchCount: aggregateHealth.engine?.matchCount ?? null,
    playerCount: aggregateHealth.engine?.playerCount ?? null,
    temporalLeakageGuard: aggregateHealth.engine?.temporalLeakageGuard === true,
    failClosed: ['STALE','UNAVAILABLE','ERROR'].includes(freshnessStatus)
  }));
  const historicalHealth = options.historicalPlayerStatsHealth || historicalPlayerStats.getStatus({ datasetPath: options.historicalDatasetPath, initialize: true });
  const historicalScore = historicalHealth.loaded ? (historicalHealth.warningCount > 0 ? 78 : 95) : 0;
  const historicalStatus = historicalHealth.loaded ? (historicalHealth.warningCount > 0 ? STATUSES.WARN : STATUSES.PASS) : STATUSES.FAIL;
  checks.push(sourceCheck('AI_TENNISDB_HISTORICAL_PLAYER_STATS', historicalStatus, historicalScore, {
    status: historicalHealth.status, datasetId: historicalHealth.datasetId, activeRecords: historicalHealth.activeRecords,
    quarantinedRecords: historicalHealth.quarantinedRecords, seasons: historicalHealth.seasons,
    linkCoveragePct: historicalHealth.linkCoveragePct, formatParity: historicalHealth.formatParity,
    warningCodes: historicalHealth.warningCodes, temporalLeakageGuard: historicalHealth.temporalLeakageGuard === true,
    modelProbabilityAuthority: false, qualityGateAuthority: false, stakeAuthority: false, settlementAuthority: false
  }));
  if (!db || !tableExists(db, 'ai_forward_test')) {
    checks.push(sourceCheck('AI_REFERENCE_MARKET_TWO_WAY', STATUSES.FAIL, 0, { error: 'AI_FORWARD_TEST_MISSING' }));
    return { channel: CHANNELS.AI_ANALYSIS, status: STATUSES.FAIL, score: 0, checks, probeScope, note: 'Dataset Analisi AI non disponibile.' };
  }
  const cols = getColumns(db, 'ai_forward_test');
  const twoWay = cols.has('reference_odd1') && cols.has('reference_odd2') ? countCoverage(db, 'COALESCE(reference_odd1,0)>1 AND COALESCE(reference_odd2,0)>1') : { total: 0, covered: 0, pct: 0 };
  const twoWayScore = Math.min(100, twoWay.pct * 1.25);
  checks.push(sourceCheck('AI_REFERENCE_MARKET_TWO_WAY', statusFromScore(twoWayScore), twoWayScore, twoWay));
  const identityExpr = cols.has('tennis_canonical_match_key') ? "COALESCE(tennis_canonical_match_key,'')<>''" : '0=1';
  const identity = countCoverage(db, identityExpr);
  checks.push(sourceCheck('AI_CANONICAL_EVENT_IDENTITY', statusFromScore(identity.pct), identity.pct, identity));
  const surfaceExpr = cols.has('surface') ? "COALESCE(surface,'')<>''" : '0=1';
  const surface = countCoverage(db, surfaceExpr);
  checks.push(sourceCheck('AI_TOURNAMENT_SURFACE', statusFromScore(surface.pct), surface.pct, surface));
  const score = weightedScore([
    { score: freshnessScore, weight: 0.30 },
    { score: historicalScore, weight: 0.15 },
    { score: twoWayScore, weight: 0.25 },
    { score: identity.pct, weight: 0.17 },
    { score: surface.pct, weight: 0.13 }
  ]);
  return { channel: CHANNELS.AI_ANALYSIS, status: combineStatus(checks), score, checks, playerDataHealth: aggregateHealth, probeScope, historicalPlayerStatsHealth: historicalHealth, note: freshnessStatus === 'STALE' ? `Dati ${probeScope.tourScope || probeScope.targetScope || 'Tennis'} obsoleti: il target del probe resta fail-closed e non può essere promosso dalla data aggregata ATP/WTA.` : historicalHealth.warningCount > 0 ? 'Input AI verificati per circuito; il dataset storico TennisDB resta shadow con righe ambigue in quarantena.' : 'Copertura degli input Analisi AI verificata per target e circuito.' };
}

function auditPaperTradingLocal(db, options = {}) {
  const checks = [];
  const contractPresent = fs.existsSync(path.join(__dirname, 'tennisSettlementContract.js'));
  checks.push(sourceCheck('PAPER_SETTLEMENT_CONTRACT', contractPresent ? STATUSES.PASS : STATUSES.FAIL, contractPresent ? 100 : 0, { modulePresent: contractPresent, weakSourcesAutoSettle: false }, { healthWeight: 0.55 }));
  const oddsConfigured = Boolean(options.oddsApiConfigured ?? [process.env.ODDS_API_KEY, process.env.THE_ODDS_API_KEY, process.env.ODDS_API_KEYS].some(value => value && String(value).trim()));
  checks.push(sourceCheck('PAPER_ODDS_API_SCORES', oddsConfigured ? STATUSES.PASS : STATUSES.OPTIONAL_NOT_CONFIGURED, oddsConfigured ? 85 : 0, { configured: oddsConfigured, optional: true, zeroKeyPolicy: 'OPTIONAL_PAID_FALLBACK_AFTER_ZERO_KEY_SOURCES', secretExposed: false, liveCallExecuted: false, scoreExcluded: !oddsConfigured }, { optional: true, scoreExcluded: !oddsConfigured, healthWeight: oddsConfigured ? 0.15 : 0 }));
  if (!db || !tableExists(db, 'ai_forward_test')) {
    return { channel: CHANNELS.PAPER_TRADING, status: STATUSES.FAIL, score: 0, checks, note: 'Paper Trading DB non disponibile.' };
  }
  const cols = getColumns(db, 'ai_forward_test');
  const resolved = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID')`).get().n || 0);
  const verified = cols.has('settlement_contract_status') ? Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()} AND UPPER(COALESCE(settlement_contract_status,'')) IN ('VERIFIED','VOID')`).get().n || 0) : 0;
  const sourceRows = cols.has('settlement_source') ? Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere()} AND COALESCE(settlement_source,'')<>''`).get().n || 0) : 0;
  const forwardCoverage = resolved ? round(verified / resolved * 100, 2) : 0;
  const sourceCoverage = resolved ? round(sourceRows / resolved * 100, 2) : 0;
  const legacyAwareScore = verified > 0 ? Math.min(100, 55 + forwardCoverage) : Math.min(70, 35 + sourceCoverage * 0.35);
  let paperSourceText = '';
  try { paperSourceText = fs.readFileSync(path.join(__dirname, 'paperTrading.tennis.js'), 'utf8'); } catch (_) {}
  const tennisMyLifePathPresent = /stats\.tennismylife\.org|fetchTennisMyLife|tennisMyLife/i.test(paperSourceText);
  checks.push(sourceCheck('PAPER_TENNISMYLIFE_RESULTS', tennisMyLifePathPresent ? STATUSES.PASS : STATUSES.FAIL, tennisMyLifePathPresent ? 90 : 0, { implementationPresent: tennisMyLifePathPresent, liveCallExecuted: false, authority: 'CONTRACT_GUARDED', zeroKeySource: true }, { healthWeight: 0.15 }));
  checks.push(sourceCheck('PAPER_SETTLEMENT_SOURCE_HISTORY', sourceCoverage > 0 ? STATUSES.WARN : STATUSES.NOT_TESTED, Math.min(75, sourceCoverage), { resolvedRows: resolved, rowsWithSettlementSource: sourceRows, sourceCoveragePct: sourceCoverage, historicalLegacyExpected: true, authority: 'AUDIT_ONLY' }, { healthWeight: 0.15 }));
  checks.push(sourceCheck('PAPER_DUCKDUCKGO_SCORE_FALLBACK', STATUSES.WARN, 50, { authority: 'PROPOSE_ONLY', automaticSettlementAllowed: false, zeroKeySource: true }, { healthWeight: 0.15 }));
  const score = weightedCheckScore(checks);
  return { channel: CHANNELS.PAPER_TRADING, status: combineStatus(checks), score, checks, zeroKeyHealthScoringAligned: true, optionalSourcesExcluded: checks.filter(item => item.scoreExcluded).map(item => item.sourceId), metrics: { resolvedRows: resolved, contractVerifiedRows: verified, forwardContractCoveragePct: forwardCoverage, settlementSourceCoveragePct: sourceCoverage }, note: verified === 0 ? 'Storico legacy senza contratti forward: API a pagamento opzionali escluse dal punteggio; le nuove chiusure restano protette dal contratto Patch 5.' : 'Fonti risultati e contratto settlement verificati con scoring zero-key-first.' };
}

function buildInformationRetrievalHealth(db, options = {}) {
  const players = uniquePlayers(Array.isArray(options.players) && options.players.length ? options.players : selectProbePlayers(db, 2));
  const sharedOptions = { ...options, players };
  const deepScan = auditDeepScanLocal(db, sharedOptions);
  const aiAnalysis = auditAiAnalysisLocal(db, sharedOptions);
  const paperTrading = auditPaperTradingLocal(db, sharedOptions);
  const channels = [deepScan, aiAnalysis, paperTrading];
  const checks = channels.flatMap(channel => channel.checks || []);
  const overallScore = weightedScore([{ score: deepScan.score, weight: 0.30 }, { score: aiAnalysis.score, weight: 0.40 }, { score: paperTrading.score, weight: 0.30 }]);
  const overallStatus = combineStatus(channels);
  const schemaPresent = db && [TABLE_RUNS, TABLE_CHECKS, TABLE_RECEIPTS].every(table => tableExists(db, table));
  const counts = schemaPresent ? {
    runs: Number(db.prepare(`SELECT COUNT(*) n FROM ${TABLE_RUNS}`).get().n || 0),
    checks: Number(db.prepare(`SELECT COUNT(*) n FROM ${TABLE_CHECKS}`).get().n || 0),
    receipts: Number(db.prepare(`SELECT COUNT(*) n FROM ${TABLE_RECEIPTS}`).get().n || 0)
  } : { runs: 0, checks: 0, receipts: 0 };
  const recentRuns = schemaPresent ? db.prepare(`SELECT run_id,run_mode,completed_at,overall_status,overall_score,deep_scan_status,deep_scan_score,ai_analysis_status,ai_analysis_score,paper_trading_status,paper_trading_score,network_used FROM ${TABLE_RUNS} ORDER BY completed_at DESC LIMIT ?`).all(Math.max(1, Math.min(20, Number(options.limit) || 8))) : [];
  return {
    success: overallStatus !== STATUSES.FAIL,
    healthy: overallStatus === STATUSES.PASS,
    status: schemaPresent ? overallStatus : 'SCHEMA_MISSING',
    version: TENNIS_INFORMATION_RETRIEVAL_VERSION,
    policyVersion: TENNIS_INFORMATION_RETRIEVAL_POLICY_VERSION,
    schemaVersion: TENNIS_INFORMATION_RETRIEVAL_SCHEMA_VERSION,
    mode: TENNIS_INFORMATION_RETRIEVAL_MODE,
    readOnly: true,
    networkUsed: false,
    probabilityWeightsChanged: false,
    deepScanDecisionChanged: false,
    qualityGateAuthority: false,
    stakeAuthority: false,
    currentResultUsed: false,
    currentClvUsed: false,
    overallScore,
    probePlayers: players,
    probeScope: aiAnalysis.probeScope || null,
    sourceFreshnessNotMasked: aiAnalysis.probeScope?.sourceFreshnessNotMasked === true,
    zeroKeyHealthScoringAligned: paperTrading.zeroKeyHealthScoringAligned === true,
    optionalSourcesExcluded: paperTrading.optionalSourcesExcluded || [],
    channels: { deepScan, aiAnalysis, paperTrading },
    sourceChecks: checks,
    counts,
    recentRuns,
    generatedAt: new Date().toISOString(),
    note: overallStatus === STATUSES.PASS ? 'Ricerca informazioni certificata sui controlli locali.' : 'Ricerca informazioni disponibile con avvisi: eseguire il probe live e aggiornare i dati giocatori prima di promuovere nuove feature.'
  };
}

function buildPredictionEvidenceReceipt(db, row = {}, bet = {}, options = {}) {
  const cols = row || {};
  const players = [row.home_team || bet.home || bet.p1Name, row.away_team || bet.away || bet.p2Name].filter(Boolean);
  const now = options.now ? new Date(options.now) : new Date();
  const probeScope = resolveProbeScope(db, players, { ...options, targetId: options.targetId || tourDataReadiness.resolveTargetId(row) || tourDataReadiness.resolveTargetId(bet) });
  const playerDataHealth = { status: probeScope.status, latestMatchAt: probeScope.latestMatchAt, dataAgeDays: probeScope.dataAgeDays, targetId: probeScope.targetScope, tour: probeScope.tourScope, sourceFreshnessNotMasked: probeScope.sourceFreshnessNotMasked, aggregateStatusIgnored: true };
  const aiSignals = [
    Number(row.estimated_prob ?? bet.estimatedProb ?? bet.prob) > 0,
    Number(row.edge_pp ?? bet.edge_pp ?? bet.edge) !== 0,
    Number(row.reference_odd1 ?? bet.odd1) > 1 && Number(row.reference_odd2 ?? bet.odd2) > 1,
    Boolean(row.surface || bet.surface),
    Boolean(row.tennis_canonical_match_key || bet.tennis_canonical_match_key),
    Boolean(row.match_date || bet.date)
  ];
  const historicalHealth = options.historicalPlayerStatsHealth || historicalPlayerStats.getStatus({ datasetPath: options.historicalDatasetPath, initialize: true });
  const aiBase = aiSignals.filter(Boolean).length / aiSignals.length * 65;
  const freshness = playerDataHealth.status === 'CURRENT' ? 25 : playerDataHealth.status === 'AGING' ? 18 : playerDataHealth.status === 'STALE' ? 8 : 0;
  const historicalCoverage = historicalHealth.loaded ? (historicalHealth.warningCount > 0 ? 7 : 10) : 0;
  const aiScore = round(aiBase + freshness + historicalCoverage, 2);
  const cacheDir = path.resolve(options.cacheDir || path.join(__dirname, 'cache_news'));
  const cacheChecks = players.map(player => inspectNewsCacheFile(path.join(cacheDir, `${cacheKey(player)}.json`), player, now));
  const cacheAvailable = cacheChecks.length ? cacheChecks.filter(item => item.exists && item.articles > 0).length / cacheChecks.length : 0;
  const dsDecision = Boolean(row.ds_action || bet.ds_action || bet.deepScanStatus || options.phase === RECEIPT_PHASES.DEEPSCAN_COMPLETE);
  const deepScanScore = round(45 * cacheAvailable + 35 * (dsDecision ? 1 : 0) + 20 * (cacheChecks.some(item => item.fresh || item.recent24h) ? 1 : 0), 2);
  const identityReady = Boolean(row.tennis_canonical_match_key || row.provider_event_id || bet.provider_event_id);
  const marketReady = Boolean(row.market_type || bet.marketType || bet.prediction);
  const paperScore = round((identityReady ? 45 : 0) + (marketReady ? 25 : 0) + 30, 2); // 30 = settlement contract present in installed program.
  const overallScore = weightedScore([{ score: aiScore, weight: 0.45 }, { score: deepScanScore, weight: 0.30 }, { score: paperScore, weight: 0.25 }]);
  let status = overallScore >= 80 ? 'CERTIFIED' : overallScore >= 55 ? 'PARTIAL' : 'INSUFFICIENT';
  if (playerDataHealth.status === 'STALE' && status === 'CERTIFIED') status = 'PARTIAL_STALE_DATA';
  const betId = Number(row.id || options.betId);
  const sourceBoundaryId = db && tableExists(db, 'ai_forward_test') ? Number(db.prepare(`SELECT COALESCE(MAX(id),0) n FROM ai_forward_test WHERE ${tennisWhere()} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID') AND id < ?`).get(betId || Number.MAX_SAFE_INTEGER).n || 0) : 0;
  const summary = {
    phase: options.phase || RECEIPT_PHASES.PREDICTION_CAPTURE,
    players,
    playerDataStatus: playerDataHealth.status || 'UNKNOWN',
    playerDataLatestMatchAt: playerDataHealth.latestMatchAt || null,
    playerDataTargetId: probeScope.targetScope,
    playerDataTour: probeScope.tourScope,
    playerDataAgeDays: probeScope.dataAgeDays,
    sourceFreshnessNotMasked: probeScope.sourceFreshnessNotMasked === true,
    aggregateStatusIgnored: true,
    historicalPlayerStats: { status: historicalHealth.status || 'UNAVAILABLE', datasetId: historicalHealth.datasetId || null, activeRecords: historicalHealth.activeRecords || 0, quarantinedRecords: historicalHealth.quarantinedRecords || 0, warningCodes: historicalHealth.warningCodes || [], modelProbabilityAuthority: false, stakeAuthority: false },
    aiSignals: { available: aiSignals.filter(Boolean).length, total: aiSignals.length },
    deepScan: { decisionAvailable: dsDecision, cacheAvailablePct: round(cacheAvailable * 100, 2), cacheChecks },
    paperTrading: { identityReady, marketReady, settlementContractRequired: true, weakWebAutoSettlement: false },
    noCurrentResultOrClv: true,
    modelAuthority: false,
    stakeAuthority: false
  };
  const evidence = { betId, predictionSnapshotId: options.snapshotId || null, phase: options.phase || RECEIPT_PHASES.PREDICTION_CAPTURE, status, overallScore, deepScanScore, aiScore, paperScore, sourceBoundaryId, summary, version: TENNIS_INFORMATION_RETRIEVAL_VERSION };
  const evidenceHash = sha256Json(evidence);
  return { ...evidence, evidenceHash, receiptId: `TIR23_${betId || 0}_${String(evidence.phase).replace(/[^A-Z0-9_]/gi, '_')}_${evidenceHash.slice(0, 12)}`, createdAt: options.createdAt || new Date().toISOString() };
}

function persistPredictionEvidenceReceipt(db, row = {}, bet = {}, options = {}) {
  ensureInformationRetrievalSchema(db);
  const receipt = buildPredictionEvidenceReceipt(db, row, bet, options);
  const exists = db.prepare(`SELECT receipt_id FROM ${TABLE_RECEIPTS} WHERE evidence_hash=?`).get(receipt.evidenceHash);
  if (exists) return { inserted: false, duplicate: true, receipt: db.prepare(`SELECT * FROM ${TABLE_RECEIPTS} WHERE receipt_id=?`).get(exists.receipt_id) };
  db.prepare(`INSERT INTO ${TABLE_RECEIPTS} (receipt_id,bet_id,prediction_snapshot_id,phase,status,overall_score,deep_scan_score,ai_analysis_score,paper_trading_score,source_boundary_id,source_summary_json,evidence_hash,created_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    receipt.receiptId, receipt.betId, receipt.predictionSnapshotId, receipt.phase, receipt.status, receipt.overallScore, receipt.deepScanScore, receipt.aiScore, receipt.paperScore, receipt.sourceBoundaryId, JSON.stringify(receipt.summary), receipt.evidenceHash, receipt.createdAt, TENNIS_INFORMATION_RETRIEVAL_VERSION
  );
  return { inserted: true, duplicate: false, receipt };
}

function getPredictionEvidence(db, betId) {
  if (!db || !tableExists(db, TABLE_RECEIPTS)) return { success: false, status: 'SCHEMA_MISSING', betId: Number(betId), receipts: [] };
  const rows = db.prepare(`SELECT * FROM ${TABLE_RECEIPTS} WHERE bet_id=? ORDER BY created_at,receipt_id`).all(Number(betId));
  return { success: true, status: rows.length ? 'AVAILABLE' : 'NO_RECEIPT', betId: Number(betId), receipts: rows.map(row => ({ ...row, sourceSummary: safeJsonParse(row.source_summary_json, {}) })), version: TENNIS_INFORMATION_RETRIEVAL_VERSION, readOnly: true, stakeAuthority: false };
}

function createRunId(prefix = 'TIR23') { return `${prefix}_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${crypto.randomBytes(4).toString('hex')}`; }
function persistRetrievalRun(db, report) {
  ensureInformationRetrievalSchema(db);
  const runId = report.runId || createRunId();
  const checks = report.sourceChecks || Object.values(report.channels || {}).flatMap(channel => channel.checks || []);
  const safeReport = { ...report, runId, sourceChecks: checks };
  const reportHash = sha256Json(safeReport);
  const statuses = checks.map(item => item.status);
  db.prepare(`INSERT INTO ${TABLE_RUNS} (run_id,run_mode,started_at,completed_at,overall_status,overall_score,deep_scan_status,deep_scan_score,ai_analysis_status,ai_analysis_score,paper_trading_status,paper_trading_score,network_used,source_count,pass_count,warn_count,fail_count,probe_players_json,report_json,report_hash,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    runId, report.runMode || 'LOCAL_AUDIT', report.startedAt || report.generatedAt || new Date().toISOString(), report.completedAt || new Date().toISOString(), report.status, report.overallScore,
    report.channels.deepScan.status, report.channels.deepScan.score, report.channels.aiAnalysis.status, report.channels.aiAnalysis.score, report.channels.paperTrading.status, report.channels.paperTrading.score,
    report.networkUsed ? 1 : 0, checks.length, statuses.filter(v => v === STATUSES.PASS).length, statuses.filter(v => v === STATUSES.WARN || v === STATUSES.NOT_CONFIGURED || v === STATUSES.NOT_TESTED).length, statuses.filter(v => v === STATUSES.FAIL).length,
    JSON.stringify(report.probePlayers || []), JSON.stringify(safeReport), reportHash, TENNIS_INFORMATION_RETRIEVAL_VERSION
  );
  const insert = db.prepare(`INSERT INTO ${TABLE_CHECKS} (check_id,run_id,channel,source_id,source_tier,authority,status,score,latency_ms,observed_at,details_json,evidence_hash,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  checks.forEach((item, index) => insert.run(`TIRC23_${runId}_${String(index + 1).padStart(3, '0')}`, runId, item.channel, item.sourceId, item.sourceTier, item.authority, item.status, item.score, item.latencyMs, item.observedAt, JSON.stringify(item.details || {}), item.evidenceHash, TENNIS_INFORMATION_RETRIEVAL_VERSION));
  return { runId, reportHash, insertedChecks: checks.length };
}

async function fetchText(url, options = {}) {
  if (typeof fetch !== 'function') throw new Error('GLOBAL_FETCH_UNAVAILABLE');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(options.timeoutMs) || 8000));
  const started = Date.now();
  try {
    const response = await fetch(url, { method: options.method || 'GET', headers: options.headers || {}, body: options.body, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    const max = Math.max(1024, Number(options.maxBytes) || 1500000);
    if (Buffer.byteLength(text) > max) throw new Error(`RESPONSE_TOO_LARGE:${Buffer.byteLength(text)}`);
    return { ok: response.ok, status: response.status, text, latencyMs: Date.now() - started, finalUrl: response.url, contentType: response.headers?.get?.('content-type') || null };
  } finally { clearTimeout(timeout); }
}
function countRssItems(text) { return (String(text || '').match(/<item\b/gi) || []).length; }
function inspectRss(text, player) {
  const value = String(text || '');
  const rawItemCount = countRssItems(value);
  const rssParsed = /<(?:rss|feed)\b/i.test(value);
  const consentPageDetected = /consent\.google|before you continue|consent required/i.test(value);
  return { ok: rawItemCount > 0 && containsPlayer(value, player), details: { rawItemCount, itemCount: rawItemCount, rssParsed, playerRelevant: containsPlayer(value, player), consentPageDetected, parserError: rssParsed ? null : 'RSS_ROOT_NOT_DETECTED' } };
}
function containsPlayer(text, player) { const t = normalizeText(text); const p = normalizeText(player); const s = p.split(' ').pop(); return Boolean((p && t.includes(p)) || (s && t.includes(s))); }
async function probeSource(sourceId, request, validator) {
  const registry = SOURCE_REGISTRY[sourceId] || {};
  try {
    const response = await fetchText(request.url, request);
    const validation = validator(response);
    const status = response.ok && validation.ok ? STATUSES.PASS : response.ok ? STATUSES.WARN : STATUSES.FAIL;
    const score = response.ok ? (validation.ok ? 100 : 60) : 0;
    return sourceCheck(sourceId, status, score, { httpStatus: response.status, finalHost: (() => { try { return new URL(response.finalUrl).host; } catch (_) { return null; } })(), contentType: response.contentType, responseChars: response.text.length, ...validation.details }, { latencyMs: response.latencyMs });
  } catch (error) { return sourceCheck(sourceId, STATUSES.FAIL, 0, { error: error.name === 'AbortError' ? 'TIMEOUT' : error.message, host: (() => { try { return new URL(request.url).host; } catch (_) { return null; } })() }); }
}

async function runLiveRetrievalProbe(db, options = {}) {
  const startedAt = new Date().toISOString(); const runId = options.runId || createRunId('TIR23_LIVE');
  const players = uniquePlayers(Array.isArray(options.players) && options.players.length ? options.players : selectProbePlayers(db, 2)).slice(0, 2);
  const local = buildInformationRetrievalHealth(db, { ...options, players });
  const p1 = players[0] || 'Jannik Sinner'; const p2 = players[1] || 'Carlos Alcaraz';
  const newsQuery = `"${p1}" tennis injury form`; const h2hQuery = `${p1} vs ${p2} h2h tennis`;
  const liveChecks = [];
  liveChecks.push(await probeSource('DEEPSCAN_GOOGLE_NEWS_RSS', { url: `https://news.google.com/rss/search?q=${encodeURIComponent(newsQuery + ' when:6m')}`, timeoutMs: options.timeoutMs }, response => inspectRss(response.text, p1)));
  liveChecks.push(await probeSource('DEEPSCAN_BING_NEWS_RSS', { url: `https://www.bing.com/news/search?q=${encodeURIComponent(newsQuery)}&format=rss`, timeoutMs: options.timeoutMs }, response => inspectRss(response.text, p1)));
  liveChecks.push(await probeSource('DEEPSCAN_DUCKDUCKGO_H2H', { url: 'https://lite.duckduckgo.com/lite/', method: 'POST', body: `q=${encodeURIComponent(h2hQuery)}&kl=&df=`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutMs: options.timeoutMs }, response => ({ ok: response.text.length > 500 && containsPlayer(response.text, p1) && containsPlayer(response.text, p2), details: { responseChars: response.text.length, player1Relevant: containsPlayer(response.text, p1), player2Relevant: containsPlayer(response.text, p2) } })));
  liveChecks.push(await probeSource('PAPER_TENNISMYLIFE_RESULTS', { url: 'https://stats.tennismylife.org/', timeoutMs: options.timeoutMs }, response => ({ ok: response.text.length > 1000 && /tennis/i.test(response.text), details: { responseChars: response.text.length, tennisMarker: /tennis/i.test(response.text) } })));
  const oddsConfigured = [process.env.ODDS_API_KEY, process.env.THE_ODDS_API_KEY, process.env.ODDS_API_KEYS].some(value => value && String(value).trim());
  liveChecks.push(sourceCheck('PAPER_ODDS_API_SCORES', oddsConfigured ? STATUSES.PASS : STATUSES.OPTIONAL_NOT_CONFIGURED, oddsConfigured ? 85 : 0, { configured: oddsConfigured, optional: true, scoreExcluded: !oddsConfigured, zeroKeyPolicy: 'OPTIONAL_PAID_FALLBACK_AFTER_ZERO_KEY_SOURCES', liveCallExecuted: false, reason: 'Probe non consuma crediti Odds API; una chiave assente non degrada lo health zero-key-first.', secretExposed: false }, { optional: true, scoreExcluded: !oddsConfigured, healthWeight: oddsConfigured ? 1 : 0 }));
  const deepChecks = [...local.channels.deepScan.checks, ...liveChecks.filter(item => item.channel === CHANNELS.DEEPSCAN)];
  const aiChecks = [...local.channels.aiAnalysis.checks];
  const paperChecks = [...local.channels.paperTrading.checks.filter(item => !['PAPER_TENNISMYLIFE_RESULTS','PAPER_ODDS_API_SCORES'].includes(item.sourceId)), ...liveChecks.filter(item => item.channel === CHANNELS.PAPER_TRADING)];
  const deepScan = { ...local.channels.deepScan, checks: deepChecks, score: weightedScore(deepChecks.map(item => ({ score: item.score, weight: item.sourceId === 'DEEPSCAN_LOCAL_NEWS_CACHE' ? 0.35 : 0.65 / Math.max(1, deepChecks.length - 1) }))), status: combineStatus(deepChecks) };
  const aiAnalysis = { ...local.channels.aiAnalysis, checks: aiChecks, status: combineStatus(aiChecks), score: weightedScore(aiChecks) };
  const paperTrading = { ...local.channels.paperTrading, checks: paperChecks, status: combineStatus(paperChecks), score: weightedCheckScore(paperChecks), zeroKeyHealthScoringAligned: true, optionalSourcesExcluded: paperChecks.filter(item => item.scoreExcluded).map(item => item.sourceId) };
  const channels = { deepScan, aiAnalysis, paperTrading };
  const sourceChecks = Object.values(channels).flatMap(channel => channel.checks);
  const overallScore = weightedScore([{ score: deepScan.score, weight: 0.30 }, { score: aiAnalysis.score, weight: 0.40 }, { score: paperTrading.score, weight: 0.30 }]);
  const report = { success: combineStatus(Object.values(channels)) !== STATUSES.FAIL, healthy: combineStatus(Object.values(channels)) === STATUSES.PASS, status: combineStatus(Object.values(channels)), version: TENNIS_INFORMATION_RETRIEVAL_VERSION, policyVersion: TENNIS_INFORMATION_RETRIEVAL_POLICY_VERSION, mode: TENNIS_INFORMATION_RETRIEVAL_MODE, runId, runMode: 'LIVE_PROBE', startedAt, completedAt: new Date().toISOString(), networkUsed: true, probePlayers: players, probeScope: aiAnalysis.probeScope || null, sourceFreshnessNotMasked: aiAnalysis.probeScope?.sourceFreshnessNotMasked === true, zeroKeyHealthScoringAligned: paperTrading.zeroKeyHealthScoringAligned === true, optionalSourcesExcluded: paperTrading.optionalSourcesExcluded || [], overallScore, channels, sourceChecks, probabilityWeightsChanged: false, deepScanDecisionChanged: false, qualityGateAuthority: false, stakeAuthority: false, currentResultUsed: false, currentClvUsed: false, note: 'Probe live completato. Le fonti deboli restano contestuali o PROPOSE_ONLY e non possono certificare da sole un settlement.' };
  if (options.persist !== false && db) report.persistence = persistRetrievalRun(db, report);
  return report;
}


function buildPaperTradingExecutionCertification(diagnostics = {}) {
  const noPending = Number(diagnostics.pendingTennisRows || 0) === 0;
  const tmlRows = Number(diagnostics.tennisMyLifeRowsLoaded || 0);
  const apiLoaded = Number(diagnostics.apiScoresLoaded || 0);
  const apiErrors = Array.isArray(diagnostics.apiErrors) ? diagnostics.apiErrors.length : 0;
  const contractVerified = Number(diagnostics.contractVerified || 0);
  const contractVoid = Number(diagnostics.contractVoid || 0);
  const contractBlocked = Number(diagnostics.contractBlocked || 0);
  const tmlStatus = noPending ? STATUSES.NOT_TESTED : tmlRows > 0 ? STATUSES.PASS : STATUSES.WARN;
  const apiConfigured = diagnostics.apiConfigured !== false && ([process.env.ODDS_API_KEY, process.env.THE_ODDS_API_KEY, process.env.ODDS_API_KEYS].some(value => value && String(value).trim()) || apiLoaded > 0 || apiErrors > 0);
  const apiStatus = !apiConfigured && diagnostics.apiOptional !== false
    ? STATUSES.OPTIONAL_NOT_CONFIGURED
    : noPending || diagnostics.apiSkippedNoPendingToResolve === true
      ? STATUSES.NOT_TESTED
    : apiLoaded > 0 ? STATUSES.PASS
      : diagnostics.settlementApiBudgetBlocked === true || diagnostics.apiUnavailableOrExhausted === true ? STATUSES.WARN
        : apiErrors > 0 ? STATUSES.FAIL : STATUSES.NOT_TESTED;
  const contractStatus = noPending ? STATUSES.NOT_TESTED : (contractVerified + contractVoid) > 0 ? STATUSES.PASS : contractBlocked > 0 ? STATUSES.WARN : STATUSES.NOT_TESTED;
  const checks = [
    sourceCheck('PAPER_TENNISMYLIFE_RESULTS', tmlStatus, noPending ? 60 : tmlRows > 0 ? 95 : 45, { pendingRows: Number(diagnostics.pendingTennisRows || 0), rowsLoaded: tmlRows, operationId: diagnostics.operationId || null, authority: 'CONTRACT_GUARDED' }),
    sourceCheck('PAPER_ODDS_API_SCORES', apiStatus, apiStatus === STATUSES.OPTIONAL_NOT_CONFIGURED ? 0 : noPending ? 60 : apiLoaded > 0 ? 95 : apiStatus === STATUSES.FAIL ? 0 : 50, { configured: apiConfigured, optional: diagnostics.apiOptional !== false, scoreExcluded: apiStatus === STATUSES.OPTIONAL_NOT_CONFIGURED, scoresLoaded: apiLoaded, errors: apiErrors, budgetBlocked: diagnostics.settlementApiBudgetBlocked === true, skippedNoPending: diagnostics.apiSkippedNoPendingToResolve === true, creditsUsed: Number(diagnostics.apiCreditsUsed || 0), secretExposed: false }, { optional: diagnostics.apiOptional !== false, scoreExcluded: apiStatus === STATUSES.OPTIONAL_NOT_CONFIGURED, healthWeight: apiStatus === STATUSES.OPTIONAL_NOT_CONFIGURED ? 0 : 1 }),
    sourceCheck('PAPER_SETTLEMENT_CONTRACT', contractStatus, noPending ? 75 : (contractVerified + contractVoid) > 0 ? 100 : contractBlocked > 0 ? 70 : 60, { verified: contractVerified, void: contractVoid, blocked: contractBlocked, automaticWeakSourceSettlementAllowed: false })
  ];
  const score = weightedCheckScore(checks);
  return {
    success: combineStatus(checks) !== STATUSES.FAIL,
    status: combineStatus(checks),
    score,
    channel: CHANNELS.PAPER_TRADING,
    checks,
    operationId: diagnostics.operationId || null,
    sourceUse: {
      tennisMyLifeRowsLoaded: tmlRows,
      oddsApiScoresLoaded: apiLoaded,
      contractVerified,
      contractVoid,
      contractBlocked
    },
    resultCertification: 'PATCH5_SETTLEMENT_CONTRACT_REQUIRED',
    weakSourceAuthority: 'PROPOSE_ONLY_OR_CONTRACT_GUARDED',
    currentResultInvented: false,
    note: noPending
      ? 'Nessuna riga PENDING: le fonti risultato non sono state interrogate.'
      : 'Ricerca risultati Paper Trading certificata per questa esecuzione; fonti deboli non chiudono automaticamente.'
  };
}


module.exports = {
  TENNIS_INFORMATION_RETRIEVAL_VERSION,
  TENNIS_INFORMATION_RETRIEVAL_POLICY_VERSION,
  TENNIS_INFORMATION_RETRIEVAL_COMPATIBILITY_VERSION,
  TENNIS_INFORMATION_RETRIEVAL_SCHEMA_VERSION,
  TENNIS_INFORMATION_RETRIEVAL_MODE,
  TABLE_RUNS, TABLE_CHECKS, TABLE_RECEIPTS, CHANNELS, STATUSES, RECEIPT_PHASES, SOURCE_TIERS, SOURCE_REGISTRY,
  ensureInformationRetrievalSchema,
  selectProbePlayers,
  tennisWhereForColumns,
  resolvePlayerNamePair,
  resolveProbeScope,
  inspectNewsCacheFile,
  auditDeepScanLocal,
  auditAiAnalysisLocal,
  auditPaperTradingLocal,
  buildInformationRetrievalHealth,
  buildPredictionEvidenceReceipt,
  persistPredictionEvidenceReceipt,
  getPredictionEvidence,
  persistRetrievalRun,
  runLiveRetrievalProbe,
  buildPaperTradingExecutionCertification,
  weightedCheckScore,
  sha256Json
};
