'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION = 'AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_V2_FIXTURE_AGGREGATE';
const AUDIT16D_R3_R2_R1_AUTH_REVISION = 'AUDIT16D_R3_R2_R1_RAW_AUTHORIZATION_HEADER_V1';
const SPORTMONKS_AUTH_MODE = 'RAW_AUTHORIZATION_HEADER';
const SPORTMONKS_HOST = 'api.sportmonks.com';
const XG_TYPE = 5304;
const DEFAULT_TIMEOUT_MS = 5500;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MIN_VALID_TEAMS = 8;
const MIN_FIXTURES_PER_TEAM = 1;
const MAX_RANGE_DAYS = 95; // API limit is 100 days; keep headroom.
const MAX_PAGES_PER_RANGE = 8;
const CIRCUIT_FAILURE_THRESHOLD = 2;
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000;

const circuitState = new Map();

const LEAGUE_SPECS = Object.freeze({
  'Serie A': { query: 'Serie A', country: 'Italy' },
  'Serie B': { query: 'Serie B', country: 'Italy' },
  'Premier': { query: 'Premier League', country: 'England' },
  'Premier League': { query: 'Premier League', country: 'England' },
  'La Liga': { query: 'La Liga', country: 'Spain' },
  'Ligue 1': { query: 'Ligue 1', country: 'France' },
  'Bundesliga': { query: 'Bundesliga', country: 'Germany' }
});

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round(value, decimals = 3) {
  const n = safeNumber(value, null);
  if (n === null) return null;
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}
function normalize(value = '') {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function slug(value = '') { return normalize(value).replace(/\s+/g, '_') || 'unknown'; }
function cacheDir(options = {}) { return options.cacheDir || path.join(__dirname, 'data', 'calcio_xg_sportmonks_lkg'); }
function cacheFile(leagueName, options = {}) { return path.join(cacheDir(options), `${slug(leagueName)}.json`); }
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }
function extractCountryName(item = {}) { return item?.country?.name || item?.country_name || item?.country || null; }
function extractCurrentSeason(item = {}) { return item?.currentseason || item?.currentSeason || item?.current_season || item?.season || null; }
function toIsoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}
function seasonStartDate(season = {}, now = new Date()) {
  const explicit = toIsoDate(season?.starting_at || season?.startingAt || season?.start_date || season?.startDate);
  if (explicit) return explicit;
  const year = seasonStartFromSeason(season);
  if (Number.isFinite(year)) return `${year}-07-01`;
  const current = now instanceof Date ? now : new Date(now);
  const y = current.getUTCMonth() >= 6 ? current.getUTCFullYear() : current.getUTCFullYear() - 1;
  return `${y}-07-01`;
}
function buildDateRanges(start, end, maxDays = MAX_RANGE_DAYS) {
  const out = [];
  let cursor = start;
  while (cursor && cursor <= end) {
    const tentative = addDays(cursor, maxDays - 1);
    const rangeEnd = tentative && tentative < end ? tentative : end;
    out.push({ start: cursor, end: rangeEnd });
    if (rangeEnd >= end) break;
    cursor = addDays(rangeEnd, 1);
  }
  return out;
}
function sanitizeError(error) {
  const code = String(error?.code || error?.message || 'SPORTMONKS_UNKNOWN_ERROR');
  return code.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]').replace(/api_token=[^&\s]+/gi, 'api_token=[REDACTED]').slice(0, 220);
}

