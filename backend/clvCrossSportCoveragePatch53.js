'use strict';

const VERSION = 'CLV_CROSS_SPORT_COVERAGE_V1_PATCH53';
const SPORT_KEY_RESOLUTION_VERSION = 'CLV_CROSS_SPORT_SPORT_KEY_RESOLUTION_V1_PATCH53';
const COVERAGE_SCHEMA_VERSION = 'CLV_COVERAGE_SCHEMA_V1_PATCH53';

const DEFAULT_FOOTBALL_LEAGUES = Object.freeze({
  serie_a: Object.freeze({ code: 'I1', api: 'soccer_italy_serie_a', name: 'Serie A' }),
  serie_b: Object.freeze({ code: 'I2', api: 'soccer_italy_serie_b', name: 'Serie B' }),
  premier_league: Object.freeze({ code: 'E0', api: 'soccer_epl', name: 'Premier' }),
  la_liga: Object.freeze({ code: 'SP1', api: 'soccer_spain_la_liga', name: 'La Liga' }),
  ligue_1: Object.freeze({ code: 'F1', api: 'soccer_france_ligue_one', name: 'Ligue 1' }),
  bundesliga: Object.freeze({ code: 'D1', api: 'soccer_germany_bundesliga', name: 'Bundesliga' })
});

const FOOTBALL_ALIASES = Object.freeze({
  serie_a: Object.freeze(['serie a', 'italy serie a', 'italian serie a', 'serie_a']),
  serie_b: Object.freeze(['serie b', 'italy serie b', 'italian serie b', 'serie_b']),
  premier_league: Object.freeze(['premier', 'premier league', 'english premier league', 'epl', 'premier_league']),
  la_liga: Object.freeze(['la liga', 'laliga', 'spanish la liga', 'primera division', 'la_liga']),
  ligue_1: Object.freeze(['ligue 1', 'ligue one', 'france ligue 1', 'french ligue 1', 'ligue_1']),
  bundesliga: Object.freeze(['bundesliga', 'german bundesliga', 'germany bundesliga'])
});

