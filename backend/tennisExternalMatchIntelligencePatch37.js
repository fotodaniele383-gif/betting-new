'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');
const tennisVenueRegistryPatch39 = require('./tennisVenueRegistryPatch39');
const tennisH2HWeightPolicyPatch40 = require('./tennisH2HWeightPolicyPatch40');

const VERSION = 'TENNIS_EXTERNAL_MATCH_INTELLIGENCE_V1_PATCH37';
const H2H_VERSION = 'TENNIS_LOCAL_STRUCTURED_H2H_V1_PATCH37';
const WEB_VERSION = 'TENNIS_EXTERNAL_WEB_SOURCE_REGISTRY_V1_PATCH37';
const RECEIPT_SCHEMA_VERSION = 'TENNIS_EXTERNAL_INTELLIGENCE_RECEIPT_SCHEMA_V1_PATCH37';
const CHALLENGER_VERSION = 'TENNIS_EXTERNAL_CONTEXT_CHALLENGER_V1_PATCH37';

const DEFAULT_DATA_DIR = path.join(__dirname, 'sackmann_data');
const HTTP_TIMEOUT_MS = 7500;
const HTTP_MAX_BYTES = 2 * 1024 * 1024;
const RANKING_TTL_MS = 6 * 60 * 60 * 1000;
const WEATHER_TTL_MS = 60 * 60 * 1000;
const H2H_CACHE_MAX = 512;
const WEB_CACHE_MAX = 128;

const ALLOWED_HOSTS = Object.freeze(new Set([
  'www.atptour.com',
  'www.wtatennis.com',
  'api.open-meteo.com'
]));

const SOURCE_REGISTRY = Object.freeze({
  LOCAL_STRUCTURED_H2H: Object.freeze({
    sourceId: 'LOCAL_STRUCTURED_H2H',
    access: 'LOCAL_CSV',
    keyRequired: false,
    authority: 'BOUNDED_DEEPSCAN_ADJUSTMENT',
    maxProbabilityAdjustmentPp: 2.5,
    licence: 'UPSTREAM_DATASET_TERMS_APPLY',
    enabled: true
  }),
  ATP_OFFICIAL_RANKINGS: Object.freeze({
    sourceId: 'ATP_OFFICIAL_RANKINGS',
    url: 'https://www.atptour.com/en/rankings/singles',
    host: 'www.atptour.com',
    keyRequired: false,
    authority: 'OFFICIAL_CONTEXT_ONLY',
    enabled: true
  }),
  WTA_OFFICIAL_RANKINGS: Object.freeze({
    sourceId: 'WTA_OFFICIAL_RANKINGS',
    url: 'https://www.wtatennis.com/rankings/singles',
    host: 'www.wtatennis.com',
    keyRequired: false,
    authority: 'OFFICIAL_CONTEXT_ONLY',
    enabled: true
  }),
  OPEN_METEO_FORECAST: Object.freeze({
    sourceId: 'OPEN_METEO_FORECAST',
    url: 'https://api.open-meteo.com/v1/forecast',
    host: 'api.open-meteo.com',
    keyRequired: false,
    authority: 'CONTEXT_AND_CONFIDENCE_ONLY',
    attributionRequired: true,
    enabled: true
  }),
  MATCH_CHARTING_PROJECT: Object.freeze({
    sourceId: 'MATCH_CHARTING_PROJECT',
    access: 'OPTIONAL_MANUAL_RESEARCH',
    authority: 'DISABLED_RESEARCH_ONLY',
    licence: 'CC_BY_NC_SA_4_0',
    enabled: false,
    reason: 'Non-commercial/share-alike source: disabled by default until deployment use is confirmed compatible.'
  })
});

const VENUES = Object.freeze([
  { id: 'indian_wells', aliases: ['indian wells','bnp paribas open'], latitude: 33.7237, longitude: -116.3056, timeZone: 'America/Los_Angeles', outdoor: true },
  { id: 'miami', aliases: ['miami open','miami masters'], latitude: 25.9580, longitude: -80.2389, timeZone: 'America/New_York', outdoor: true },
  { id: 'monte_carlo', aliases: ['monte carlo','monte-carlo'], latitude: 43.7508, longitude: 7.4400, timeZone: 'Europe/Monaco', outdoor: true },
  { id: 'madrid', aliases: ['madrid open','mutua madrid'], latitude: 40.3686, longitude: -3.6840, timeZone: 'Europe/Madrid', outdoor: true },
  { id: 'rome', aliases: ['roma','rome','internazionali d italia','italian open'], latitude: 41.9290, longitude: 12.4563, timeZone: 'Europe/Rome', outdoor: true },
  { id: 'montreal', aliases: ['montreal','canada masters montreal','national bank open montreal'], latitude: 45.5354, longitude: -73.6270, timeZone: 'America/Toronto', outdoor: true },
  { id: 'toronto', aliases: ['toronto','canada toronto','national bank open toronto'], latitude: 43.7716, longitude: -79.5123, timeZone: 'America/Toronto', outdoor: true },
  { id: 'cincinnati', aliases: ['cincinnati','cincinnati masters','cincinnati open'], latitude: 39.3557, longitude: -84.3144, timeZone: 'America/New_York', outdoor: true },
  { id: 'washington', aliases: ['washington','citi open'], latitude: 38.9542, longitude: -77.0389, timeZone: 'America/New_York', outdoor: true },
  { id: 'new_york', aliases: ['us open','flushing meadows','new york'], latitude: 40.7500, longitude: -73.8479, timeZone: 'America/New_York', outdoor: true },
  { id: 'wimbledon', aliases: ['wimbledon','all england club'], latitude: 51.4343, longitude: -0.2145, timeZone: 'Europe/London', outdoor: true },
  { id: 'roland_garros', aliases: ['roland garros','french open'], latitude: 48.8470, longitude: 2.2492, timeZone: 'Europe/Paris', outdoor: true },
  { id: 'melbourne', aliases: ['australian open','melbourne'], latitude: -37.8217, longitude: 144.9786, timeZone: 'Australia/Melbourne', outdoor: true },
  { id: 'beijing', aliases: ['beijing','pechino','china open'], latitude: 40.0192, longitude: 116.3975, timeZone: 'Asia/Shanghai', outdoor: true },
  { id: 'shanghai', aliases: ['shanghai','shanghai masters'], latitude: 31.0426, longitude: 121.3550, timeZone: 'Asia/Shanghai', outdoor: true },
  { id: 'doha', aliases: ['doha','qatar open'], latitude: 25.3111, longitude: 51.5144, timeZone: 'Asia/Qatar', outdoor: true },
  { id: 'dubai', aliases: ['dubai','dubai duty free'], latitude: 25.2429, longitude: 55.3420, timeZone: 'Asia/Dubai', outdoor: true },
  { id: 'guadalajara', aliases: ['guadalajara'], latitude: 20.6741, longitude: -103.3876, timeZone: 'America/Mexico_City', outdoor: true },
  { id: 'paris_indoor', aliases: ['paris bercy','paris-b​​ercy','paris masters','bercy'], latitude: 48.8386, longitude: 2.3785, timeZone: 'Europe/Paris', outdoor: false },
  { id: 'rotterdam_indoor', aliases: ['rotterdam','abn amro'], latitude: 51.8828, longitude: 4.4881, timeZone: 'Europe/Amsterdam', outdoor: false }
]);