function requestJson(url, options = {}) {
  if (typeof options.requestJson === 'function') return options.requestJson(url, options);
  const token = String(options.token || process.env.SPORTMONKS_API_TOKEN || '').trim();
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (_) { return reject(Object.assign(new Error('SPORTMONKS_URL_INVALID'), { code: 'SPORTMONKS_URL_INVALID', structural: true })); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== SPORTMONKS_HOST || parsed.username || parsed.password || parsed.port) {
      return reject(Object.assign(new Error('SPORTMONKS_HOST_NOT_ALLOWED'), { code: 'SPORTMONKS_HOST_NOT_ALLOWED', structural: true }));
    }
    const req = https.request({
      protocol: 'https:', hostname: SPORTMONKS_HOST, path: parsed.pathname + parsed.search, method: 'GET',
      headers: { Accept: 'application/json', Authorization: token, 'User-Agent': 'BettingApp-AUDIT16D-R3-R2-R1/2.1' },
      timeout: safeNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS)
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        return reject(Object.assign(new Error('SPORTMONKS_REDIRECT_BLOCKED'), { code: 'SPORTMONKS_REDIRECT_BLOCKED', statusCode: res.statusCode, structural: true }));
      }
      let bytes = 0; const chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(Object.assign(new Error('SPORTMONKS_RESPONSE_TOO_LARGE'), { code: 'SPORTMONKS_RESPONSE_TOO_LARGE', structural: true }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(Object.assign(new Error(`SPORTMONKS_HTTP_${res.statusCode}`), { code: `SPORTMONKS_HTTP_${res.statusCode}`, statusCode: res.statusCode, transient: res.statusCode >= 500 || res.statusCode === 429 }));
        }
        try { resolve(JSON.parse(body)); }
        catch (_) { reject(Object.assign(new Error('SPORTMONKS_JSON_INVALID'), { code: 'SPORTMONKS_JSON_INVALID', structural: true })); }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('SPORTMONKS_NETWORK_TIMEOUT'), { code: 'SPORTMONKS_NETWORK_TIMEOUT', transient: true })));
    req.on('error', reject);
    req.end();
  });
}

