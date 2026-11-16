'use strict';

const fs = require('fs');
const path = require('path');

const AUDIT16D_R3_R3B_R2_ENRICHMENT_VERSION = 'AUDIT16D_R3_R3B_R2_API_FOOTBALL_ENRICHMENT_V1';
const AUDIT16D_R3_R3B_R2_R1_SCOPE_VERSION = 'AUDIT16D_R3_R3B_R2_R1_API_SCOPE_AND_PROBE_EXIT_FIX_V1';
const AUDIT16D_R3_R3B_R2_R2_FREE_CALIBRATION_VERSION = 'AUDIT16D_R3_R3B_R2_R2_FREE_HISTORICAL_CALIBRATION_V1';
const AUDIT16D_R3_R3B_R2_R2_R1_QUOTA_SYNC_VERSION = 'AUDIT16D_R3_R3B_R2_R2_R1_PROVIDER_QUOTA_HEADER_SYNC_V1';
const SERIE_B_LEAGUE_ID = 135;
const API_HOST = 'https://v3.football.api-sports.io';
const PROVIDER_ID = 'API_FOOTBALL_SERIE_B_ENRICHMENT';
const SOURCE_CLASS = 'MODEL_ESTIMATED';
const EVIDENCE_CLASS = 'MODEL_ESTIMATED_XG';
const DAILY_BUDGET = 80;
const MINUTE_BUDGET = 8;
const MAX_STATS_FETCH_PER_RUN = 6;
const FIXTURE_LIST_TTL_MS = 6 * 60 * 60 * 1000;
const LIVE_STATS_TTL_MS = 6 * 60 * 60 * 1000;
const COMPLETE_STATUSES = new Set(['FT', 'AET', 'PEN']);
const ENRICHMENT_WEIGHT_CAP = 0.40;
const API_PRIOR_MATCHES = 3;
const NEGATIVE_CAPABILITY_TTL_MS = 24 * 60 * 60 * 1000;
const PROVIDER_DAILY_RESERVE = 10;
const PROVIDER_MINUTE_RESERVE = 2;
const PROVIDER_MINUTE_SNAPSHOT_TTL_MS = 75 * 1000;

function round(v, d = 3) {
  const p = 10 ** d;
  return Math.round((Number(v) + Number.EPSILON) * p) / p;
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function finite(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(String(v).replace('%', '').trim());
  return Number.isFinite(n) ? n : fallback;
}
function safeJsonRead(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function safeJsonWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  fs.renameSync(tmp, file);
}
function capabilityCacheFile(cacheDir) { return path.join(cacheDir, 'capability_cache.json'); }
function readCapabilityCache(cacheDir) {
  const raw = safeJsonRead(capabilityCacheFile(cacheDir), null);
  return raw && typeof raw === 'object' ? raw : { version: 1, seasons: {} };
}
function normalizeSeasonList(v) {
  return [...new Set((Array.isArray(v) ? v : []).map(Number).filter(x => Number.isFinite(x) && x >= 2000 && x <= 2100))].sort((a,b)=>a-b);
}
function parseAvailableSeasonsFromErrors(errors) {
  const text = normalizeApiErrors(errors).join(' | ');
  const m = text.match(/(?:try|available)[^0-9]*(?:from\s*)?(20\d{2})\s*(?:to|[-–])\s*(20\d{2})/i);
  if (!m) return [];
  const a = Number(m[1]), b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 20) return [];
  return Array.from({length:b-a+1},(_,i)=>a+i);
}
function isPlanSeasonDeniedError(errors) {
  const text = normalizeApiErrors(errors).join(' | ').toLowerCase();
  return /free plans? do not have access to this season|season[^|]*(?:not available|not allowed)[^|]*(?:your|current|free) plan|(?:your|current|free) plan[^|]*does not have access[^|]*season/.test(text);
}
function getCachedSeasonDenial(cacheDir, seasonStart, now = new Date()) {
  const cache = readCapabilityCache(cacheDir);
  const row = cache?.seasons?.[String(Number(seasonStart))];
  if (!row || row.allowed !== false) return null;
  const exp = Date.parse(row.expiresAt || '');
  if (!Number.isFinite(exp) || exp <= now.getTime()) return null;
  return { ...row, availableSeasons: normalizeSeasonList(row.availableSeasons) };
}
function rememberSeasonDenial(cacheDir, seasonStart, details = {}, now = new Date()) {
  const cache = readCapabilityCache(cacheDir);
  cache.version = 1;
  cache.seasons = cache.seasons && typeof cache.seasons === 'object' ? cache.seasons : {};
  const apiErrors = normalizeApiErrors(details.apiErrors);
  const availableSeasons = normalizeSeasonList(details.availableSeasons?.length ? details.availableSeasons : parseAvailableSeasonsFromErrors(apiErrors));
  cache.seasons[String(Number(seasonStart))] = {
    allowed: false,
    reason: details.reason || 'PLAN_SEASON_UNAVAILABLE',
    leagueId: Number.isFinite(Number(details.leagueId)) ? Number(details.leagueId) : SERIE_B_LEAGUE_ID,
    seasonStart: Number(seasonStart),
    availableSeasons,
    apiErrors,
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + NEGATIVE_CAPABILITY_TTL_MS).toISOString()
  };
  safeJsonWrite(capabilityCacheFile(cacheDir), cache);
  return cache.seasons[String(Number(seasonStart))];
}
function clearSeasonDenial(cacheDir, seasonStart) {
  const cache = readCapabilityCache(cacheDir);
  if (cache?.seasons && Object.prototype.hasOwnProperty.call(cache.seasons, String(Number(seasonStart)))) {
    delete cache.seasons[String(Number(seasonStart))];
    safeJsonWrite(capabilityCacheFile(cacheDir), cache);
  }
}