const h2hCache = new Map();
const webCache = new Map();
const webInFlight = new Map();
const counters = {
  h2hLoads: 0,
  h2hCacheHits: 0,
  rankingFetches: 0,
  weatherFetches: 0,
  webCacheHits: 0,
  singleFlightHits: 0,
  webFailures: 0
};

function finite(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }
function round(value, decimals = 4) { const n = finite(value, 0); return Number(n.toFixed(decimals)); }
function sha(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function normalizeText(value = '') { return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalizeName(value = '') {
  return normalizeText(value)
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeSurface(value = '') {
  const text = normalizeText(value);
  if (text.includes('clay') || text.includes('terra')) return 'Clay';
  if (text.includes('grass') || text.includes('erba')) return 'Grass';
  if (text.includes('carpet')) return 'Carpet';
  if (text.includes('hard') || text.includes('cemento')) return 'Hard';
  return 'Unknown';
}
function normalizeTour(value = '') { const text = String(value || '').toUpperCase(); return text.includes('WTA') ? 'WTA' : text.includes('ATP') ? 'ATP' : 'UNKNOWN'; }
function safeJson(value) { try { return JSON.parse(value); } catch (_) { return null; } }
function toIso(value) { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
function dateKey(value) { const iso = toIso(value); return iso ? iso.slice(0,10) : null; }
function tournamentText(context = {}) { return [context.tournament, context.tournamentName, context.eventName, context.league, context.competition, context.circuit].filter(Boolean).join(' '); }

function parseCsvLine(line) {
  const out = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(value); value = ''; }
    else value += c;
  }
  out.push(value);
  return out;
}

function parseDatasetDate(raw) {
  const text = String(raw || '').replace(/\D/g, '');
  if (text.length !== 8) return null;
  const iso = `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}T12:00:00.000Z`;
  return toIso(iso);
}

function trimCache(map, max) { while (map.size > max) map.delete(map.keys().next().value); }
function cacheGet(map, key) {
  const value = map.get(key);
  if (!value) return null;
  if (value.expiresAt && Date.now() >= value.expiresAt) { map.delete(key); return null; }
  map.delete(key); map.set(key, value); return value.value;
}
function cacheSet(map, key, value, ttlMs = null) {
  map.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : null }); trimCache(map, map === h2hCache ? H2H_CACHE_MAX : WEB_CACHE_MAX); return value;
}

function datasetPaths(tour, dataDir = DEFAULT_DATA_DIR) {
  const currentYear = new Date().getUTCFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear];
  const prefix = tour === 'WTA' ? 'wta_matches_' : 'atp_matches_';
  const files = years.map(year => path.join(dataDir, `${prefix}${year}.csv`));
  if (tour === 'ATP') years.forEach(year => files.push(path.join(dataDir, `atp_matches_challenger_${year}.csv`)));
  return files.filter(file => fs.existsSync(file));
}

function loadH2HRows(tour, dataDir = DEFAULT_DATA_DIR) {
  const files = datasetPaths(tour, dataDir);
  const fingerprint = files.map(file => { const s = fs.statSync(file); return `${file}:${s.size}:${s.mtimeMs}`; }).join('|');
  const key = `${tour}|${fingerprint}`;
  const cached = cacheGet(h2hCache, key);
  if (cached) { counters.h2hCacheHits += 1; return cached; }
  counters.h2hLoads += 1;
  const rows = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) continue;
    const headers = parseCsvLine(lines[0]);
    const index = Object.fromEntries(headers.map((header, i) => [header, i]));
    for (let i = 1; i < lines.length; i += 1) {
      const values = parseCsvLine(lines[i]);
      const winner = values[index.winner_name] || '';
      const loser = values[index.loser_name] || '';
      if (!winner || !loser) continue;
      const score = String(values[index.score] || '');
      if (/\b(W\/O|WALKOVER)\b/i.test(score)) continue;
      rows.push({
        winner, loser,
        winnerKey: normalizeName(winner), loserKey: normalizeName(loser),
        surface: normalizeSurface(values[index.surface]),
        date: parseDatasetDate(values[index.tourney_date]),
        tournament: values[index.tourney_name] || null,
        round: values[index.round] || null,
        score,
        sourceFile: path.basename(file)
      });
    }
  }
  return cacheSet(h2hCache, key, { rows, files: files.map(file => path.basename(file)), fingerprint: sha(fingerprint) });
}

