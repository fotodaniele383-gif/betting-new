'use strict';

const crypto = require('crypto');
const footballDataProvider = require('./calcioFootballDataProvider');

const VERSION = 'AUDIT13_CERTIFIED_TRADING_OUTCOME_SEARCH_V1';
const POLICY_VERSION = 'AUDIT13_RESULT_SEARCH_CERTIFICATION_POLICY_V1';
const RECENT_PROVIDER_WINDOW_DAYS = 3;
const FOOTBALL_SOURCE = 'FOOTBALL_DATA_ARCHIVE_AUDIT13';

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
}
function stripAccents(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normalizeTeam(value) {
  let raw = stripAccents(value).toLowerCase();
  raw = raw
    .replace(/\bnott'?m\b/g, 'nottingham')
    .replace(/\bmanchester\s+united\b/g, 'man united')
    .replace(/\bmanchester\s+city\b/g, 'man city')
    .replace(/\batletico\s+madrid\b/g, 'ath madrid')
    .replace(/\breal\s+sociedad\b/g, 'sociedad')
    .replace(/\bdeportivo\s+la\s+coruna\b/g, 'la coruna')
    .replace(/\bparis\s+saint[-\s]?germain\b/g, 'paris sg')
    .replace(/\bbayern\s+munchen\b/g, 'bayern munich')
    .replace(/\bborussia\s+monchengladbach\b/g, 'mgladbach')
    .replace(/\b1\.?\s*fc\s+koln\b/g, 'fc koln')
    .replace(/\ble\s+mans\s+fc\b/g, 'le mans');
  return raw.replace(/[^a-z0-9]+/g, ' ').replace(/\b(fc|cf|ac|ssc|afc|club|calcio)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function compactTeam(value) { return normalizeTeam(value).replace(/\s+/g, ''); }

function parseEventInstant(value, now = new Date()) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  const raw = text(value);
  if (!raw) return null;

  const iso = new Date(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && !Number.isNaN(iso.getTime())) return iso;

  let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const date = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 12), Number(m[5] || 0), Number(m[6] || 0)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  m = raw.match(/^(\d{1,2})\/(\d{1,2})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const current = now instanceof Date ? now : new Date(now);
    const year = Number.isNaN(current.getTime()) ? new Date().getUTCFullYear() : current.getUTCFullYear();
    const candidates = [year - 1, year, year + 1].map(y => new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]), Number(m[3] || 12), Number(m[4] || 0), Number(m[5] || 0))))
      .filter(d => !Number.isNaN(d.getTime()));
    candidates.sort((a, b) => Math.abs(a.getTime() - current.getTime()) - Math.abs(b.getTime() - current.getTime()));
    return candidates[0] || null;
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function daysSinceEvent(value, now = new Date()) {
  const event = parseEventInstant(value, now);
  const current = now instanceof Date ? now : new Date(now);
  if (!event || Number.isNaN(current.getTime())) return null;
  return (current.getTime() - event.getTime()) / 86400000;
}

function buildSearchPlan(row = {}, sport = '', options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const windowDays = Math.max(1, Math.min(3, Number(options.recentProviderWindowDays || RECENT_PROVIDER_WINDOW_DAYS)));
  const ageDays = daysSinceEvent(row.canonical_match_datetime || row.match_date, now);
  const normalizedSport = upper(sport || row.sport_type);
  const unknownTime = ageDays === null;
  const future = ageDays !== null && ageDays < -0.05;
  const recent = ageDays !== null && ageDays >= -0.05 && ageDays <= windowDays;
  const archive = ageDays !== null && ageDays > windowDays;
  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    sport: normalizedSport,
    ageDays: ageDays === null ? null : Number(ageDays.toFixed(3)),
    eventTimeKnown: !unknownTime,
    future,
    recentProviderEligible: recent,
    archiveRecoveryRequired: archive,
    route: future ? 'FUTURE_NOT_SETTLEABLE' : recent ? 'RECENT_PROVIDER_WINDOW' : archive ? 'CERTIFIED_ARCHIVE_RECOVERY' : 'UNKNOWN_TIME_FAIL_CLOSED',
    providerWindowDays: windowDays
  };
}