function canonicalTeamName(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|calcio|ssc|ss|ac|as|us|1908|1919|1920|1929)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}
function normalizeStatType(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function statsObject(block) {
  const out = {};
  for (const row of Array.isArray(block?.statistics) ? block.statistics : []) {
    out[normalizeStatType(row?.type)] = row?.value;
  }
  const get = (...keys) => {
    for (const k of keys) if (Object.prototype.hasOwnProperty.call(out, k)) return out[k];
    return null;
  };
  return {
    totalShots: finite(get('totalshots')),
    shotsOnTarget: finite(get('shotsongoal', 'shotsontarget')),
    shotsOffTarget: finite(get('shotsoffgoal', 'shotsofftarget')),
    blockedShots: finite(get('blockedshots')),
    shotsInsideBox: finite(get('shotsinsidebox', 'shotsinsidebox')),
    shotsOutsideBox: finite(get('shotsoutsidebox', 'shotsoutsidebox')),
    possession: finite(get('ballpossession')),
    corners: finite(get('cornerkicks')),
    goalkeeperSaves: finite(get('goalkeepersaves'))
  };
}
function estimateEnrichedMatchXg(s = {}) {
  const total = finite(s.totalShots, 0);
  const sot = clamp(finite(s.shotsOnTarget, 0), 0, Math.max(0, total));
  if (!(total > 0)) return null;
  const nonTarget = Math.max(0, total - sot);
  const base = clamp((0.30 * sot) + (0.03 * nonTarget), 0.15, 4.00);

  const inside = finite(s.shotsInsideBox);
  const outside = finite(s.shotsOutsideBox);
  let locationFactor = 1;
  if (inside !== null && outside !== null && inside >= 0 && outside >= 0 && (inside + outside) > 0) {
    const share = clamp(inside / (inside + outside), 0, 1);
    locationFactor = clamp(0.82 + (0.36 * share), 0.82, 1.18);
  }

  const blocked = finite(s.blockedShots);
  let blockFactor = 1;
  if (blocked !== null && blocked >= 0) {
    const share = clamp(blocked / total, 0, 1);
    blockFactor = clamp(1 - (0.10 * share), 0.90, 1.00);
  }

  return round(clamp(base * locationFactor * blockFactor, 0.15, 4.20), 3);
}

function resolveApiKey(env = process.env) {
  const keys = ['API_FOOTBALL_KEY', 'APISPORTS_API_KEY', 'APISPORTS_KEY'];
  for (const name of keys) {
    const value = String(env?.[name] || '').trim();
    if (value) return { configured: true, envName: name, value };
  }
  return { configured: false, envName: null, value: '' };
}
function defaultCacheDir(projectRoot) {
  return path.join(projectRoot, 'backend', 'data', 'calcio_serieb_api_football_r2');
}
function quotaLedgerPath(cacheDir) { return path.join(cacheDir, 'quota_ledger.json'); }
function providerQuotaStatePath(cacheDir) { return path.join(cacheDir, 'provider_quota_state.json'); }
function utcDayKey(now = new Date()) { return now.toISOString().slice(0, 10); }
function utcDayStartMs(now = new Date()) { return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()); }
function cleanLedger(ledger, now = new Date()) {
  const nowMs = now.getTime();
  const dayStart = utcDayStartMs(now);
  const calls = Array.isArray(ledger?.calls) ? ledger.calls
    .map(Number)
    .filter(x => Number.isFinite(x) && x >= dayStart && x <= nowMs + 5 * 60 * 1000) : [];
  return { version: 2, utcDay: utcDayKey(now), calls };
}
function normalizeHeaders(headers) {
  const out = {};
  if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = v;
  }
  return out;
}
function headerInt(headers, name) {
  const h = normalizeHeaders(headers);
  const n = Number(h[String(name).toLowerCase()]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
function readProviderQuotaState(cacheDir, now = new Date()) {
  const raw = safeJsonRead(providerQuotaStatePath(cacheDir), null);
  if (!raw || typeof raw !== 'object') return null;
  const observedMs = Date.parse(raw.observedAt || '');
  const sameDay = raw.utcDay === utcDayKey(now);
  const ageMs = Number.isFinite(observedMs) ? now.getTime() - observedMs : Infinity;
  return {
    ...raw,
    sameDay,
    minuteFresh: sameDay && ageMs >= 0 && ageMs <= PROVIDER_MINUTE_SNAPSHOT_TTL_MS,
    ageMs
  };
}
function rememberProviderQuota(cacheDir, headers, now = new Date()) {
  const dailyLimit = headerInt(headers, 'x-ratelimit-requests-limit');
  const dailyRemaining = headerInt(headers, 'x-ratelimit-requests-remaining');
  const minuteLimit = headerInt(headers, 'x-ratelimit-limit');
  const minuteRemaining = headerInt(headers, 'x-ratelimit-remaining');
  if ([dailyLimit, dailyRemaining, minuteLimit, minuteRemaining].every(v => v === null)) return null;
  const row = {
    version: 1,
    utcDay: utcDayKey(now),
    observedAt: now.toISOString(),
    dailyLimit,
    dailyRemaining,
    minuteLimit,
    minuteRemaining
  };
  safeJsonWrite(providerQuotaStatePath(cacheDir), row);
  return row;
}
function quotaStatus(cacheDir, now = new Date()) {
  const nowMs = now.getTime();
  const ledger = cleanLedger(safeJsonRead(quotaLedgerPath(cacheDir), { calls: [] }), now);
  const minuteUsed = ledger.calls.filter(t => nowMs - t >= 0 && nowMs - t < 60 * 1000).length;
  const dayUsed = ledger.calls.length;
  const localMinuteRemaining = Math.max(0, MINUTE_BUDGET - minuteUsed);
  const localDayRemaining = Math.max(0, DAILY_BUDGET - dayUsed);
  const provider = readProviderQuotaState(cacheDir, now);
  const providerDailyFresh = Boolean(provider?.sameDay && Number.isFinite(Number(provider.dailyRemaining)));
  const providerMinuteFresh = Boolean(provider?.minuteFresh && Number.isFinite(Number(provider.minuteRemaining)));
  const providerDailyRemaining = providerDailyFresh ? Number(provider.dailyRemaining) : null;
  const providerMinuteRemaining = providerMinuteFresh ? Number(provider.minuteRemaining) : null;
  const safeProviderDayRemaining = providerDailyFresh ? Math.max(0, providerDailyRemaining - PROVIDER_DAILY_RESERVE) : null;
  const safeProviderMinuteRemaining = providerMinuteFresh ? Math.max(0, providerMinuteRemaining - PROVIDER_MINUTE_RESERVE) : null;
  const dayRemaining = providerDailyFresh ? safeProviderDayRemaining : localDayRemaining;
  const minuteRemaining = providerMinuteFresh ? Math.min(localMinuteRemaining, safeProviderMinuteRemaining) : localMinuteRemaining;
  const dailyCanCall = providerDailyFresh ? providerDailyRemaining > PROVIDER_DAILY_RESERVE : dayUsed < DAILY_BUDGET;
  const minuteCanCall = minuteUsed < MINUTE_BUDGET && (!providerMinuteFresh || providerMinuteRemaining > PROVIDER_MINUTE_RESERVE);
  return {
    ledger,
    minuteUsed,
    dayUsed,
    minuteRemaining,
    dayRemaining,
    localMinuteRemaining,
    localDayRemaining,
    canCall: dailyCanCall && minuteCanCall,
    mode: providerDailyFresh ? 'PROVIDER_HEADER_SYNC' : 'LOCAL_FALLBACK',
    utcDay: utcDayKey(now),
    providerSyncActive: providerDailyFresh,
    providerDailyLimit: providerDailyFresh && Number.isFinite(Number(provider.dailyLimit)) ? Number(provider.dailyLimit) : null,
    providerDailyRemaining,
    providerMinuteLimit: providerMinuteFresh && Number.isFinite(Number(provider.minuteLimit)) ? Number(provider.minuteLimit) : null,
    providerMinuteRemaining,
    providerObservedAt: providerDailyFresh ? provider.observedAt : null,
    providerMinuteFresh,
    providerDailyReserve: PROVIDER_DAILY_RESERVE,
    providerMinuteReserve: PROVIDER_MINUTE_RESERVE
  };
}
function recordQuotaCall(cacheDir, at = new Date()) {
  const status = quotaStatus(cacheDir, at);
  status.ledger.calls.push(at.getTime());
  safeJsonWrite(quotaLedgerPath(cacheDir), status.ledger);
}

function normalizeApiErrors(errors) {
  if (!errors) return [];
  if (typeof errors === 'string') return errors.trim() ? [errors.trim()] : [];
  if (Array.isArray(errors)) return errors.flatMap(normalizeApiErrors);
  if (typeof errors === 'object') {
    return Object.entries(errors).flatMap(([k, v]) => {
      const vals = normalizeApiErrors(v);
      return vals.length ? vals.map(x => `${k}: ${x}`) : [];
    });
  }
  return [String(errors)];
}

async function defaultRequestJson(url, apiKey) {
  const u = new URL(url);
  if (u.origin !== API_HOST) throw new Error('API_FOOTBALL_HOST_FENCE');
  const response = await fetch(u, {
    headers: {
      'accept': 'application/json',
      'x-apisports-key': apiKey
    },
    signal: AbortSignal.timeout(12000)
  });
  const headers = Object.fromEntries(response.headers.entries());
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  if (!response.ok) {
    const err = new Error(`API_FOOTBALL_HTTP_${response.status}`);
    err.status = response.status;
    err.payload = json;
    err.headers = headers;
    throw err;
  }
  const apiErrors = normalizeApiErrors(json?.errors);
  if (apiErrors.length) {
    const err = new Error('API_FOOTBALL_API_ERRORS');
    err.status = response.status;
    err.apiErrors = apiErrors;
    err.payload = json;
    err.headers = headers;
    throw err;
  }
  return { json, headers, status: response.status };
}

async function apiCall({ url, apiKey, cacheDir, now, requestJson }) {
  const qs = quotaStatus(cacheDir, now);
  if (!qs.canCall) {
    const err = new Error('API_FOOTBALL_LOCAL_QUOTA_GUARD');
    err.quota = qs;
    throw err;
  }
  recordQuotaCall(cacheDir, now);
  try {
    const result = await requestJson(url, apiKey);
    rememberProviderQuota(cacheDir, result?.headers, now);
    return result;
  } catch (err) {
    rememberProviderQuota(cacheDir, err?.headers, now);
    throw err;
  }
}

function leagueCacheFile(cacheDir, seasonStart) { return path.join(cacheDir, `league_${seasonStart}.json`); }
function fixturesCacheFile(cacheDir, seasonStart) { return path.join(cacheDir, `fixtures_${seasonStart}.json`); }
function statsCacheFile(cacheDir, fixtureId) { return path.join(cacheDir, 'stats', `${fixtureId}.json`); }
function isFresh(record, ttl, now) {
  const t = Date.parse(record?.cachedAt || '');
  return Number.isFinite(t) && now.getTime() - t >= 0 && now.getTime() - t <= ttl;
}

async function resolveSerieBLeague({ seasonStart, apiKey, cacheDir, now, requestJson }) {
  const file = leagueCacheFile(cacheDir, seasonStart);
  const cached = safeJsonRead(file);
  if (cached?.leagueId && Number(cached?.seasonStart) === Number(seasonStart) && isFresh(cached, 7 * 24 * 60 * 60 * 1000, now)) {
    return { ...cached, cacheHit: true };
  }

  // League IDs are stable in API-Football. Resolve metadata without a season filter first,
  // otherwise Free-plan season restrictions can look like a missing league.
  const urls = [
    `${API_HOST}/leagues?id=${SERIE_B_LEAGUE_ID}`,
    `${API_HOST}/leagues?country=Italy&search=${encodeURIComponent('Serie B')}`
  ];
  let rows = [];
  let usedUrl = null;
  for (const url of urls) {
    const r = await apiCall({ url, apiKey, cacheDir, now, requestJson });
    const current = Array.isArray(r.json?.response) ? r.json.response : [];
    if (current.length) { rows = current; usedUrl = url; break; }
  }

  const selected = rows.find(x => Number(x?.league?.id) === SERIE_B_LEAGUE_ID)
    || rows.find(x => String(x?.league?.name || '').trim().toLowerCase() === 'serie b' && String(x?.country?.name || '').trim().toLowerCase() === 'italy')
    || rows.find(x => String(x?.league?.name || '').trim().toLowerCase() === 'serie b')
    || rows[0];
  const leagueId = Number(selected?.league?.id);
  if (!Number.isFinite(leagueId)) {
    const err = new Error('API_FOOTBALL_SERIE_B_LEAGUE_NOT_FOUND');
    err.discoveryUrls = urls;
    throw err;
  }

  const availableSeasons = (Array.isArray(selected?.seasons) ? selected.seasons : [])
    .map(s => Number(s?.year)).filter(Number.isFinite).sort((a,b) => a-b);
  const seasonRow = (Array.isArray(selected?.seasons) ? selected.seasons : [])
    .find(s => Number(s?.year) === Number(seasonStart));
  if (!seasonRow) {
    const err = new Error('API_FOOTBALL_SEASON_NOT_AVAILABLE');
    err.leagueId = leagueId;
    err.availableSeasons = availableSeasons;
    err.requestedSeason = Number(seasonStart);
    err.discoveryUrl = usedUrl;
    throw err;
  }

  const coverage = seasonRow?.coverage || selected?.coverage || null;
  const out = {
    leagueId,
    leagueName: selected?.league?.name || 'Serie B',
    country: selected?.country?.name || 'Italy',
    seasonStart: Number(seasonStart),
    availableSeasons,
    coverage,
    discoveryUrl: usedUrl,
    cachedAt: now.toISOString()
  };
  safeJsonWrite(file, out);
  return { ...out, cacheHit: false };
}

async function getCompletedFixtures({ leagueId, seasonStart, apiKey, cacheDir, now, requestJson }) {
  const file = fixturesCacheFile(cacheDir, seasonStart);
  const cached = safeJsonRead(file);
  if (Array.isArray(cached?.fixtures) && isFresh(cached, FIXTURE_LIST_TTL_MS, now)) return { ...cached, cacheHit: true };
  const url = `${API_HOST}/fixtures?league=${encodeURIComponent(leagueId)}&season=${encodeURIComponent(seasonStart)}&status=FT-AET-PEN`;
  const r = await apiCall({ url, apiKey, cacheDir, now, requestJson });
  const fixtures = (Array.isArray(r.json?.response) ? r.json.response : []).map(x => ({
    id: Number(x?.fixture?.id),
    date: x?.fixture?.date || null,
    status: x?.fixture?.status?.short || null,
    home: x?.teams?.home?.name || null,
    away: x?.teams?.away?.name || null
  })).filter(x => Number.isFinite(x.id) && x.home && x.away);
  fixtures.sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0));
  const out = { fixtures, cachedAt: now.toISOString() };
  safeJsonWrite(file, out);
  return { ...out, cacheHit: false };
}