function scoreLeagueCandidate(item = {}, spec = {}) {
  const name = normalize(item.name); const q = normalize(spec.query);
  const country = normalize(extractCountryName(item)); const expectedCountry = normalize(spec.country);
  let score = 0;
  if (name === q) score += 100; else if (name.includes(q) || q.includes(name)) score += 40;
  if (country && expectedCountry && country === expectedCountry) score += 30;
  if (item.active === true || Number(item.active) === 1) score += 5;
  if (extractCurrentSeason(item)) score += 15;
  return score;
}
async function resolveLeague(leagueName, options = {}) {
  const spec = LEAGUE_SPECS[leagueName];
  if (!spec) throw Object.assign(new Error(`SPORTMONKS_UNSUPPORTED_LEAGUE:${leagueName}`), { code: 'SPORTMONKS_UNSUPPORTED_LEAGUE', structural: true });
  const url = `https://${SPORTMONKS_HOST}/v3/football/leagues/search/${encodeURIComponent(spec.query)}?include=currentSeason;country&per_page=50`;
  const payload = await requestJson(url, options);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const ranked = rows.map(item => ({ item, score: scoreLeagueCandidate(item, spec) })).sort((a,b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 100) throw Object.assign(new Error(`SPORTMONKS_LEAGUE_NOT_CERTIFIED:${leagueName}`), { code: 'SPORTMONKS_LEAGUE_NOT_CERTIFIED', structural: true });
  const season = extractCurrentSeason(best.item);
  if (!season?.id) throw Object.assign(new Error(`SPORTMONKS_CURRENT_SEASON_MISSING:${leagueName}`), { code: 'SPORTMONKS_CURRENT_SEASON_MISSING', structural: true });
  return { league: best.item, season, spec, confidenceScore: best.score };
}

function getFixtureParticipants(fixture = {}) {
  const rows = Array.isArray(fixture?.participants) ? fixture.participants : Array.isArray(fixture?.participant) ? fixture.participant : [];
  return rows.map(p => ({ id: Number(p?.id), name: String(p?.name || '').trim() })).filter(p => Number.isFinite(p.id) && p.name);
}
function getFixtureXgRows(fixture = {}) {
  const candidates = [fixture?.xgfixture, fixture?.xGFixture, fixture?.xgFixture, fixture?.xg_fixture, fixture?.expected, fixture?.expectedGoals];
  const rows = candidates.find(Array.isArray) || [];
  return rows.filter(row => Number(row?.type_id ?? row?.typeId) === XG_TYPE);
}
function extractXgValue(row = {}) {
  return safeNumber(row?.data?.value ?? row?.value ?? row?.data?.expected, null);
}
function aggregateFixtureXg(fixtures = [], seasonId = null) {
  const totals = new Map();
  let fixturesAccepted = 0;
  let fixtureRowsSeen = 0;
  for (const fixture of fixtures) {
    if (seasonId !== null && seasonId !== undefined && Number(fixture?.season_id ?? fixture?.seasonId) !== Number(seasonId)) continue;
    const participants = getFixtureParticipants(fixture);
    if (participants.length !== 2) continue;
    const xgRows = getFixtureXgRows(fixture);
    fixtureRowsSeen += xgRows.length;
    const byParticipant = new Map();
    for (const row of xgRows) {
      const pid = Number(row?.participant_id ?? row?.participantId);
      const value = extractXgValue(row);
      if (!Number.isFinite(pid) || !(Number.isFinite(value) && value >= 0 && value < 12)) continue;
      if (!byParticipant.has(pid)) byParticipant.set(pid, value);
    }
    const a = participants[0]; const b = participants[1];
    if (!byParticipant.has(a.id) || !byParticipant.has(b.id)) continue;
    const axg = byParticipant.get(a.id); const bxg = byParticipant.get(b.id);
    for (const [team, own, opp] of [[a, axg, bxg], [b, bxg, axg]]) {
      const current = totals.get(team.id) || { id: team.id, name: team.name, xgForTotal: 0, xgAgainstTotal: 0, games: 0 };
      current.xgForTotal += own;
      current.xgAgainstTotal += opp;
      current.games += 1;
      if (!current.name && team.name) current.name = team.name;
      totals.set(team.id, current);
    }
    fixturesAccepted += 1;
  }
  const teams = {};
  for (const row of totals.values()) {
    if (!row.name || row.games < MIN_FIXTURES_PER_TEAM) continue;
    const xgFor = row.xgForTotal / row.games;
    const xgAgainst = row.xgAgainstTotal / row.games;
    if (!(Number.isFinite(xgFor) && xgFor >= 0 && xgFor < 6 && Number.isFinite(xgAgainst) && xgAgainst >= 0 && xgAgainst < 6)) continue;
    teams[row.name] = {
      xG_for: round(xgFor), xG_against: round(xgAgainst), games: row.games,
      source: 'SPORTMONKS_FIXTURE_XG_AGGREGATE', sportmonksTeamId: row.id, seasonId: seasonId === null ? null : Number(seasonId)
    };
  }
  return { teams, fixturesAccepted, fixtureRowsSeen, fixtureCount: fixtures.length };
}

async function fetchFixturePage(url, options = {}) {
  const payload = await requestJson(url, options);
  return {
    rows: Array.isArray(payload?.data) ? payload.data : [],
    hasMore: Boolean(payload?.pagination?.has_more ?? payload?.pagination?.hasMore ?? payload?.meta?.pagination?.has_more ?? payload?.meta?.pagination?.hasMore)
  };
}
async function fetchSeasonFixtures(resolved, options = {}) {
  const nowDate = toIsoDate(options.now || new Date());
  const startDate = seasonStartDate(resolved.season, options.now || new Date());
  if (!startDate || !nowDate || startDate > nowDate) throw Object.assign(new Error('SPORTMONKS_SEASON_DATE_RANGE_INVALID'), { code: 'SPORTMONKS_SEASON_DATE_RANGE_INVALID', structural: true });
  const ranges = buildDateRanges(startDate, nowDate);
  const fixtures = [];
  let apiCalls = 0;
  for (const range of ranges) {
    for (let page = 1; page <= MAX_PAGES_PER_RANGE; page++) {
      const filter = `fixtureLeagues:${Number(resolved.league.id)}`;
      const url = `https://${SPORTMONKS_HOST}/v3/football/fixtures/between/${range.start}/${range.end}?include=participants;xGFixture&filters=${encodeURIComponent(filter)}&per_page=50&page=${page}`;
      const result = await fetchFixturePage(url, options); apiCalls += 1;
      fixtures.push(...result.rows);
      if (!result.hasMore || result.rows.length === 0) break;
      if (page === MAX_PAGES_PER_RANGE) throw Object.assign(new Error('SPORTMONKS_FIXTURE_PAGINATION_LIMIT'), { code: 'SPORTMONKS_FIXTURE_PAGINATION_LIMIT', structural: true });
    }
  }
  return { fixtures, apiCalls, ranges };
}
async function fetchSeasonTeams(leagueName, resolvedOrSeasonId, options = {}) {
  // Compatibility: tests/callers can provide a fully resolved object. A bare season id is deliberately rejected
  // because fixture aggregation also requires a certified league id.
  const resolved = resolvedOrSeasonId && typeof resolvedOrSeasonId === 'object' ? resolvedOrSeasonId : null;
  if (!resolved?.league?.id || !resolved?.season?.id) throw Object.assign(new Error('SPORTMONKS_RESOLVED_LEAGUE_REQUIRED'), { code: 'SPORTMONKS_RESOLVED_LEAGUE_REQUIRED', structural: true });
  const fetched = await fetchSeasonFixtures(resolved, options);
  const aggregated = aggregateFixtureXg(fetched.fixtures, resolved.season.id);
  if (Object.keys(aggregated.teams).length < MIN_VALID_TEAMS) {
    throw Object.assign(new Error(`SPORTMONKS_INSUFFICIENT_VALID_TEAMS:${leagueName}:${Object.keys(aggregated.teams).length}`), { code: 'SPORTMONKS_INSUFFICIENT_VALID_TEAMS', structural: true });
  }
  return { ...aggregated, apiCalls: fetched.apiCalls, ranges: fetched.ranges };
}

function seasonStartFromSeason(season = {}) {
  const fromDate = String(season?.starting_at || season?.startingAt || '').match(/^(\d{4})/);
  if (fromDate) return Number(fromDate[1]);
  const fromName = String(season?.name || '').match(/(20\d{2})/);
  return fromName ? Number(fromName[1]) : null;
}
function validateLkg(value, leagueName) {
  if (!value || value.version !== AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION) return null;
  if (value.leagueName !== leagueName || !value.teams || typeof value.teams !== 'object') return null;
  if (Object.keys(value.teams).length < MIN_VALID_TEAMS) return null;
  return value;
}
function loadLkg(leagueName, options = {}) { return validateLkg(readJson(cacheFile(leagueName, options)), leagueName); }
function lkgResult(lkg, reason, status = 'READY_LKG') {
  return { teams: lkg.teams, state: {
    version: AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION,
    providerId: 'SPORTMONKS', providerFamily: 'SPORTMONKS_XG', status, sourceClass: 'LKG_CERTIFIED',
    leagueName: lkg.leagueName, leagueId: lkg.leagueId, seasonId: lkg.seasonId, seasonName: lkg.seasonName,
    seasonStart: lkg.seasonStart, fetchedAt: lkg.fetchedAt, checkedAt: new Date().toISOString(),
    teamCount: Object.keys(lkg.teams).length, tokenConfigured: false, lkg: true, error: reason || null,
    fixtureCount: lkg.fixtureCount || null, fixturesAccepted: lkg.fixturesAccepted || null,
    directStakeAuthority: false, directGateAuthority: false
  }};
}
function circuitKey(leagueName) { return normalize(leagueName); }
function getCircuit(leagueName) { return circuitState.get(circuitKey(leagueName)) || { failures: 0, openUntil: 0, lastError: null }; }
function recordSuccess(leagueName) { circuitState.set(circuitKey(leagueName), { failures: 0, openUntil: 0, lastError: null }); }
function recordFailure(leagueName, error, nowMs = Date.now()) {
  const old = getCircuit(leagueName); const failures = old.failures + 1;
  circuitState.set(circuitKey(leagueName), { failures, openUntil: failures >= CIRCUIT_FAILURE_THRESHOLD ? nowMs + CIRCUIT_COOLDOWN_MS : 0, lastError: sanitizeError(error) });
}
function resetCircuit() { circuitState.clear(); }

async function getSportmonksLeagueXg(leagueName, options = {}) {
  const started = Date.now(); const nowMs = safeNumber(options.nowMs, Date.now());
  const token = String(options.token || process.env.SPORTMONKS_API_TOKEN || '').trim();
  const lkg = loadLkg(leagueName, options);
  if (!token) {
    if (lkg) return { ...lkgResult(lkg, 'SPORTMONKS_TOKEN_NOT_CONFIGURED'), durationMs: Date.now() - started };
    return { teams: {}, state: { version: AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION, providerId: 'SPORTMONKS', providerFamily: 'SPORTMONKS_XG', status: 'DISABLED_NO_TOKEN', sourceClass: 'NONE', leagueName, checkedAt: new Date().toISOString(), teamCount: 0, tokenConfigured: false, tokenExposed: false, lkg: false, directStakeAuthority: false, directGateAuthority: false }, durationMs: Date.now() - started };
  }
  const circuit = getCircuit(leagueName);
  if (circuit.openUntil > nowMs) {
    if (lkg) return { ...lkgResult(lkg, 'SPORTMONKS_CIRCUIT_OPEN', 'CIRCUIT_OPEN_LKG'), durationMs: Date.now() - started };
    return { teams: {}, state: { version: AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION, providerId: 'SPORTMONKS', providerFamily: 'SPORTMONKS_XG', status: 'CIRCUIT_OPEN', sourceClass: 'NONE', leagueName, checkedAt: new Date().toISOString(), teamCount: 0, tokenConfigured: true, tokenExposed: false, lkg: false, error: circuit.lastError || 'SPORTMONKS_CIRCUIT_OPEN', circuitOpenUntil: new Date(circuit.openUntil).toISOString(), directStakeAuthority: false, directGateAuthority: false }, durationMs: Date.now() - started };
  }
  try {
    const resolved = await resolveLeague(leagueName, { ...options, token });
    const seasonData = await fetchSeasonTeams(leagueName, resolved, { ...options, token });
    const teams = seasonData.teams;
    const snapshot = {
      version: AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION,
      providerId: 'SPORTMONKS', aggregation: 'FIXTURE_XG_BOTH_TEAMS', leagueName, leagueId: resolved.league.id, seasonId: resolved.season.id,
      seasonName: resolved.season.name || null, seasonStart: seasonStartFromSeason(resolved.season), fetchedAt: new Date().toISOString(),
      fixtureCount: seasonData.fixtureCount, fixturesAccepted: seasonData.fixturesAccepted, apiCalls: seasonData.apiCalls, teams
    };
    if (options.writeCache !== false) atomicWriteJson(cacheFile(leagueName, options), snapshot);
    recordSuccess(leagueName);
    return { teams, state: {
      version: AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION, providerId: 'SPORTMONKS', providerFamily: 'SPORTMONKS_XG',
      status: 'READY_LIVE', sourceClass: 'LIVE_CERTIFIED', leagueName, leagueId: snapshot.leagueId, seasonId: snapshot.seasonId,
      seasonName: snapshot.seasonName, seasonStart: snapshot.seasonStart, fetchedAt: snapshot.fetchedAt, checkedAt: snapshot.fetchedAt,
      teamCount: Object.keys(teams).length, fixtureCount: snapshot.fixtureCount, fixturesAccepted: snapshot.fixturesAccepted, apiCalls: snapshot.apiCalls,
      aggregation: snapshot.aggregation, tokenConfigured: true, tokenExposed: false, lkg: false,
      directStakeAuthority: false, directGateAuthority: false
    }, durationMs: Date.now() - started };
  } catch (error) {
    const code = sanitizeError(error); recordFailure(leagueName, error, nowMs);
    if (lkg) return { ...lkgResult(lkg, code), durationMs: Date.now() - started };
    return { teams: {}, state: {
      version: AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION, providerId: 'SPORTMONKS', providerFamily: 'SPORTMONKS_XG', status: 'UNAVAILABLE', sourceClass: 'NONE',
      leagueName, checkedAt: new Date().toISOString(), teamCount: 0, tokenConfigured: true, tokenExposed: false, lkg: false, error: code,
      directStakeAuthority: false, directGateAuthority: false
    }, durationMs: Date.now() - started, error: code };
  }
}
function getProviderHealth(options = {}) {
  const token = String(options.token || process.env.SPORTMONKS_API_TOKEN || '').trim();
  return {
    version: AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION,
    providerId: 'SPORTMONKS', host: SPORTMONKS_HOST, tokenConfigured: Boolean(token), tokenExposed: false,
    patchRevision: AUDIT16D_R3_R2_R1_AUTH_REVISION, authMode: SPORTMONKS_AUTH_MODE,
    aggregation: 'FIXTURE_XG_BOTH_TEAMS', cacheDir: cacheDir(options), supportedLeagues: Object.keys(LEAGUE_SPECS),
    types: { xG: XG_TYPE }, maxRangeDays: MAX_RANGE_DAYS, minValidTeams: MIN_VALID_TEAMS,
    circuitBreaker: { failureThreshold: CIRCUIT_FAILURE_THRESHOLD, cooldownMs: CIRCUIT_COOLDOWN_MS },
    directStakeAuthority: false, directGateAuthority: false
  };
}

module.exports = {
  AUDIT16D_R3_R2_SPORTMONKS_XG_PROVIDER_VERSION, AUDIT16D_R3_R2_R1_AUTH_REVISION, SPORTMONKS_AUTH_MODE, SPORTMONKS_HOST, XG_TYPE, LEAGUE_SPECS,
  safeNumber, normalize, scoreLeagueCandidate, resolveLeague, getFixtureParticipants, getFixtureXgRows, extractXgValue,
  aggregateFixtureXg, buildDateRanges, seasonStartDate, fetchSeasonFixtures, fetchSeasonTeams,
  getSportmonksLeagueXg, getProviderHealth, loadLkg, cacheFile, requestJson, resetCircuit, getCircuit
};