const TERMINAL_STATES = new Set([
  'TEMPORALLY_IRRECOVERABLE',
  'MARKET_IRRECOVERABLE',
  'EXHAUSTED',
  'MANUAL_REVIEW',
  'TERMINAL',
  'IRRECOVERABLE'
]);

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function round(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}
function normalize(value) {
  return text(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function detectSport(row = {}) {
  const raw = normalize([
    row.sport_type, row.sport, row.bet_type, row.strategy_tag,
    row.league, row.market_type
  ].filter(Boolean).join(' '));
  return ['tennis', 'atp', 'wta', 'challenger', 'grand slam'].some(token => raw.includes(token))
    ? 'TENNIS'
    : 'CALCIO';
}
function isCleanRow(row = {}) {
  const quality = upper(row.data_quality);
  return !['LEGACY_DIRTY', 'DIRTY', 'OLD_METRICS'].includes(quality);
}
function isEligibleClvRow(row = {}) {
  const status = upper(row.status);
  const betType = upper(row.bet_type);
  return isCleanRow(row) && ['PENDING', 'WON', 'LOST'].includes(status) && !betType.startsWith('MULTI');
}
function getExplicitSportKey(row = {}) {
  return text(
    row.clv_sport_key_resolved ||
    row.api_sport_key ||
    row.provider_sport_key ||
    row.odds_sport_key ||
    row.sport_key ||
    row.the_odds_sport_key ||
    ''
  );
}
function buildFootballIndex(leaguesConfig = {}) {
  const config = Object.keys(leaguesConfig || {}).length ? leaguesConfig : DEFAULT_FOOTBALL_LEAGUES;
  const index = [];
  for (const [configKey, entryRaw] of Object.entries(config)) {
    const entry = entryRaw || {};
    const api = text(entry.api);
    if (!api) continue;
    const aliases = new Set([
      configKey,
      entry.name,
      entry.code,
      api,
      ...(FOOTBALL_ALIASES[configKey] || [])
    ].map(normalize).filter(Boolean));
    index.push({
      configKey,
      api,
      name: text(entry.name || configKey),
      code: text(entry.code),
      aliases: [...aliases]
    });
  }
  return index;
}
function resolveFootballSportKey(row = {}, leaguesConfig = {}) {
  const index = buildFootballIndex(leaguesConfig);
  const explicit = getExplicitSportKey(row);
  if (explicit) {
    const exact = index.find(item => item.api === explicit);
    if (exact) {
      return {
        status: 'RESOLVED_EXPLICIT_CONFIG_VALIDATED',
        sportKey: exact.api,
        source: 'EXPLICIT_FIELD',
        confidence: 1,
        reason: 'EXPLICIT_KEY_MATCHES_LEAGUE_CONFIG',
        requestedKey: explicit,
        leagueConfigKey: exact.configKey
      };
    }
  }

  const leagueText = normalize(row.league || row.competition || row.series || '');
  const strategyText = normalize(row.strategy_tag || '');
  const combined = normalize([row.league, row.competition, row.series, row.strategy_tag].filter(Boolean).join(' '));
  const candidates = [];

  for (const item of index) {
    let score = 0;
    let source = null;
    if (item.aliases.includes(leagueText) && leagueText) {
      score = 100;
      source = 'LEAGUE_EXACT_ALIAS';
    } else if (item.aliases.some(alias => alias.length >= 5 && strategyText.startsWith(alias)) && strategyText) {
      score = 92;
      source = 'STRATEGY_PREFIX_ALIAS';
    } else if (item.aliases.some(alias => alias.length >= 5 && combined.includes(alias)) && combined) {
      score = 80;
      source = 'COMBINED_TEXT_ALIAS';
    }
    if (score > 0) candidates.push({ item, score, source });
  }

  candidates.sort((a, b) => b.score - a.score || a.item.api.localeCompare(b.item.api));
  if (!candidates.length) {
    return {
      status: 'UNRESOLVED_FOOTBALL_LEAGUE',
      sportKey: null,
      source: 'NONE',
      confidence: 0,
      reason: leagueText ? `NO_CONFIG_ALIAS_FOR_${leagueText.replace(/\s+/g, '_').toUpperCase()}` : 'LEAGUE_MISSING',
      requestedKey: explicit || null,
      leagueConfigKey: null
    };
  }
  if (candidates.length > 1 && candidates[0].score === candidates[1].score && candidates[0].item.api !== candidates[1].item.api) {
    return {
      status: 'AMBIGUOUS_FOOTBALL_LEAGUE',
      sportKey: null,
      source: 'AMBIGUOUS_ALIAS',
      confidence: 0,
      reason: `AMBIGUOUS_${candidates[0].item.configKey}_${candidates[1].item.configKey}`,
      requestedKey: explicit || null,
      leagueConfigKey: null
    };
  }

  const winner = candidates[0];
  return {
    status: 'RESOLVED_FOOTBALL_CONFIG',
    sportKey: winner.item.api,
    source: winner.source,
    confidence: round(winner.score / 100, 2),
    reason: `CONFIG_${winner.item.configKey.toUpperCase()}`,
    requestedKey: explicit || null,
    leagueConfigKey: winner.item.configKey
  };
}

function slugPart(value = '') {
  return normalize(value)
    .replace(/\b(atp|wta|grand slam|tennis|tour|open)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
function inferTennisKeyFromRow(row = {}) {
  const joined = upper([
    row.league, row.tournament, row.tournament_name, row.tournament_canonical_name,
    row.strategy_tag, row.sport_type, row.bet_type
  ].filter(Boolean).join(' '));
  if (!joined.includes('ATP') && !joined.includes('WTA')) return null;
  const tour = joined.includes('WTA') ? 'wta' : 'atp';
  let rawTournament = text(
    row.tournament_canonical_name || row.tournament_name || row.tournament ||
    row.canonical_tournament_key || row.league || ''
  );
  rawTournament = rawTournament
    .replace(/^\s*(ATP\s*500|WTA\s*500|ATP500|WTA500)\s*[-:–]\s*/i, '')
    .replace(/^\s*(ATP\s*250|WTA\s*250|ATP250|WTA250)\s*[-:–]\s*/i, '')
    .replace(/^\s*(ATP\s*1000|WTA\s*1000|MASTERS\s*1000)\s*[-:–]\s*/i, '');
  const low = normalize(rawTournament);
  if (low.includes('french') || low.includes('roland garros')) return `tennis_${tour}_french_open`;
  if (low.includes('australian')) return `tennis_${tour}_australian_open`;
  if (low.includes('wimbledon')) return `tennis_${tour}_wimbledon`;
  if (low.includes('us open') || low.includes('u s open')) return `tennis_${tour}_us_open`;
  if (low.includes('canada') || low.includes('toronto') || low.includes('montreal')) return `tennis_${tour}_canadian_open`;
  const slug = slugPart(rawTournament);
  const invalid = new Set(['grand_slam', 'masters_1000', 'atp', 'wta', 'atp500', 'wta500', 'atp_500', 'wta_500', 'atp250', 'wta250', 'atp_250', 'wta_250', 'other']);
  if (slug && !invalid.has(slug)) return `tennis_${tour}_${slug}`;
  return null;
}

function resolveTennisSportKey(row = {}, options = {}) {
  const explicit = getExplicitSportKey(row);
  if (explicit && explicit.startsWith('tennis_')) {
    return {
      status: 'RESOLVED_EXPLICIT_TENNIS_KEY',
      sportKey: explicit,
      source: 'EXPLICIT_FIELD',
      confidence: 1,
      reason: 'EXPLICIT_TENNIS_KEY_PRESENT',
      requestedKey: explicit
    };
  }
  const infer = typeof options.inferTennisKey === 'function' ? options.inferTennisKey : inferTennisKeyFromRow;
  const inferred = text(infer(row));
  if (inferred) {
    return {
      status: 'RESOLVED_TENNIS_INFERENCE',
      sportKey: inferred,
      source: 'TOURNAMENT_INFERENCE',
      confidence: 0.75,
      reason: 'PROVISIONAL_KEY_REQUIRES_ACTIVE_CATALOG_VALIDATION_BEFORE_FETCH',
      requestedKey: inferred
    };
  }
  return {
    status: 'TENNIS_ACTIVE_CATALOG_REQUIRED',
    sportKey: null,
    source: 'NONE',
    confidence: 0,
    reason: 'TOURNAMENT_IDENTITY_INSUFFICIENT_FOR_SAFE_PROVIDER_KEY',
    requestedKey: null
  };
}
function resolveSportKeyForBet(row = {}, leaguesConfig = {}, options = {}) {
  const sport = detectSport(row);
  const resolved = sport === 'TENNIS'
    ? resolveTennisSportKey(row, options)
    : resolveFootballSportKey(row, leaguesConfig);
  return {
    version: SPORT_KEY_RESOLUTION_VERSION,
    sport,
    ...resolved,
    resolved: Boolean(resolved.sportKey),
    authority: 'CLV_PROVIDER_ROUTING_ONLY',
    probabilityAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false
  };
}
function hasKnownSource(row = {}) {
  const source = upper([row.clv_source, row.clv_method, row.clv_last_attempt_result].filter(Boolean).join(' '));
  return ['LIVE_API', 'VAULT', 'CLOSING', 'POST_MATCH', 'INTERNAL'].some(token => source.includes(token));
}
function classifyClvEvidence(row = {}) {
  const verifiedFlag = number(row.clv_verified, 0) === 1;
  const closingOdd = number(row.closing_odd, 0);
  const legacyClosingOdd = number(row.clv, 0);
  const edge = number(row.clv_edge, 0);
  const hasEvidence = closingOdd > 1 || legacyClosingOdd > 1 || Math.abs(edge) > 0.000001 || hasKnownSource(row);
  const state = upper(row.clv_degraded_state);
  const terminalReason = text(row.clv_terminal_reason);
  const terminal = Boolean(terminalReason) || [...TERMINAL_STATES].some(token => state.includes(token));
  const retryEligible = number(row.clv_retry_eligible, 0) === 1;

  if (verifiedFlag && hasEvidence) return { state: 'VERIFIED', verified: true, availableUnverified: false, retryEligible: false, terminal: false, missing: false };
  if (hasEvidence) return { state: 'AVAILABLE_UNVERIFIED', verified: false, availableUnverified: true, retryEligible, terminal, missing: false };
  if (terminal) return { state: 'TERMINAL_NO_EVIDENCE', verified: false, availableUnverified: false, retryEligible: false, terminal: true, missing: true };
  if (retryEligible) return { state: 'RETRY_ELIGIBLE_NO_EVIDENCE', verified: false, availableUnverified: false, retryEligible: true, terminal: false, missing: true };
  return { state: 'MISSING', verified: false, availableUnverified: false, retryEligible: false, terminal: false, missing: true };
}
function createEmptySegment(sport) {
  return {
    sport,
    eligibleRows: 0,
    pendingRows: 0,
    resolvedRows: 0,
    positiveStakeRows: 0,
    verifiedClvRows: 0,
    availableUnverifiedRows: 0,
    retryEligibleRows: 0,
    terminalRows: 0,
    missingEvidenceRows: 0,
    sportKeyResolvedRows: 0,
    sportKeyUnresolvedRows: 0,
    verifiedCoveragePct: 0,
    evidenceAvailabilityPct: 0,
    sportKeyCoveragePct: 0
  };
}
function finalizeSegment(segment) {
  const denominator = segment.eligibleRows || 0;
  segment.verifiedCoveragePct = denominator ? round(segment.verifiedClvRows / denominator * 100, 2) : 0;
  segment.evidenceAvailabilityPct = denominator ? round((segment.verifiedClvRows + segment.availableUnverifiedRows) / denominator * 100, 2) : 0;
  segment.sportKeyCoveragePct = denominator ? round(segment.sportKeyResolvedRows / denominator * 100, 2) : 0;
  return segment;
}
function buildCoverageReportFromRows(rows = [], leaguesConfig = {}, options = {}) {
  const eligible = (Array.isArray(rows) ? rows : []).filter(isEligibleClvRow);
  const bySport = { TENNIS: createEmptySegment('TENNIS'), CALCIO: createEmptySegment('CALCIO') };
  const resolutionStatuses = {};
  const evidenceStates = {};
  const unresolvedExamples = [];

  for (const row of eligible) {
    const sport = detectSport(row);
    const segment = bySport[sport] || (bySport[sport] = createEmptySegment(sport));
    const evidence = classifyClvEvidence(row);
    const resolution = resolveSportKeyForBet(row, leaguesConfig, options);
    segment.eligibleRows += 1;
    if (upper(row.status) === 'PENDING') segment.pendingRows += 1; else segment.resolvedRows += 1;
    if (number(row.stake ?? row.real_stake, 0) > 0) segment.positiveStakeRows += 1;
    if (evidence.verified) segment.verifiedClvRows += 1;
    if (evidence.availableUnverified) segment.availableUnverifiedRows += 1;
    if (evidence.retryEligible) segment.retryEligibleRows += 1;
    if (evidence.terminal) segment.terminalRows += 1;
    if (evidence.missing) segment.missingEvidenceRows += 1;
    if (resolution.resolved) segment.sportKeyResolvedRows += 1;
    else {
      segment.sportKeyUnresolvedRows += 1;
      if (unresolvedExamples.length < 20) unresolvedExamples.push({
        id: row.id ?? null,
        sport,
        league: row.league || null,
        tournament: row.tournament_name || row.tournament || null,
        status: resolution.status,
        reason: resolution.reason
      });
    }
    resolutionStatuses[resolution.status] = (resolutionStatuses[resolution.status] || 0) + 1;
    evidenceStates[evidence.state] = (evidenceStates[evidence.state] || 0) + 1;
  }

  Object.values(bySport).forEach(finalizeSegment);
  const overall = createEmptySegment('ALL');
  for (const segment of Object.values(bySport)) {
    for (const key of Object.keys(overall)) {
      if (typeof overall[key] === 'number' && !key.endsWith('Pct')) overall[key] += number(segment[key], 0);
    }
  }
  finalizeSegment(overall);

  return {
    success: true,
    version: VERSION,
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    sportKeyResolutionVersion: SPORT_KEY_RESOLUTION_VERSION,
    generatedAt: new Date().toISOString(),
    dataMode: 'CURRENT_CLEAN_SINGLE_PENDING_WON_LOST',
    overall,
    bySport,
    resolutionStatuses,
    evidenceStates,
    unresolvedExamples,
    invariants: {
      verifiedClosingEvidenceOnly: true,
      noSyntheticClosingOdds: true,
      noHistoricalOutcomeMutation: true,
      noProbabilityAuthority: true,
      noStakeAuthority: true,
      noSettlementAuthority: true,
      routingDoesNotConsumeApi: true
    },
    note: 'La copertura CLV misura evidenza verificata e disponibilità separatamente. Una sport key risolta abilita soltanto il routing provider e non crea una closing odd.'
  };
}
function selectRows(db) {
  return db.prepare(`
    SELECT ${require('./audit07sR4ReadColumns').columns(db)} FROM ai_forward_test
    WHERE UPPER(COALESCE(status,'')) IN ('PENDING','WON','LOST')
      AND UPPER(COALESCE(bet_type,'')) NOT LIKE 'MULTI%'
      AND UPPER(COALESCE(data_quality,'')) NOT IN ('LEGACY_DIRTY','DIRTY','OLD_METRICS')
    ORDER BY id
  `).all();
}
function buildCoverageReport(db, leaguesConfig = {}, options = {}) {
  if (!db || typeof db.prepare !== 'function') return buildCoverageReportFromRows([], leaguesConfig, options);
  return buildCoverageReportFromRows(selectRows(db), leaguesConfig, options);
}
function tableColumns(db) {
  return new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
}
function addColumn(db, name, type) {
  const columns = tableColumns(db);
  if (!columns.has(name)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
}
function createSchema(db) {
  addColumn(db, 'clv_cross_sport_resolution_version', 'TEXT');
  addColumn(db, 'clv_cross_sport_sport', 'TEXT');
  addColumn(db, 'clv_cross_sport_sport_key', 'TEXT');
  addColumn(db, 'clv_cross_sport_resolution_status', 'TEXT');
  addColumn(db, 'clv_cross_sport_resolution_source', 'TEXT');
  addColumn(db, 'clv_cross_sport_resolution_confidence', 'REAL');
  addColumn(db, 'clv_cross_sport_resolution_reason', 'TEXT');
  addColumn(db, 'clv_cross_sport_resolved_at', 'TEXT');
  return { version: COVERAGE_SCHEMA_VERSION, columnsPresent: true };
}
function persistenceFields(resolution = {}, resolvedAt = new Date().toISOString()) {
  return {
    clv_cross_sport_resolution_version: SPORT_KEY_RESOLUTION_VERSION,
    clv_cross_sport_sport: resolution.sport || null,
    clv_cross_sport_sport_key: resolution.sportKey || null,
    clv_cross_sport_resolution_status: resolution.status || 'UNKNOWN',
    clv_cross_sport_resolution_source: resolution.source || 'NONE',
    clv_cross_sport_resolution_confidence: number(resolution.confidence, 0),
    clv_cross_sport_resolution_reason: resolution.reason || null,
    clv_cross_sport_resolved_at: resolvedAt
  };
}
function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(number(a, 0) - number(b, 0)) < 1e-9;
  return text(a) === text(b);
}
function backfillResolutionMetadata(db, leaguesConfig = {}, options = {}) {
  createSchema(db);
  const rows = selectRows(db);
  const inferTennisKey = options.inferTennisKey;
  const now = options.resolvedAt || new Date().toISOString();
  const update = db.prepare(`UPDATE ai_forward_test SET
    clv_cross_sport_resolution_version=?,
    clv_cross_sport_sport=?,
    clv_cross_sport_sport_key=?,
    clv_cross_sport_resolution_status=?,
    clv_cross_sport_resolution_source=?,
    clv_cross_sport_resolution_confidence=?,
    clv_cross_sport_resolution_reason=?,
    clv_cross_sport_resolved_at=?
    WHERE id=?`);
  let changed = 0;
  let unchanged = 0;
  let resolved = 0;
  let unresolved = 0;
  const bySport = { TENNIS: { resolved: 0, unresolved: 0 }, CALCIO: { resolved: 0, unresolved: 0 } };

  const transaction = db.transaction ? db.transaction.bind(db) : null;
  const work = () => {
    for (const row of rows) {
      const resolution = resolveSportKeyForBet(row, leaguesConfig, { inferTennisKey });
      const fields = persistenceFields(resolution, now);
      const keys = Object.keys(fields);
      const semanticKeys = keys.filter(key => key !== 'clv_cross_sport_resolved_at');
      const isSame = semanticKeys.every(key => sameValue(row[key], fields[key]));
      if (isSame) {
        unchanged += 1;
      } else {
        update.run(...keys.map(key => fields[key]), Number(row.id));
        changed += 1;
      }
      if (resolution.resolved) {
        resolved += 1;
        bySport[resolution.sport].resolved += 1;
      } else {
        unresolved += 1;
        bySport[resolution.sport].unresolved += 1;
      }
    }
  };
  if (transaction) transaction(work)(); else work();
  return {
    success: true,
    version: SPORT_KEY_RESOLUTION_VERSION,
    scanned: rows.length,
    changed,
    unchanged,
    resolved,
    unresolved,
    bySport,
    businessValuesChanged: false
  };
}
function persistedSummary(db) {
  createSchema(db);
  const rows = db.prepare(`SELECT
      COALESCE(clv_cross_sport_sport,'UNKNOWN') sport,
      COALESCE(clv_cross_sport_resolution_status,'UNSET') resolutionStatus,
      COUNT(*) count
    FROM ai_forward_test
    WHERE clv_cross_sport_resolution_version=?
    GROUP BY COALESCE(clv_cross_sport_sport,'UNKNOWN'), COALESCE(clv_cross_sport_resolution_status,'UNSET')
    ORDER BY sport,resolutionStatus`).all(SPORT_KEY_RESOLUTION_VERSION);
  return { version: SPORT_KEY_RESOLUTION_VERSION, rows };
}
function health(db = null, leaguesConfig = {}, options = {}) {
  const base = {
    success: true,
    version: VERSION,
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    sportKeyResolutionVersion: SPORT_KEY_RESOLUTION_VERSION,
    defaultFootballKeys: Object.values(DEFAULT_FOOTBALL_LEAGUES).map(row => row.api),
    authority: 'READ_ONLY_COVERAGE_AND_PROVIDER_ROUTING_METADATA',
    noSyntheticClosingOdds: true,
    probabilityAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false
  };
  if (!db) return base;
  return { ...base, coverage: buildCoverageReport(db, leaguesConfig, options), persisted: persistedSummary(db) };
}

module.exports = {
  VERSION,
  SPORT_KEY_RESOLUTION_VERSION,
  COVERAGE_SCHEMA_VERSION,
  DEFAULT_FOOTBALL_LEAGUES,
  detectSport,
  isCleanRow,
  isEligibleClvRow,
  getExplicitSportKey,
  resolveFootballSportKey,
  inferTennisKeyFromRow,
  resolveTennisSportKey,
  resolveSportKeyForBet,
  classifyClvEvidence,
  buildCoverageReportFromRows,
  buildCoverageReport,
  createSchema,
  persistenceFields,
  backfillResolutionMetadata,
  persistedSummary,
  health
};