function validStatCache(cached, fixture, now) {
  if (!cached?.response || !Array.isArray(cached.response)) return false;
  if (COMPLETE_STATUSES.has(String(fixture?.status || ''))) return true;
  return isFresh(cached, LIVE_STATS_TTL_MS, now);
}
async function getFixtureStats({ fixture, apiKey, cacheDir, now, requestJson }) {
  const file = statsCacheFile(cacheDir, fixture.id);
  const cached = safeJsonRead(file);
  if (validStatCache(cached, fixture, now)) return { response: cached.response, cacheHit: true };
  const url = `${API_HOST}/fixtures/statistics?fixture=${encodeURIComponent(fixture.id)}`;
  const r = await apiCall({ url, apiKey, cacheDir, now, requestJson });
  const response = Array.isArray(r.json?.response) ? r.json.response : [];
  const out = { fixtureId: fixture.id, response, cachedAt: now.toISOString(), final: COMPLETE_STATUSES.has(String(fixture.status || '')) };
  safeJsonWrite(file, out);
  return { response, cacheHit: false };
}

function aggregateApiStats(statRows, baseTeams) {
  const baseIndex = new Map(Object.keys(baseTeams || {}).map(name => [canonicalTeamName(name), name]));
  const acc = new Map();
  const ensure = name => {
    if (!acc.has(name)) acc.set(name, { games: 0, xgForSum: 0, xgAgainstSum: 0, inside: 0, outside: 0, blocked: 0, total: 0, sot: 0, possession: 0, possessionGames: 0 });
    return acc.get(name);
  };
  let acceptedFixtures = 0;
  let unmatchedTeams = 0;

  for (const item of statRows) {
    const response = Array.isArray(item?.response) ? item.response : [];
    if (response.length < 2) continue;
    const sides = response.slice(0, 2).map(block => {
      const apiName = block?.team?.name || '';
      const baseName = baseIndex.get(canonicalTeamName(apiName));
      const s = statsObject(block);
      const xg = estimateEnrichedMatchXg(s);
      return { apiName, baseName, s, xg };
    });
    if (sides.some(x => !x.baseName || x.xg === null)) {
      unmatchedTeams += sides.filter(x => !x.baseName).length;
      continue;
    }
    const [a, b] = sides;
    const ar = ensure(a.baseName), br = ensure(b.baseName);
    ar.games++; ar.xgForSum += a.xg; ar.xgAgainstSum += b.xg;
    br.games++; br.xgForSum += b.xg; br.xgAgainstSum += a.xg;
    for (const [r, s] of [[ar, a.s], [br, b.s]]) {
      r.inside += finite(s.shotsInsideBox, 0); r.outside += finite(s.shotsOutsideBox, 0); r.blocked += finite(s.blockedShots, 0);
      r.total += finite(s.totalShots, 0); r.sot += finite(s.shotsOnTarget, 0);
      if (finite(s.possession) !== null) { r.possession += finite(s.possession, 0); r.possessionGames++; }
    }
    acceptedFixtures++;
  }
  return { acc, acceptedFixtures, unmatchedTeams };
}