const LEAGUE_CODE_RULES = Object.freeze([
  ['I1', /\bserie\s*a\b/i],
  ['I2', /\bserie\s*b\b/i],
  ['E0', /\bpremier(?:\s+league)?\b/i],
  ['SP1', /\bla\s*liga\b|\bspain\b/i],
  ['F1', /\bligue\s*1\b/i],
  ['D1', /\bbundesliga\b/i]
]);

function getFootballDataLeagueCode(row = {}) {
  const hay = [row.league, row.league_name, row.competition, row.calcio_league_key].map(text).join(' ');
  for (const [code, pattern] of LEAGUE_CODE_RULES) if (pattern.test(hay)) return code;
  return '';
}

function csvRowsFromSnapshot(snapshot) {
  if (!snapshot?.valid || !snapshot.csvData) return [];
  const splitCsvLine = footballDataProvider._private?.splitCsvLine;
  if (typeof splitCsvLine !== 'function') return [];
  const lines = String(snapshot.csvData).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(text);
  const idx = Object.fromEntries(headers.map((name, index) => [name, index]));
  if (['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG'].some(name => idx[name] == null)) return [];
  return lines.slice(1).map(line => {
    const cols = splitCsvLine(line);
    const date = footballDataProvider.parseFootballDataDate(cols[idx.Date]);
    const hgRaw = text(cols[idx.FTHG]);
    const agRaw = text(cols[idx.FTAG]);
    const homeGoals = hgRaw === '' ? null : Number(hgRaw);
    const awayGoals = agRaw === '' ? null : Number(agRaw);
    if (!date || !text(cols[idx.HomeTeam]) || !text(cols[idx.AwayTeam]) || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
    return {
      dateKey: date.toISOString().slice(0, 10),
      homeTeam: text(cols[idx.HomeTeam]),
      awayTeam: text(cols[idx.AwayTeam]),
      homeGoals,
      awayGoals,
      fullTimeResult: text(cols[idx.FTR] || ''),
      rowHash: sha256(line)
    };
  }).filter(Boolean);
}

function footballRowDateKey(row, now = new Date()) {
  const d = parseEventInstant(row.canonical_match_datetime || row.match_date, now);
  return d ? d.toISOString().slice(0, 10) : '';
}

function resolveFootballFromLocalArchive(row = {}, options = {}) {
  const code = getFootballDataLeagueCode(row);
  if (!code) return null;
  const snapshot = (options.readLocalLeagueSnapshot || footballDataProvider.readLocalLeagueSnapshot)({ code, cacheDir: options.cacheDir });
  if (!snapshot?.valid) return null;
  const targetDate = footballRowDateKey(row, options.now || new Date());
  if (!targetDate) return null;
  const home = compactTeam(row.home_team);
  const away = compactTeam(row.away_team);
  if (!home || !away) return null;
  const candidates = csvRowsFromSnapshot(snapshot).filter(item => item.dateKey === targetDate && compactTeam(item.homeTeam) === home && compactTeam(item.awayTeam) === away);
  if (candidates.length !== 1) return null;
  const match = candidates[0];
  const winnerSide = match.homeGoals > match.awayGoals ? 1 : match.homeGoals < match.awayGoals ? 2 : 0;
  const sourceEventId = `FD:${code}:${targetDate}:${sha256({ home, away }).slice(0, 16)}`;
  const rawEvidence = {
    version: VERSION,
    providerVersion: footballDataProvider.CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
    source: FOOTBALL_SOURCE,
    code,
    targetDate,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeGoals: match.homeGoals,
    awayGoals: match.awayGoals,
    snapshotSha256: snapshot.inspection?.sha256 || snapshot.metadata?.sha256 || null,
    snapshotFetchedAt: snapshot.metadata?.fetchedAt || null,
    snapshotSeason: snapshot.metadata?.season || null,
    snapshotUrl: snapshot.metadata?.url || null,
    rowHash: match.rowHash
  };
  return {
    homeGoals: match.homeGoals,
    awayGoals: match.awayGoals,
    totalGoals: match.homeGoals + match.awayGoals,
    winnerSide,
    source: FOOTBALL_SOURCE,
    sourceTier: 'CERTIFIED_ARCHIVE',
    sourceEventId,
    observedAt: snapshot.metadata?.fetchedAt || new Date().toISOString(),
    rawEvidence,
    evidenceHash: sha256(rawEvidence),
    providerCompleted: true,
    confidence: 0.995,
    matchMethod: 'DATE_HOME_AWAY_EXACT_NORMALIZED',
    note: `AUDIT13: risultato recuperato dal CSV football-data ${code}, snapshot SHA-256 ${text(rawEvidence.snapshotSha256).slice(0, 12)}.`
  };
}

function candidateProviderEventId(candidate = {}) {
  return text(candidate.id || candidate.event_id || candidate.eventId || candidate.provider_event_id || candidate.providerEventId);
}
function rowProviderEventId(row = {}, sport = '') {
  const s = upper(sport || row.sport_type);
  return text(s === 'CALCIO' ? (row.calcio_provider_event_id || row.provider_event_id) : (row.provider_event_id || row.tennis_provider_event_id));
}
function exactProviderIdMatch(row = {}, candidate = {}, sport = '') {
  const expected = rowProviderEventId(row, sport);
  const actual = candidateProviderEventId(candidate);
  return Boolean(expected && actual && expected === actual);
}

function eventFingerprint(row = {}, sport = '') {
  const s = upper(sport || row.sport_type);
  const existing = s === 'TENNIS' ? row.tennis_event_fingerprint : row.calcio_event_key;
  return text(existing) || sha256({ sport: s, home: normalizeTeam(row.home_team), away: normalizeTeam(row.away_team), date: footballRowDateKey(row) });
}
function marketFingerprint(row = {}, sport = '') {
  const s = upper(sport || row.sport_type);
  const existing = s === 'TENNIS' ? row.tennis_market_fingerprint : row.calcio_market_fingerprint;
  return text(existing) || sha256({ eventFingerprint: eventFingerprint(row, s), prediction: text(row.prediction), odd: Number(row.odd) || null, market: text(row.market_type || row.bet_type) });
}

function buildSettlementProof(row = {}, resolution = {}, sport = 'CALCIO', operationId = null) {
  const sourceEventId = text(resolution.sourceEventId || rowProviderEventId(row, sport));
  const observedAt = text(resolution.observedAt || new Date().toISOString());
  const sourceTier = text(resolution.sourceTier || (upper(resolution.source).includes('ODDS_API') ? 'PROVIDER' : 'CERTIFIED_ARCHIVE'));
  const rawEvidence = resolution.rawEvidence || {
    source: resolution.source,
    sourceEventId,
    observedAt,
    homeGoals: resolution.homeGoals,
    awayGoals: resolution.awayGoals,
    providerCompleted: resolution.providerCompleted === true
  };
  const evidenceHash = text(resolution.evidenceHash) || sha256(rawEvidence);
  return {
    settlement_source_tier: sourceTier || 'UNKNOWN',
    settlement_source_event_id: sourceEventId || null,
    settlement_observed_at: observedAt,
    settlement_evidence_hash: evidenceHash,
    settlement_event_fingerprint: eventFingerprint(row, sport),
    settlement_market_fingerprint: marketFingerprint(row, sport),
    settlement_operation_id: text(operationId || resolution.operationId) || `AUDIT13_${Date.now()}`
  };
}

function isReusableCertifiedTennisCache(cache = {}) {
  if (!cache || typeof cache !== 'object') return false;
  const source = upper(cache.source);
  const official = source.includes('ATP_OFFICIAL') || source.includes('WTA_OFFICIAL') || source.includes('PATCH34_R4');
  return Boolean(official && cache.providerCompleted === true && text(cache.sourceEventId || cache.source_event_id) && text(cache.evidenceHash || cache.settlement_evidence_hash));
}

module.exports = {
  VERSION,
  POLICY_VERSION,
  RECENT_PROVIDER_WINDOW_DAYS,
  FOOTBALL_SOURCE,
  normalizeTeam,
  compactTeam,
  parseEventInstant,
  daysSinceEvent,
  buildSearchPlan,
  getFootballDataLeagueCode,
  resolveFootballFromLocalArchive,
  candidateProviderEventId,
  rowProviderEventId,
  exactProviderIdMatch,
  eventFingerprint,
  marketFingerprint,
  buildSettlementProof,
  isReusableCertifiedTennisCache,
  sha256
};