function buildH2H(p1Name, p2Name, options = {}) {
  const tour = normalizeTour(options.tour || options.league || options.tourType);
  const p1Key = normalizeName(p1Name); const p2Key = normalizeName(p2Name);
  const asOfIso = toIso(options.asOf || options.matchDate || options.commence_time || new Date().toISOString());
  const asOfMs = asOfIso ? new Date(asOfIso).getTime() : Date.now();
  const surface = normalizeSurface(options.surface);
  if (!p1Key || !p2Key || tour === 'UNKNOWN') return { version: H2H_VERSION, status: 'UNRESOLVED_INPUT', success: false, contextOnly: true, probabilityAdjustmentPp: 0 };
  const loaded = loadH2HRows(tour, options.dataDir || DEFAULT_DATA_DIR);
  const matches = loaded.rows.filter(row => {
    const pair = (row.winnerKey === p1Key && row.loserKey === p2Key) || (row.winnerKey === p2Key && row.loserKey === p1Key);
    if (!pair) return false;
    if (row.date && new Date(row.date).getTime() >= asOfMs) return false;
    return true;
  }).sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
  const summarize = rows => {
    let p1Wins = 0; let p2Wins = 0;
    for (const row of rows) { if (row.winnerKey === p1Key) p1Wins += 1; else if (row.winnerKey === p2Key) p2Wins += 1; }
    return { matches: rows.length, p1Wins, p2Wins, p1Rate: rows.length ? round(p1Wins / rows.length, 4) : null };
  };
  const overall = summarize(matches);
  const surfaceRows = surface === 'Unknown' ? [] : matches.filter(row => row.surface === surface);
  const onSurface = summarize(surfaceRows);
  const cutoff = asOfMs - 730 * 86400000;
  const recent = summarize(matches.filter(row => row.date && new Date(row.date).getTime() >= cutoff));
  return {
    version: H2H_VERSION,
    status: matches.length ? 'VERIFIED_LOCAL_STRUCTURED' : 'NO_MEETINGS',
    success: matches.length > 0,
    source: 'LOCAL_STRUCTURED_CSV',
    sourceFiles: loaded.files,
    datasetFingerprint: loaded.fingerprint,
    tour,
    surface,
    asOf: asOfIso,
    p1Name,
    p2Name,
    overall,
    onSurface,
    recent730d: recent,
    meetings: matches.slice(0, 10).map(row => ({ date: row.date, winner: row.winner, loser: row.loser, surface: row.surface, tournament: row.tournament, round: row.round, score: row.score })),
    contextOnly: false,
    probabilityAuthority: 'BOUNDED_DEEPSCAN_ONLY',
    maxProbabilityAdjustmentPp: 2.5,
    settlementAuthority: false,
    stakeAuthority: false
  };
}

function h2hAdjustment(h2h, predictedSide = '1') {
  if (!h2h || !h2h.success || h2h.overall.matches < 2) return { adjustmentPp: 0, status: 'INSUFFICIENT_H2H_SAMPLE', sample: h2h?.overall?.matches || 0 };
  const side = String(predictedSide) === '2' ? 2 : 1;
  const wins = side === 1 ? h2h.overall.p1Wins : h2h.overall.p2Wins;
  const n = h2h.overall.matches;
  const priorStrength = 4;
  const shrunkenRate = (wins + priorStrength / 2) / (n + priorStrength);
  let adjustment = (shrunkenRate - 0.5) * 10;
  if (h2h.onSurface.matches >= 2) {
    const surfaceWins = side === 1 ? h2h.onSurface.p1Wins : h2h.onSurface.p2Wins;
    const surfaceRate = (surfaceWins + 1.5) / (h2h.onSurface.matches + 3);
    adjustment = adjustment * 0.7 + (surfaceRate - 0.5) * 10 * 0.3;
  }
  const weighted = tennisH2HWeightPolicyPatch40.apply(adjustment, n);
  return {
    adjustmentPp: round(weighted.adjustmentPp, 2),
    rawAdjustmentPp: round(weighted.rawAdjustmentPp, 2),
    status: 'BAYES_SHRUNK_BOUNDED',
    sample: n,
    wins,
    losses: n - wins,
    shrunkenRate: round(shrunkenRate, 4),
    maxAbsPp: weighted.capPp,
    weightPolicyVersion: weighted.version,
    samplePolicyStatus: weighted.status,
    noStakeAuthority: true
  };
}

function resolveVenue(context = {}) {
  return tennisVenueRegistryPatch39.resolveVenue(context);
}


function assertAllowedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`EXTERNAL_HOST_NOT_ALLOWED:${url.hostname}`);
  return url;
}