function blendWithBase(baseModel, aggregate, meta = {}) {
  const baseTeams = baseModel?.teams || {};
  const rows = [...aggregate.acc.values()];
  const teamMatches = rows.reduce((s, r) => s + r.games, 0);
  const leagueXgSum = rows.reduce((s, r) => s + r.xgForSum, 0);
  const leagueMean = teamMatches > 0 ? leagueXgSum / teamMatches : null;
  const teams = { ...baseTeams };
  let enrichedTeamCount = 0;

  if (leagueMean !== null) {
    for (const [name, r] of aggregate.acc.entries()) {
      const base = baseTeams[name];
      if (!base || !(r.games > 0)) continue;
      const denom = r.games + API_PRIOR_MATCHES;
      const apiFor = (r.xgForSum + API_PRIOR_MATCHES * leagueMean) / denom;
      const apiAgainst = (r.xgAgainstSum + API_PRIOR_MATCHES * leagueMean) / denom;
      const blendWeight = Math.min(ENRICHMENT_WEIGHT_CAP, r.games / (r.games + 10));
      teams[name] = {
        ...base,
        xG_for: round((1 - blendWeight) * Number(base.xG_for) + blendWeight * apiFor, 3),
        xG_against: round((1 - blendWeight) * Number(base.xG_against) + blendWeight * apiAgainst, 3),
        source: 'FOOTBALL_DATA_CSV_SHOTS_SOT+API_FOOTBALL_FIXTURE_STATS',
        providerId: base.providerId || 'SERIE_B_ESTIMATED_XG',
        evidenceClass: EVIDENCE_CLASS,
        modelEstimated: true,
        apiFootballEnriched: true,
        apiFootballGames: r.games,
        apiFootballBlendWeight: round(blendWeight, 3),
        avgShotsInsideBox: round(r.inside / r.games, 2),
        avgShotsOutsideBox: round(r.outside / r.games, 2),
        avgBlockedShots: round(r.blocked / r.games, 2),
        avgPossession: r.possessionGames ? round(r.possession / r.possessionGames, 2) : null
      };
      enrichedTeamCount++;
    }
  }

  return {
    ...baseModel,
    teams,
    state: {
      ...(baseModel?.state || {}),
      status: baseModel?.state?.status || 'MODEL_READY',
      sourceClass: SOURCE_CLASS,
      evidenceClass: EVIDENCE_CLASS,
      realXg: false,
      directStakeAuthority: false,
      directGateAuthority: false,
      authorityWeight: Math.min(Number(baseModel?.state?.authorityWeight) || 0.20, 0.20),
      enrichmentRevision: AUDIT16D_R3_R3B_R2_ENRICHMENT_VERSION,
      enrichmentStatus: enrichedTeamCount >= 4 ? 'API_FOOTBALL_ENRICHED' : 'BASE_ONLY_INSUFFICIENT_ENRICHED_TEAMS',
      apiFootballConfigured: true,
      apiFootballTokenExposed: false,
      apiFootballFixturesAccepted: aggregate.acceptedFixtures,
      apiFootballEnrichedTeams: enrichedTeamCount,
      apiFootballUnmatchedTeams: aggregate.unmatchedTeams,
      apiFootballLeagueId: meta.leagueId || null,
      source: enrichedTeamCount >= 4 ? 'FOOTBALL_DATA_CSV_SHOTS_SOT+API_FOOTBALL_FIXTURE_STATS' : (baseModel?.state?.source || 'FOOTBALL_DATA_CSV_SHOTS_SOT')
    },
    diagnostics: {
      ...(baseModel?.diagnostics || {}),
      apiFootball: {
        enrichmentRevision: AUDIT16D_R3_R3B_R2_ENRICHMENT_VERSION,
        acceptedFixtures: aggregate.acceptedFixtures,
        enrichedTeamCount,
        unmatchedTeams: aggregate.unmatchedTeams,
        leagueMean: leagueMean === null ? null : round(leagueMean, 3),
        ...meta
      }
    }
  };
}