async function fetchBounded(url, options = {}) {
  const parsed = assertAllowedUrl(url);
  const timeoutMs = finite(options.timeoutMs, HTTP_TIMEOUT_MS);
  const accept = options.accept || 'text/html,application/json;q=0.9,*/*;q=0.5';
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'BettingApp-Tennis-Research/1.0 (+local-audit; no-automation-bypass)',
        'Accept': accept,
        'Accept-Encoding': 'gzip, deflate',
        ...(options.headers || {})
      }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        try {
          const next = new URL(response.headers.location, parsed).toString();
          fetchBounded(next, options).then(resolve, reject);
        } catch (error) { reject(error); }
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); reject(new Error(`HTTP_${response.statusCode}`)); return; }
      let stream = response;
      const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
      if (encoding.includes('gzip')) stream = response.pipe(zlib.createGunzip());
      else if (encoding.includes('deflate')) stream = response.pipe(zlib.createInflate());
      const chunks = []; let bytes = 0;
      stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > HTTP_MAX_BYTES) { request.destroy(new Error('HTTP_MAX_BYTES_EXCEEDED')); return; }
        chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = raw;
        if ((options.responseType === 'json' || accept.includes('application/json'))) { try { data = JSON.parse(raw); } catch (_) {} }
        resolve({ status: response.statusCode, headers: response.headers, data });
      });
    });
    request.on('timeout', () => request.destroy(new Error('HTTP_TIMEOUT')));
    request.on('error', reject);
  });
}

async function withWebCache(key, ttlMs, task) {
  const cached = cacheGet(webCache, key);
  if (cached) { counters.webCacheHits += 1; return { ...cached, cacheHit: true }; }
  if (webInFlight.has(key)) { counters.singleFlightHits += 1; return webInFlight.get(key); }
  const promise = Promise.resolve().then(task).then(value => cacheSet(webCache, key, value, ttlMs)).finally(() => webInFlight.delete(key));
  webInFlight.set(key, promise);
  return promise;
}

function stripHtml(html = '') { return String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }

function extractRankEvidenceFromHtml(html, playerName) {
  const target = normalizeName(playerName);
  if (!target) return { rank: null, verified: false, parserConfidence: 0, method: 'EMPTY_PLAYER' };
  const raw = String(html || '');
  const escaped = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const jsonWindows = raw.match(new RegExp(`.{0,240}${escaped}.{0,240}`, 'gi')) || [];
  for (const window of jsonWindows) {
    const jsonRank = window.match(/(?:\"rank\"|\"ranking\"|data-rank)\s*[:=]\s*[\"']?([1-9]\d{0,3})/i);
    if (jsonRank) { const rank=Number(jsonRank[1]); if(rank<=1500)return {rank,verified:true,parserConfidence:0.98,method:'STRUCTURED_JSON_OR_ATTRIBUTE'}; }
  }
  const rows = raw.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    if (!normalizeName(stripHtml(row)).includes(target)) continue;
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>stripHtml(m[1]));
    const nameIndex=cells.findIndex(cell=>normalizeName(cell).includes(target));
    if(nameIndex<0)continue;
    const candidates=[];
    for(let idx=Math.max(0,nameIndex-2);idx<=Math.min(cells.length-1,nameIndex+2);idx++){
      const match=String(cells[idx]).match(/^#?\s*([1-9]\d{0,3})\s*$/);if(match)candidates.push({rank:Number(match[1]),distance:Math.abs(idx-nameIndex)});
    }
    candidates.sort((a,b)=>a.distance-b.distance||a.rank-b.rank);
    if(candidates.length&&candidates[0].rank<=1500)return {rank:candidates[0].rank,verified:true,parserConfidence:0.9,method:'RANKING_TABLE_ROW'};
  }
  return { rank: null, verified: false, parserConfidence: 0, method: 'OFFICIAL_PAGE_UNPARSED' };
}
function extractRankFromHtml(html, playerName) { return extractRankEvidenceFromHtml(html, playerName).rank; }

async function fetchOfficialRankings(tour, playerNames = [], options = {}) {
  const normalizedTour = normalizeTour(tour);
  const source = normalizedTour === 'WTA' ? SOURCE_REGISTRY.WTA_OFFICIAL_RANKINGS : SOURCE_REGISTRY.ATP_OFFICIAL_RANKINGS;
  if (!['ATP','WTA'].includes(normalizedTour)) return { version: WEB_VERSION, sourceId: null, status: 'UNRESOLVED_TOUR', players: [] };
  const names = Array.from(new Set(playerNames.filter(Boolean)));
  const key = `ranking:${normalizedTour}:${names.map(normalizeName).sort().join('|')}`;
  return withWebCache(key, RANKING_TTL_MS, async () => {
    counters.rankingFetches += 1;
    try {
      const response = await fetchBounded(source.url, { timeoutMs: options.timeoutMs });
      const players = names.map(name => ({ name, ...extractRankEvidenceFromHtml(response.data, name) }));
      return {
        version: WEB_VERSION,
        sourceId: source.sourceId,
        sourceUrl: source.url,
        sourceTier: 'OFFICIAL_TOUR',
        status: players.every(player => player.verified) ? 'OFFICIAL_VERIFIED' : players.some(player => player.verified) ? 'OFFICIAL_PARTIAL' : 'OFFICIAL_PAGE_UNPARSED',
        fetchedAt: new Date().toISOString(),
        httpStatus: response.status,
        players,
        authority: 'OFFICIAL_CONTEXT_ONLY',
        probabilityAuthority: false,
        stakeAuthority: false,
        settlementAuthority: false
      };
    } catch (error) {
      counters.webFailures += 1;
      return { version: WEB_VERSION, sourceId: source.sourceId, sourceUrl: source.url, sourceTier: 'OFFICIAL_TOUR', status: 'FETCH_FAILED', error: error.message, players: names.map(name => ({ name, rank: null })), authority: 'CONTEXT_ONLY', probabilityAuthority: false, stakeAuthority: false, settlementAuthority: false };
    }
  });
}

function weatherRisk(hour = {}) {
  const temp = finite(hour.temperatureC);
  const humidity = finite(hour.humidityPct);
  const rain = finite(hour.precipitationProbabilityPct);
  const wind = finite(hour.windKph);
  const gust = finite(hour.gustKph);
  let score = 0; const reasons = [];
  if (temp !== null && temp >= 36) { score += 35; reasons.push('HEAT_EXTREME'); }
  else if (temp !== null && temp >= 32) { score += 22; reasons.push('HEAT_HIGH'); }
  else if (temp !== null && temp <= 7) { score += 10; reasons.push('COLD'); }
  if (humidity !== null && humidity >= 80 && temp !== null && temp >= 28) { score += 12; reasons.push('HUMID_HEAT'); }
  if (wind !== null && wind >= 30) { score += 25; reasons.push('WIND_HIGH'); }
  else if (wind !== null && wind >= 20) { score += 12; reasons.push('WIND_MODERATE'); }
  if (gust !== null && gust >= 45) { score += 18; reasons.push('GUST_HIGH'); }
  if (rain !== null && rain >= 70) { score += 25; reasons.push('RAIN_LIKELY'); }
  else if (rain !== null && rain >= 40) { score += 12; reasons.push('RAIN_RISK'); }
  score = clamp(score, 0, 100);
  return { score: round(score, 1), reasons, confidencePenalty: round(Math.min(8, score * 0.06), 2), probabilityAuthority: false, stakeAuthority: false };
}

async function fetchWeather(context = {}, options = {}) {
  const venue = resolveVenue(context);
  if (venue.status === 'INDOOR_NO_WEATHER') return { version: WEB_VERSION, sourceId: 'OPEN_METEO_FORECAST', status: 'NOT_APPLICABLE_INDOOR', venue, risk: weatherRisk({}) };
  if (!String(venue.status || '').startsWith('RESOLVED')) return { version: WEB_VERSION, sourceId: 'OPEN_METEO_FORECAST', status: venue.status || 'VENUE_UNRESOLVED', venue, risk: weatherRisk({}), authority: 'NO_AUTHORITY' };
  const matchIso = toIso(context.commence_time || context.match_date || context.date || context.startTime);
  if (!matchIso) return { version: WEB_VERSION, sourceId: 'OPEN_METEO_FORECAST', status: 'MATCH_TIME_UNRESOLVED', venue, risk: weatherRisk({}) };
  const startDate = matchIso.slice(0,10);
  const key = `weather:${venue.id}:${matchIso.slice(0,13)}`;
  return withWebCache(key, WEATHER_TTL_MS, async () => {
    counters.weatherFetches += 1;
    const params = new URLSearchParams({
      latitude: String(venue.latitude), longitude: String(venue.longitude),
      hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m',
      timezone: 'UTC', start_date: startDate, end_date: startDate,
      wind_speed_unit: 'kmh'
    });
    const url = `${SOURCE_REGISTRY.OPEN_METEO_FORECAST.url}?${params.toString()}`;
    try {
      const response = await fetchBounded(url, { accept: 'application/json', responseType: 'json', timeoutMs: options.timeoutMs });
      const hourly = response.data?.hourly || {};
      const targetMs = new Date(matchIso).getTime();
      let bestIndex = -1; let bestDistance = Infinity;
      (hourly.time || []).forEach((time, index) => { const distance = Math.abs(new Date(`${time}Z`).getTime() - targetMs); if (distance < bestDistance) { bestDistance = distance; bestIndex = index; } });
      if (bestIndex < 0 || bestDistance > 2 * 60 * 60 * 1000) return { version: WEB_VERSION, sourceId: 'OPEN_METEO_FORECAST', status: 'FORECAST_HOUR_UNRESOLVED', venue, fetchedAt: new Date().toISOString(), risk: weatherRisk({}), attribution: 'Weather data by Open-Meteo.com' };
      const hour = {
        timeUtc: `${hourly.time[bestIndex]}Z`,
        temperatureC: finite(hourly.temperature_2m?.[bestIndex]),
        humidityPct: finite(hourly.relative_humidity_2m?.[bestIndex]),
        precipitationProbabilityPct: finite(hourly.precipitation_probability?.[bestIndex]),
        windKph: finite(hourly.wind_speed_10m?.[bestIndex]),
        gustKph: finite(hourly.wind_gusts_10m?.[bestIndex])
      };
      return { version: WEB_VERSION, sourceId: 'OPEN_METEO_FORECAST', sourceUrl: SOURCE_REGISTRY.OPEN_METEO_FORECAST.url, status: 'FORECAST_RESOLVED', venue, matchTimeUtc: matchIso, fetchedAt: new Date().toISOString(), httpStatus: response.status, hour, risk: weatherRisk(hour), attribution: 'Weather data by Open-Meteo.com', authority: 'CONTEXT_AND_CONFIDENCE_ONLY', probabilityAuthority: false, stakeAuthority: false, settlementAuthority: false };
    } catch (error) {
      counters.webFailures += 1;
      return { version: WEB_VERSION, sourceId: 'OPEN_METEO_FORECAST', sourceUrl: SOURCE_REGISTRY.OPEN_METEO_FORECAST.url, status: 'FETCH_FAILED', venue, matchTimeUtc: matchIso, error: error.message, risk: weatherRisk({}), attribution: 'Weather data by Open-Meteo.com', authority: 'CONTEXT_ONLY', probabilityAuthority: false, stakeAuthority: false, settlementAuthority: false };
    }
  });
}

function certifyEventIdentity(input = {}, context = {}, p1Name = '', p2Name = '') {
  const eventFingerprint = context.tennis_event_fingerprint || context.tennis_canonical_match_key || context.provider_event_id || context.eventFingerprint || input.eventFingerprint || null;
  const matchTime = toIso(context.canonical_event_time_safety_utc || context.canonical_match_datetime || context.commence_time || context.match_date || context.date);
  const tournamentId = context.tournament_catalog_id || context.canonical_tournament_key || context.tournament_canonical_name || context.tournament_name || context.tournamentName || context.tournament || context.league || null;
  const players = Boolean(normalizeName(p1Name) && normalizeName(p2Name));
  const certified = players && Boolean(eventFingerprint) && Boolean(matchTime) && Boolean(tournamentId);
  return {
    version: 'TENNIS_EVENT_IDENTITY_QUORUM_V1_PATCH39',
    certified,
    players,
    eventFingerprint,
    matchTime,
    tournamentId,
    status: certified ? 'CERTIFIED_EVENT_IDENTITY' : 'ABSTAIN_AMBIGUOUS_EVENT_IDENTITY',
    missing: [!players && 'PLAYERS', !eventFingerprint && 'EVENT_FINGERPRINT', !matchTime && 'MATCH_TIME', !tournamentId && 'TOURNAMENT_ID'].filter(Boolean),
    webSearchAuthority: certified ? 'EVENT_AWARE_ONLY' : 'ABSTAIN',
    settlementAuthority: false
  };
}

function rankingConflict(localRanks = {}, official = {}, eventIdentity = {}) {
  const players = official?.players || [];
  const result = [];
  const identityCertified = eventIdentity?.certified === undefined ? true : eventIdentity?.certified === true;
  const sourceStatus = String(official?.status || '').toUpperCase();
  const sourceFullyVerified = sourceStatus ? sourceStatus === 'OFFICIAL_VERIFIED' : players.length > 0 && players.every(player => player?.verified === true && Number(player?.parserConfidence || 0) >= 0.8);
  for (const [side, local] of Object.entries(localRanks)) {
    const name = local?.name;
    const officialPlayer = players.find(player => normalizeName(player.name) === normalizeName(name));
    const parserVerified = officialPlayer?.verified === true && Number(officialPlayer?.parserConfidence || 0) >= 0.8;
    const authoritative = identityCertified && sourceFullyVerified && parserVerified;
    const officialRank = authoritative ? finite(officialPlayer?.rank) : null;
    const localRank = finite(local?.rank);
    const delta = officialRank !== null && localRank !== null ? Math.abs(officialRank - localRank) : null;
    result.push({ side, name, localRank, officialRank, verified: authoritative, displayVerified: parserVerified, eventIdentityCertified: identityCertified, parserConfidence: Number(officialPlayer?.parserConfidence || 0), extractionMethod: officialPlayer?.method || null, delta, conflict: authoritative && delta !== null && delta >= 25 });
  }
  const maxDelta = Math.max(0, ...result.map(row => row.delta || 0));
  const conflict = result.some(row => row.conflict);
  return { players: result, conflict, maxDelta, confidencePenalty: conflict ? Math.min(6, 1 + maxDelta / 25) : 0, probabilityAuthority: false, confidencePenaltyAuthority: identityCertified && sourceFullyVerified, unverifiedRankingDisplayOnly: !identityCertified || !sourceFullyVerified };
}

function evaluateSourceCoverage(input = {}) {
  const h2hResolved = ['VERIFIED_LOCAL_STRUCTURED','INSUFFICIENT_SAMPLE','NO_MEETINGS'].includes(String(input.h2h?.status || '').toUpperCase()) || input.h2h?.success === true;
  const identityCertified = input.eventIdentity?.certified === true;
  const rankingStatus = String(input.officialRankings?.status || '').toUpperCase();
  const rankingVerified = identityCertified && rankingStatus === 'OFFICIAL_VERIFIED' && (input.officialRankings?.players || []).every(player => player?.verified === true && Number(player?.parserConfidence || 0) >= 0.8);
  const weatherStatus = String(input.weather?.status || '').toUpperCase();
  const venueStatus = String(input.weather?.venue?.status || '').toUpperCase();
  const weatherResolved = weatherStatus === 'NOT_APPLICABLE_INDOOR' || (weatherStatus === 'FORECAST_RESOLVED' && venueStatus.startsWith('RESOLVED'));
  const resolvedCount = [h2hResolved, rankingVerified, weatherResolved].filter(Boolean).length;
  return { status: resolvedCount === 3 ? 'COMPLETE' : resolvedCount >= 1 ? 'PARTIAL' : 'DEGRADED', complete: resolvedCount === 3, resolvedCount, expectedCount: 3, eventIdentityCertified: identityCertified, h2hResolved, rankingVerified, weatherResolved, rankingDisplayOnly: !rankingVerified, probabilityAuthority: false, stakeAuthority: false };
}

function buildChallenger(input = {}) {
  const h2h = input.h2h || {};
  const h2hDecision = input.h2hDecision || { adjustmentPp: 0 };
  const weather = input.weather || {};
  const ranking = input.rankingComparison || {};
  const evidenceScore = clamp(
    (h2h.success ? Math.min(35, 10 + h2h.overall.matches * 5) : 0) +
    (input.sourceCoverage?.rankingVerified === true ? 30 : 0) +
    (weather.status === 'FORECAST_RESOLVED' ? 25 : weather.status === 'NOT_APPLICABLE_INDOOR' ? 15 : 0) +
    (input.sourceReceiptComplete ? 10 : 0), 0, 100);
  const weatherPenalty = input.sourceCoverage?.weatherResolved === true ? (weather.risk?.confidencePenalty || 0) : 0;
  const rankingPenalty = input.sourceCoverage?.rankingVerified === true ? (ranking.confidencePenalty || 0) : 0;
  const confidencePenalty = round(weatherPenalty + rankingPenalty, 2);
  return {
    version: CHALLENGER_VERSION,
    mode: 'SHADOW_CONTEXT_NO_AUTOMATIC_PROMOTION',
    evidenceScore: round(evidenceScore, 1),
    h2hAdjustmentPp: h2hDecision.adjustmentPp || 0,
    confidencePenalty,
    suggestedProbabilityDeltaPp: h2hDecision.adjustmentPp || 0,
    promotionAuthority: false,
    stakeAuthority: false,
    qualityGateAuthority: false,
    settlementAuthority: false,
    reason: evidenceScore >= 60 ? 'MULTI_SOURCE_CONTEXT_AVAILABLE' : 'PARTIAL_CONTEXT_ONLY'
  };
}

async function buildExternalMatchIntelligence(input = {}, options = {}) {
  const context = input.context || input.matchContext || input;
  const p1Name = input.p1Name || input.player1 || input.home;
  const p2Name = input.p2Name || input.player2 || input.away;
  const tour = normalizeTour(input.tour || context.tour || context.league || context.tourType);
  const surface = normalizeSurface(input.surface || context.surface || context.courtSurface);
  const eventIdentity = certifyEventIdentity(input, context, p1Name, p2Name);
  const h2h = buildH2H(p1Name, p2Name, { tour, surface, asOf: context.commence_time || context.match_date || context.date, dataDir: options.dataDir });
  const h2hDecision = h2hAdjustment(h2h, input.prediction || context.prediction || '1');
  const localRanks = input.localRanks || {};
  const [officialRankings, weather] = await Promise.all([
    options.skipNetwork ? Promise.resolve({ version: WEB_VERSION, sourceId: tour === 'WTA' ? 'WTA_OFFICIAL_RANKINGS' : 'ATP_OFFICIAL_RANKINGS', status: 'NETWORK_SKIPPED', players: [p1Name,p2Name].map(name => ({ name, rank: null })), authority: 'CONTEXT_ONLY' }) : fetchOfficialRankings(tour, [p1Name,p2Name], options),
    options.skipNetwork ? Promise.resolve({ version: WEB_VERSION, sourceId: 'OPEN_METEO_FORECAST', status: 'NETWORK_SKIPPED', venue: resolveVenue(context), risk: weatherRisk({}), authority: 'CONTEXT_ONLY' }) : fetchWeather(context, options)
  ]);
  officialRankings.eventIdentityCertified = eventIdentity.certified;
  const rankingComparison = rankingConflict(localRanks, officialRankings, eventIdentity);
  const sourceCoverage = evaluateSourceCoverage({ eventIdentity, h2h, officialRankings, weather });
  const sourceReceiptComplete = sourceCoverage.complete;
  const challenger = buildChallenger({ h2h, h2hDecision, officialRankings, weather, rankingComparison, sourceCoverage, sourceReceiptComplete });
  const generatedAt = new Date().toISOString();
  const result = {
    version: VERSION,
    receiptSchemaVersion: RECEIPT_SCHEMA_VERSION,
    generatedAt,
    match: { p1Name, p2Name, prediction: String(input.prediction || ''), tour, surface, tournament: tournamentText(context), commenceTime: toIso(context.commence_time || context.match_date || context.date) },
    eventIdentity,
    h2h,
    h2hDecision,
    officialRankings,
    rankingComparison,
    weather,
    sourceCoverage,
    challenger,
    authority: {
      h2hProbabilityAdjustment: 'BOUNDED_DEEPSCAN_ONLY',
      officialRanking: 'CONTEXT_ONLY',
      weather: 'CONFIDENCE_ONLY',
      productionModel: false,
      finalStake: false,
      qualityGate: false,
      settlement: false,
      automaticPromotion: false
    },
    sourceRegistryVersion: WEB_VERSION,
    sourceIds: ['LOCAL_STRUCTURED_H2H', officialRankings.sourceId, weather.sourceId].filter(Boolean)
  };
  result.receiptHash = sha(result);
  return result;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tennis_external_intelligence_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id TEXT NOT NULL UNIQUE,
      bet_id INTEGER,
      event_key TEXT,
      generated_at TEXT NOT NULL,
      version TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      h2h_status TEXT,
      h2h_sample INTEGER,
      h2h_adjustment_pp REAL,
      ranking_status TEXT,
      weather_status TEXT,
      weather_risk_score REAL,
      challenger_evidence_score REAL,
      challenger_confidence_penalty REAL,
      payload_json TEXT NOT NULL,
      previous_hash TEXT,
      receipt_hash TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_tennis_external_intelligence_bet ON tennis_external_intelligence_receipts(bet_id, generated_at);
    CREATE INDEX IF NOT EXISTS idx_tennis_external_intelligence_event ON tennis_external_intelligence_receipts(event_key, generated_at);
    CREATE TABLE IF NOT EXISTS tennis_external_challenger_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      generated_at TEXT NOT NULL,
      mode TEXT NOT NULL,
      rows_evaluated INTEGER NOT NULL DEFAULT 0,
      promoted INTEGER NOT NULL DEFAULT 0,
      report_json TEXT NOT NULL,
      report_hash TEXT NOT NULL UNIQUE
    );
    CREATE TRIGGER IF NOT EXISTS trg_tennis_external_receipts_no_update BEFORE UPDATE ON tennis_external_intelligence_receipts BEGIN SELECT RAISE(ABORT,'TENNIS_EXTERNAL_INTELLIGENCE_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_external_receipts_no_delete BEFORE DELETE ON tennis_external_intelligence_receipts BEGIN SELECT RAISE(ABORT,'TENNIS_EXTERNAL_INTELLIGENCE_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_external_challenger_no_update BEFORE UPDATE ON tennis_external_challenger_runs BEGIN SELECT RAISE(ABORT,'TENNIS_EXTERNAL_CHALLENGER_APPEND_ONLY'); END;
    CREATE TRIGGER IF NOT EXISTS trg_tennis_external_challenger_no_delete BEFORE DELETE ON tennis_external_challenger_runs BEGIN SELECT RAISE(ABORT,'TENNIS_EXTERNAL_CHALLENGER_APPEND_ONLY'); END;
  `);
}

function eventKey(row = {}, intelligence = {}) {
  return row.tennis_canonical_match_key || row.tennis_event_fingerprint || sha(`${normalizeName(row.home_team || intelligence.match?.p1Name)}|${normalizeName(row.away_team || intelligence.match?.p2Name)}|${row.match_date || intelligence.match?.commenceTime || ''}`).slice(0,32);
}

function persistReceipt(db, row = {}, intelligence = {}) {
  if (!db || typeof db.prepare !== 'function' || !intelligence || intelligence.version !== VERSION) return null;
  createSchema(db);
  const key = eventKey(row, intelligence);
  const latest = db.prepare('SELECT * FROM tennis_external_intelligence_receipts WHERE event_key = ? ORDER BY id DESC LIMIT 1').get(key) || null;
  if (latest?.payload_json) {
    try {
      const previousPayload = JSON.parse(latest.payload_json);
      const previousComparable = { ...previousPayload }; delete previousComparable.previousReceiptHash;
      if (sha(previousComparable) === sha(intelligence)) return latest;
    } catch (_) {}
  }
  const previous = latest?.receipt_hash || null;
  const canonical = { ...intelligence, previousReceiptHash: previous };
  const receiptHash = sha(canonical);
  const receiptId = `TEI37_${Number(row.id || 0)}_${receiptHash.slice(0,16)}`;
  const existing = db.prepare('SELECT * FROM tennis_external_intelligence_receipts WHERE receipt_id = ?').get(receiptId);
  if (existing) return existing;
  db.prepare(`INSERT INTO tennis_external_intelligence_receipts (
    receipt_id, bet_id, event_key, generated_at, version, source_ids_json,
    h2h_status, h2h_sample, h2h_adjustment_pp, ranking_status, weather_status,
    weather_risk_score, challenger_evidence_score, challenger_confidence_penalty,
    payload_json, previous_hash, receipt_hash
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    receiptId, row.id || null, key, intelligence.generatedAt || new Date().toISOString(), VERSION,
    JSON.stringify(intelligence.sourceIds || []), intelligence.h2h?.status || null,
    intelligence.h2h?.overall?.matches || 0, intelligence.h2hDecision?.adjustmentPp || 0,
    intelligence.officialRankings?.status || null, intelligence.weather?.status || null,
    intelligence.weather?.risk?.score || 0, intelligence.challenger?.evidenceScore || 0,
    intelligence.challenger?.confidencePenalty || 0, JSON.stringify(canonical), previous, receiptHash
  );
  return db.prepare('SELECT * FROM tennis_external_intelligence_receipts WHERE receipt_id = ?').get(receiptId);
}

function sourceHealth() {
  return {
    version: VERSION,
    h2hVersion: H2H_VERSION,
    webVersion: WEB_VERSION,
    receiptSchemaVersion: RECEIPT_SCHEMA_VERSION,
    challengerVersion: CHALLENGER_VERSION,
    allowedHosts: [...ALLOWED_HOSTS],
    sources: SOURCE_REGISTRY,
    venues: tennisVenueRegistryPatch39.VENUES.length,
    venueRegistry: tennisVenueRegistryPatch39.health(),
    cache: { h2hEntries: h2hCache.size, webEntries: webCache.size, webInFlight: webInFlight.size },
    counters: { ...counters },
    maxH2hAdjustmentPp: 2.5,
    h2hSampleWeightPolicy: tennisH2HWeightPolicyPatch40.POLICY,
    officialRankingProbabilityAuthority: false,
    weatherProbabilityAuthority: false,
    weatherStakeAuthority: false,
    rankingPenaltyRequiresEventIdentity: true,
    unverifiedRankingDisplayOnly: true,
    automaticPromotion: false
  };
}

function resetCaches() { h2hCache.clear(); webCache.clear(); webInFlight.clear(); Object.keys(counters).forEach(key => { counters[key] = 0; }); }

module.exports = {
  VERSION, H2H_VERSION, WEB_VERSION, RECEIPT_SCHEMA_VERSION, CHALLENGER_VERSION,
  SOURCE_REGISTRY, VENUES, ALLOWED_HOSTS,
  normalizeName, normalizeSurface, normalizeTour, parseCsvLine, buildH2H, h2hAdjustment,
  resolveVenue, assertAllowedUrl, extractRankEvidenceFromHtml, extractRankFromHtml, fetchOfficialRankings, weatherRisk, fetchWeather,
  certifyEventIdentity, rankingConflict, evaluateSourceCoverage, buildChallenger, buildExternalMatchIntelligence,
  createSchema, persistReceipt, sourceHealth, resetCaches
};