function baseOnly(baseModel, status, details = {}) {
  return {
    ...baseModel,
    state: {
      ...(baseModel?.state || {}),
      sourceClass: SOURCE_CLASS,
      evidenceClass: EVIDENCE_CLASS,
      realXg: false,
      directStakeAuthority: false,
      directGateAuthority: false,
      authorityWeight: Math.min(Number(baseModel?.state?.authorityWeight) || 0.20, 0.20),
      enrichmentRevision: AUDIT16D_R3_R3B_R2_ENRICHMENT_VERSION,
      enrichmentStatus: status,
      apiFootballConfigured: Boolean(details.apiFootballConfigured),
      apiFootballTokenExposed: false,
      apiFootballCalls: details.apiCalls || 0,
      apiFootballCacheHits: details.cacheHits || 0
    },
    diagnostics: {
      ...(baseModel?.diagnostics || {}),
      apiFootball: { enrichmentRevision: AUDIT16D_R3_R3B_R2_ENRICHMENT_VERSION, status, ...details, apiFootballTokenExposed: false }
    }
  };
}

async function enrichBaseModel(baseModel, options = {}) {
  if (!baseModel?.state || baseModel.state.status !== 'MODEL_READY' || baseModel.state.evidenceClass !== EVIDENCE_CLASS) {
    return baseOnly(baseModel, 'BASE_NOT_READY', { apiFootballConfigured: false });
  }
  const key = resolveApiKey(options.env || process.env);
  if (!key.configured) return baseOnly(baseModel, 'BASE_ONLY_NO_API_KEY', { apiFootballConfigured: false });

  const seasonStart = Number(options.seasonStart ?? baseModel.state.seasonStart);
  if (!Number.isFinite(seasonStart) || seasonStart < 2000 || seasonStart > 2100) {
    return baseOnly(baseModel, 'BASE_ONLY_INVALID_SEASON', { apiFootballConfigured: true });
  }

  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const cacheDir = path.resolve(options.cacheDir || defaultCacheDir(projectRoot));
  const now = options.now instanceof Date ? options.now : new Date();
  const requestJson = options.requestJson || defaultRequestJson;
  fs.mkdirSync(cacheDir, { recursive: true });
  let apiCallsBefore = quotaStatus(cacheDir, now).dayUsed;
  let cacheHits = 0;
  const forceCapabilityRefresh = options.forceCapabilityRefresh === true || String((options.env || process.env)?.API_FOOTBALL_FORCE_CAPABILITY_REFRESH || '').trim() === '1';
  if (!forceCapabilityRefresh) {
    const denied = getCachedSeasonDenial(cacheDir, seasonStart, now);
    if (denied) {
      return baseOnly(baseModel, 'BASE_ONLY_SEASON_NOT_AVAILABLE_CACHED', {
        apiFootballConfigured: true, apiCalls: 0, cacheHits: 1, capabilityCacheHit: true,
        requestedSeason: seasonStart, availableSeasons: denied.availableSeasons, leagueId: denied.leagueId,
        capabilityReason: denied.reason, capabilityObservedAt: denied.observedAt, capabilityExpiresAt: denied.expiresAt,
        apiErrors: denied.apiErrors,
        localQuota: (() => { const q = quotaStatus(cacheDir, now); return { minuteUsed:q.minuteUsed, dayUsed:q.dayUsed, minuteRemaining:q.minuteRemaining, dayRemaining:q.dayRemaining }; })()
      });
    }
  }

  try {
    const league = await resolveSerieBLeague({ seasonStart, apiKey: key.value, cacheDir, now, requestJson });
    if (league.cacheHit) cacheHits++;
    clearSeasonDenial(cacheDir, seasonStart);
    const coverageStats = league.coverage?.fixtures?.statistics_fixtures;
    if (coverageStats === false) return baseOnly(baseModel, 'BASE_ONLY_STATS_NOT_COVERED', { apiFootballConfigured: true, leagueId: league.leagueId, cacheHits });

    const fx = await getCompletedFixtures({ leagueId: league.leagueId, seasonStart, apiKey: key.value, cacheDir, now, requestJson });
    if (fx.cacheHit) cacheHits++;
    const statRows = [];
    let networkStatsFetched = 0;
    const maxStats = Number.isFinite(Number(options.maxStatsFetchPerRun)) ? Math.max(0, Math.min(MAX_STATS_FETCH_PER_RUN, Number(options.maxStatsFetchPerRun))) : MAX_STATS_FETCH_PER_RUN;

    for (const fixture of fx.fixtures) {
      const cached = safeJsonRead(statsCacheFile(cacheDir, fixture.id));
      if (validStatCache(cached, fixture, now)) {
        statRows.push({ fixture, response: cached.response, cacheHit: true });
        cacheHits++;
        continue;
      }
      if (networkStatsFetched >= maxStats) continue;
      const qs = quotaStatus(cacheDir, now);
      if (!qs.canCall) break;
      const s = await getFixtureStats({ fixture, apiKey: key.value, cacheDir, now, requestJson });
      statRows.push({ fixture, response: s.response, cacheHit: s.cacheHit });
      if (s.cacheHit) cacheHits++; else networkStatsFetched++;
    }

    const aggregate = aggregateApiStats(statRows, baseModel.teams);
    const afterQuota = quotaStatus(cacheDir, now);
    const apiCalls = Math.max(0, afterQuota.dayUsed - apiCallsBefore);
    if (aggregate.acceptedFixtures <= 0) {
      return baseOnly(baseModel, 'BASE_ONLY_NO_USABLE_API_STATS', {
        apiFootballConfigured: true, leagueId: league.leagueId, apiCalls, cacheHits,
        fixtureCount: fx.fixtures.length, localQuota: { minuteUsed: afterQuota.minuteUsed, dayUsed: afterQuota.dayUsed }
      });
    }
    return blendWithBase(baseModel, aggregate, {
      leagueId: league.leagueId,
      apiCalls,
      cacheHits,
      fixtureCount: fx.fixtures.length,
      statRows: statRows.length,
      localQuota: { minuteUsed: afterQuota.minuteUsed, dayUsed: afterQuota.dayUsed, minuteRemaining: afterQuota.minuteRemaining, dayRemaining: afterQuota.dayRemaining },
      keyEnvName: key.envName
    });
  } catch (err) {
    const afterQuota = quotaStatus(cacheDir, now);
    const apiCalls = Math.max(0, afterQuota.dayUsed - apiCallsBefore);
    let status = 'BASE_ONLY_API_UNAVAILABLE';
    let capability = null;
    const apiErrors = Array.isArray(err?.apiErrors) ? err.apiErrors : [];
    const planSeasonDenied = err?.message === 'API_FOOTBALL_SEASON_NOT_AVAILABLE' || (err?.message === 'API_FOOTBALL_API_ERRORS' && isPlanSeasonDeniedError(apiErrors));
    if (err?.message === 'API_FOOTBALL_LOCAL_QUOTA_GUARD') status = 'BASE_ONLY_LOCAL_QUOTA_GUARD';
    else if (planSeasonDenied) {
      status = 'BASE_ONLY_SEASON_NOT_AVAILABLE_ON_PLAN';
      capability = rememberSeasonDenial(cacheDir, seasonStart, {
        reason: 'PLAN_SEASON_UNAVAILABLE',
        leagueId: Number.isFinite(Number(err?.leagueId)) ? Number(err.leagueId) : SERIE_B_LEAGUE_ID,
        availableSeasons: Array.isArray(err?.availableSeasons) ? err.availableSeasons : parseAvailableSeasonsFromErrors(apiErrors),
        apiErrors
      }, now);
    } else if (err?.message === 'API_FOOTBALL_SERIE_B_LEAGUE_NOT_FOUND') status = 'BASE_ONLY_LEAGUE_DISCOVERY_FAILED';
    else if (err?.message === 'API_FOOTBALL_API_ERRORS') status = 'BASE_ONLY_API_PROVIDER_ERROR';
    return baseOnly(baseModel, status, {
      apiFootballConfigured: true,
      apiCalls,
      cacheHits,
      error: String(err?.message || err),
      httpStatus: Number.isFinite(Number(err?.status)) ? Number(err.status) : null,
      requestedSeason: Number.isFinite(Number(err?.requestedSeason)) ? Number(err.requestedSeason) : seasonStart,
      availableSeasons: capability?.availableSeasons || (Array.isArray(err?.availableSeasons) ? err.availableSeasons : parseAvailableSeasonsFromErrors(apiErrors)),
      leagueId: capability?.leagueId || (Number.isFinite(Number(err?.leagueId)) ? Number(err.leagueId) : undefined),
      apiErrors: apiErrors.length ? apiErrors : undefined,
      capabilityCached: Boolean(capability),
      capabilityExpiresAt: capability?.expiresAt,
      localQuota: { minuteUsed: afterQuota.minuteUsed, dayUsed: afterQuota.dayUsed, minuteRemaining: afterQuota.minuteRemaining, dayRemaining: afterQuota.dayRemaining }
    });
  }
}

module.exports = {
  AUDIT16D_R3_R3B_R2_ENRICHMENT_VERSION,
  AUDIT16D_R3_R3B_R2_R1_SCOPE_VERSION,
  AUDIT16D_R3_R3B_R2_R2_FREE_CALIBRATION_VERSION,
  AUDIT16D_R3_R3B_R2_R2_R1_QUOTA_SYNC_VERSION,
  SERIE_B_LEAGUE_ID,
  API_HOST,
  PROVIDER_ID,
  SOURCE_CLASS,
  EVIDENCE_CLASS,
  DAILY_BUDGET,
  MINUTE_BUDGET,
  MAX_STATS_FETCH_PER_RUN,
  ENRICHMENT_WEIGHT_CAP,
  NEGATIVE_CAPABILITY_TTL_MS,
  PROVIDER_DAILY_RESERVE,
  PROVIDER_MINUTE_RESERVE,
  canonicalTeamName,
  statsObject,
  estimateEnrichedMatchXg,
  resolveApiKey,
  quotaStatus,
  rememberProviderQuota,
  readProviderQuotaState,
  getCachedSeasonDenial,
  rememberSeasonDenial,
  clearSeasonDenial,
  parseAvailableSeasonsFromErrors,
  isPlanSeasonDeniedError,
  aggregateApiStats,
  blendWithBase,
  baseOnly,
  enrichBaseModel,
  _private: {
    defaultRequestJson,
    defaultCacheDir,
    apiCall,
    recordQuotaCall,
    providerQuotaStatePath,
    utcDayKey,
    cleanLedger,
    capabilityCacheFile,
    normalizeApiErrors,
    resolveSerieBLeague,
    getCompletedFixtures,
    getFixtureStats,
    statsCacheFile,
    validStatCache,
    safeJsonRead,
    safeJsonWrite
  }
};
