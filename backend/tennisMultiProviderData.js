'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const TENNIS_MULTI_PROVIDER_VERSION = 'TENNIS_MULTI_PROVIDER_DATA_V2_PATCH36';
const TENNIS_MULTI_PROVIDER_REGISTRY_VERSION = 'TENNIS_MULTI_PROVIDER_REGISTRY_V2_PATCH36';
const TENNIS_MULTI_PROVIDER_MANIFEST_VERSION = 'TENNIS_MULTI_PROVIDER_MANIFEST_V1_PATCH21';
const TENNIS_MULTI_PROVIDER_POLICY_VERSION = 'TENNIS_MULTI_PROVIDER_POLICY_V2_PATCH36';
const AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_REVISION = 'AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_AND_RECURRING_REFRESH_V1';
const AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION = 'AUDIT16D_R3_T2_R1_REFRESH_LOCK_OWNERSHIP_RECOVERY_V1';
const PATCH21_LOCK_STALE_MS = 30 * 60 * 1000;
const MANIFEST_FILE = 'tennis_multi_provider_manifest.json';
const FAILURE_FILE = 'tennis_multi_provider_last_failure.json';
const USAGE_FILE = 'tennis_provider_api_usage.json';
const CACHE_DIR = '.tennis_provider_cache';
const LOCK_FILE = '.patch21_multi_provider.lock';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const DEFAULT_API_DAILY_BUDGET = 2;
const DEFAULT_BULK_CACHE_HOURS = 6;
const DEFAULT_API_CACHE_HOURS = 12;
const DEFAULT_GITHUB_CACHE_HOURS = 6;
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const ALLOWED_NETWORK_HOSTS = new Set(['stats.tennismylife.org', 'api.api-tennis.com']);
const CANONICAL_HEADERS = Object.freeze([
  'tourney_id','tourney_name','surface','draw_size','tourney_level','tourney_date','match_num',
  'winner_id','winner_seed','winner_entry','winner_name','winner_hand','winner_ht','winner_ioc','winner_age',
  'loser_id','loser_seed','loser_entry','loser_name','loser_hand','loser_ht','loser_ioc','loser_age',
  'score','best_of','round','minutes','w_ace','w_df','w_svpt','w_1stIn','w_1stWon','w_2ndWon','w_SvGms','w_bpSaved','w_bpFaced',
  'l_ace','l_df','l_svpt','l_1stIn','l_1stWon','l_2ndWon','l_SvGms','l_bpSaved','l_bpFaced',
  'winner_rank','winner_rank_points','loser_rank','loser_rank_points'
]);

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function finite(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function round(value, decimals = 2) { const n = finite(value, 0); return Number(n.toFixed(decimals)); }
function nowIso(now = new Date()) { const d = now instanceof Date ? now : new Date(now); return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString(); }
function safeIso(now = new Date()) { return nowIso(now).replace(/[:.]/g, '-'); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function writeJsonAtomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.tmp-${process.pid}-${Date.now()}`; fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8'); fs.renameSync(temp, file); }
function splitCsvLine(line) {
  const values = []; let current = ''; let quoted = false;
  for (let i = 0; i < String(line || '').length; i += 1) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i += 1; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { values.push(current); current = ''; }
    else current += ch;
  }
  values.push(current); return values;
}
function csvEscape(value) { const s = value === null || value === undefined ? '' : String(value); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '');
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map(value => String(value || '').trim());
  const rows = lines.slice(1).map(line => { const values = splitCsvLine(line); return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])); });
  return { headers, rows };
}
function serializeCanonical(rows) { return `${CANONICAL_HEADERS.join(',')}\n${rows.map(row => CANONICAL_HEADERS.map(h => csvEscape(row[h] ?? '')).join(',')).join('\n')}\n`; }
function normalizeHeaderKey(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function pick(row, ...keys) {
  const byKey = new Map(Object.entries(row || {}).map(([k, v]) => [normalizeHeaderKey(k), v]));
  for (const key of keys) { const value = byKey.get(normalizeHeaderKey(key)); if (value !== undefined && value !== null && String(value).trim() !== '') return value; }
  return '';
}
function parseFlexibleDate(value) {
  const raw = String(value || '').trim();
  let m = raw.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  m = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[3]}${String(m[2]).padStart(2,'0')}${String(m[1]).padStart(2,'0')}`;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}` : '';
}
function normalizeRound(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (/FINAL$/.test(raw) && !/SEMI|QUARTER/.test(raw)) return 'F';
  if (/SEMI|1\/2/.test(raw)) return 'SF';
  if (/QUARTER|1\/4/.test(raw)) return 'QF';
  if (/1\/8|ROUND OF 16|R16/.test(raw)) return 'R16';
  if (/1\/16|ROUND OF 32|R32/.test(raw)) return 'R32';
  if (/1\/32|ROUND OF 64|R64/.test(raw)) return 'R64';
  if (/1\/64|ROUND OF 128|R128/.test(raw)) return 'R128';
  if (/QUAL/.test(raw)) return 'Q1';
  return raw.replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
function inferLevel(series, tournament, eventType) {
  const text = `${series || ''} ${tournament || ''} ${eventType || ''}`.toUpperCase();
  if (/GRAND SLAM|WIMBLEDON|ROLAND GARROS|FRENCH OPEN|US OPEN|AUSTRALIAN OPEN/.test(text)) return 'G';
  if (/DAVIS|BILLIE JEAN|FED CUP/.test(text)) return 'D';
  if (/FINALS|MASTERS CUP/.test(text)) return 'F';
  if (/CHALLENGER|QUAL/.test(text)) return 'C';
  return 'A';
}
function scoreFromTennisData(row) {
  const parts = [];
  for (let set = 1; set <= 5; set += 1) {
    const w = pick(row, `W${set}`, `winner_set_${set}`); const l = pick(row, `L${set}`, `loser_set_${set}`);
    if (String(w).trim() !== '' && String(l).trim() !== '') parts.push(`${w}-${l}`);
  }
  return parts.join(' ');
}
function emptyCanonical() { return Object.fromEntries(CANONICAL_HEADERS.map(h => [h, ''])); }
function canonicalMatchKey(row) {
  return [row.tourney_id,row.tourney_date,row.match_num,row.winner_id,row.loser_id,row.winner_name,row.loser_name,row.score]
    .map(v => String(v || '').trim().toLowerCase()).join('|');
}
function normalizeCanonicalCsv(text, context = {}) {
  const parsed = parseCsv(text); const keyMap = new Map(parsed.headers.map(h => [normalizeHeaderKey(h), h]));
  const hasCore = ['tourneyname','tourneydate','winnername','losername'].every(k => keyMap.has(k));
  if (!hasCore) throw new Error(`PATCH21_CANONICAL_HEADER_INVALID:${context.providerId || 'UNKNOWN'}`);
  const rows = parsed.rows.map((source, index) => {
    const row = emptyCanonical();
    for (const header of CANONICAL_HEADERS) row[header] = pick(source, header);
    row.tourney_id = row.tourney_id || `${context.providerId || 'PROVIDER'}_${row.tourney_date || 'DATE'}_${index + 1}`;
    row.match_num = row.match_num || String(index + 1);
    row.tourney_date = parseFlexibleDate(row.tourney_date);
    row.round = normalizeRound(row.round);
    row.best_of = row.best_of || '3';
    return row;
  }).filter(row => row.tourney_date && row.winner_name && row.loser_name);
  return serializeCanonical(rows);
}
function normalizeTennisDataCsv(text, context = {}) {
  const parsed = parseCsv(text); const rows = [];
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const source = parsed.rows[index]; const winner = pick(source, 'Winner'); const loser = pick(source, 'Loser'); const date = parseFlexibleDate(pick(source, 'Date'));
    if (!winner || !loser || !date) continue;
    const row = emptyCanonical();
    row.tourney_name = pick(source, 'Tournament','Location');
    row.tourney_date = date;
    row.tourney_level = inferLevel(pick(source,'Series'), row.tourney_name, context.targetId);
    row.surface = pick(source,'Surface'); row.round = normalizeRound(pick(source,'Round'));
    row.best_of = pick(source,'Best of','BestOf') || '3';
    row.winner_name = winner; row.loser_name = loser;
    row.winner_rank = pick(source,'WRank'); row.loser_rank = pick(source,'LRank');
    row.winner_rank_points = pick(source,'WPts'); row.loser_rank_points = pick(source,'LPts');
    row.score = scoreFromTennisData(source);
    row.tourney_id = `TD_${date}_${sha256(`${row.tourney_name}|${winner}|${loser}`).slice(0,10)}`;
    row.match_num = String(index + 1);
    rows.push(row);
  }
  if (!rows.length) throw new Error(`PATCH21_TENNIS_DATA_EMPTY:${context.targetId || 'UNKNOWN'}`);
  return serializeCanonical(rows);
}
function parseApiScores(event) {
  if (Array.isArray(event?.scores) && event.scores.length) {
    return event.scores.map(item => {
      const a = item.score_first ?? item.score_first_player ?? item.first_player ?? item.score1;
      const b = item.score_second ?? item.score_second_player ?? item.second_player ?? item.score2;
      return a !== undefined && b !== undefined ? `${a}-${b}` : null;
    }).filter(Boolean).join(' ');
  }
  return String(event?.event_final_result || '').trim();
}
function apiTarget(event) {
  const type = String(event?.event_type_type || '').toUpperCase();
  if (/WTA|WOMEN/.test(type) && /SINGLES/.test(type)) return 'WTA_MAIN';
  if (/CHALLENGER MEN SINGLES/.test(type) || (String(event?.event_qualification).toLowerCase() === 'true' && /ATP|MEN/.test(type))) return 'ATP_QUAL_CHALL';
  if (/ATP SINGLES/.test(type)) return 'ATP_MAIN';
  return null;
}
function normalizeApiTennisPayload(payload, targetId, context = {}) {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!parsed || Number(parsed.success) !== 1 || !Array.isArray(parsed.result)) throw new Error('PATCH21_API_TENNIS_RESPONSE_INVALID');
  const rows = [];
  for (let index = 0; index < parsed.result.length; index += 1) {
    const event = parsed.result[index];
    if (apiTarget(event) !== targetId || String(event.event_status || '').toLowerCase() !== 'finished') continue;
    const firstWins = String(event.event_winner || '').toLowerCase().includes('first');
    const secondWins = String(event.event_winner || '').toLowerCase().includes('second');
    if (!firstWins && !secondWins) continue;
    const row = emptyCanonical();
    const firstName = String(event.event_first_player || '').trim(); const secondName = String(event.event_second_player || '').trim();
    row.winner_name = firstWins ? firstName : secondName; row.loser_name = firstWins ? secondName : firstName;
    row.winner_id = String(firstWins ? event.first_player_key || '' : event.second_player_key || '');
    row.loser_id = String(firstWins ? event.second_player_key || '' : event.first_player_key || '');
    row.tourney_name = event.tournament_name || '';
    row.tourney_id = `API_TENNIS_${event.tournament_key || 'T'}_${event.event_key || index + 1}`;
    row.tourney_date = parseFlexibleDate(event.event_date);
    row.match_num = String(event.event_key || index + 1);
    row.tourney_level = inferLevel('', row.tourney_name, event.event_type_type);
    row.round = normalizeRound(event.tournament_round);
    row.score = parseApiScores(event);
    row.best_of = row.tourney_level === 'G' && targetId === 'ATP_MAIN' ? '5' : '3';
    if (row.tourney_date && row.winner_name && row.loser_name) rows.push(row);
  }
  return serializeCanonical(rows);
}
function mergeCanonicalCsv(texts, context = {}) {
  const rows = []; const seen = new Set();
  for (const text of texts) {
    const parsed = parseCsv(normalizeCanonicalCsv(text, context));
    for (const source of parsed.rows) { const row = emptyCanonical(); for (const h of CANONICAL_HEADERS) row[h] = source[h] ?? ''; const key = canonicalMatchKey(row); if (!seen.has(key)) { seen.add(key); rows.push(row); } }
  }
  rows.sort((a,b) => String(a.tourney_date).localeCompare(String(b.tourney_date)) || String(a.match_num).localeCompare(String(b.match_num)));
  return serializeCanonical(rows);
}
function currentYear(now = new Date()) { const d = now instanceof Date ? now : new Date(now); return Number.isFinite(d.getTime()) ? d.getUTCFullYear() : new Date().getUTCFullYear(); }
function isApiEnabled(value) { return value === true || String(value ?? '').trim() === '1'; }
function targetRegistry(year = currentYear()) {
  return Object.freeze([
    Object.freeze({ id:'ATP_MAIN', tour:'ATP', localFile:`atp_matches_${year}.csv`, minRows:500 }),
    Object.freeze({ id:'ATP_QUAL_CHALL', tour:'ATP', localFile:`atp_matches_challenger_${year}.csv`, minRows:900 }),
    Object.freeze({ id:'WTA_MAIN', tour:'WTA', localFile:`wta_matches_${year}.csv`, minRows:500 })
  ]);
}
function providerRegistry(options = {}) {
  const apiKeyPresent = Boolean(String(options.apiKey ?? process.env.API_TENNIS_KEY ?? '').trim());
  const apiEnabled = isApiEnabled(options.apiEnabled ?? process.env.TENNIS_API_PROVIDER_ENABLED ?? '0');
  return Object.freeze([
    Object.freeze({ id:'LOCAL_CANONICAL_IMPORT', priority:0, costClass:'ZERO', access:'LOCAL', apiKeyRequired:false, enabled:true, supports:['ATP_MAIN','ATP_QUAL_CHALL','WTA_MAIN'], authority:'DATA_CANDIDATE' }),
    Object.freeze({ id:'TENNISMYLIFE_BULK', priority:10, costClass:'ZERO', access:'BULK_HTTPS', apiKeyRequired:false, enabled:true, supports:['ATP_MAIN','ATP_QUAL_CHALL','WTA_MAIN'], authority:'DATA_CANDIDATE', license:'MIT_PAGE_AND_NON_COMMERCIAL_NOTICE_REVIEW_REQUIRED', revision:AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_REVISION }),
    Object.freeze({ id:'JEFF_SACKMANN_GITHUB', priority:12, costClass:'ZERO', access:'ALLOWLISTED_GITHUB_HTTPS', apiKeyRequired:false, enabled:true, supports:['WTA_MAIN'], authority:'DATA_CANDIDATE', license:'CC_BY_NC_SA_4_0', conditionalRequests:true }),
    Object.freeze({ id:'TENNIS_DATA_MANUAL', priority:20, costClass:'ZERO', access:'LOCAL_MANUAL_BULK', apiKeyRequired:false, enabled:true, supports:['ATP_MAIN','WTA_MAIN'], authority:'DATA_CANDIDATE' }),
    Object.freeze({ id:'MATCH_CHARTING_AUXILIARY', priority:30, costClass:'ZERO', access:'LOCAL_RESEARCH', apiKeyRequired:false, enabled:false, supports:[], authority:'RESEARCH_ONLY', license:'CC_BY_NC_SA_4_0' }),
    Object.freeze({ id:'API_TENNIS_OPTIONAL', priority:100, costClass:'PAID_OPTIONAL', access:'HTTPS_API', apiKeyRequired:true, apiKeyPresent, enabled:apiEnabled && apiKeyPresent, supports:['ATP_MAIN','ATP_QUAL_CHALL','WTA_MAIN'], authority:'FALLBACK_DATA_CANDIDATE' }),
    Object.freeze({ id:'LAST_KNOWN_GOOD', priority:1000, costClass:'ZERO', access:'LOCAL_ACTIVE', apiKeyRequired:false, enabled:true, supports:['ATP_MAIN','ATP_QUAL_CHALL','WTA_MAIN'], authority:'SAFE_FALLBACK' })
  ]);
}
function defaultImportDir(projectRoot = path.resolve(__dirname, '..')) { return path.join(projectRoot, 'data', 'tennis_provider_imports'); }
function localImportCandidates(target, options = {}) {
  const root = path.resolve(options.importDir || defaultImportDir(options.projectRoot)); const year = options.year || currentYear(options.now);
  const canonical = path.join(root, 'canonical', target.localFile);
  const tennisDataName = target.id === 'ATP_MAIN' ? `ATP_${year}.csv` : target.id === 'WTA_MAIN' ? `WTA_${year}.csv` : null;
  return [
    { providerId:'LOCAL_CANONICAL_IMPORT', path:canonical, format:'CANONICAL' },
    ...(tennisDataName ? [{ providerId:'TENNIS_DATA_MANUAL', path:path.join(root,'tennis-data',tennisDataName), format:'TENNIS_DATA' }] : [])
  ];
}
function tmlResources(targetId, year = currentYear()) {
  if (targetId === 'ATP_MAIN') return [{ id:`TML_ATP_${year}`, url:`https://stats.tennismylife.org/data/${year}.csv` }];
  if (targetId === 'ATP_QUAL_CHALL') return [
    { id:`TML_CHALLENGER_${year}`, url:`https://stats.tennismylife.org/data/${year}_challenger.csv` },
    { id:`TML_QUALIFYING_${year}`, url:`https://stats.tennismylife.org/data/atp_quali/${year}_atp_quali.csv` }
  ];
  if (targetId === 'WTA_MAIN') return [{ id:`TML_WTA_${year}`, url:`https://stats.tennismylife.org/data/${year}_wta.csv` }];
  return [];
}
function sanitizeUrl(url) { try { const parsed = new URL(String(url)); if (parsed.searchParams.has('APIkey')) parsed.searchParams.set('APIkey','***'); return parsed.toString(); } catch (_) { return String(url || '').replace(/APIkey=[^&]+/gi,'APIkey=***'); } }
function assertAllowedNetworkUrl(url, providerId) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:' || !ALLOWED_NETWORK_HOSTS.has(parsed.hostname)) throw new Error(`PATCH21_PROVIDER_HOST_BLOCKED:${providerId}:${parsed.hostname}`);
  if (providerId === 'TENNISMYLIFE_BULK' && parsed.hostname !== 'stats.tennismylife.org') throw new Error(`PATCH21_PROVIDER_HOST_MISMATCH:${providerId}`);
  if (providerId === 'API_TENNIS_OPTIONAL' && (parsed.hostname !== 'api.api-tennis.com' || parsed.pathname !== '/tennis/')) throw new Error(`PATCH21_PROVIDER_PATH_MISMATCH:${providerId}`);
  return true;
}
function safeHeaders(headers = {}) {
  const allowed = ['content-type','content-length','etag','last-modified','retry-after','server','date','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset'];
  return Object.fromEntries(allowed.filter(k => headers[k] !== undefined).map(k => [k, headers[k]]));
}
function requestText(url, options = {}) {
  assertAllowedNetworkUrl(url, options.providerId || 'UNKNOWN');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent':'BettingApp-Tennis-Patch21/1.0', 'Accept':'text/csv,application/json;q=0.9,*/*;q=0.5', ...(options.headers || {}) } }, response => {
      const status = Number(response.statusCode || 0); const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > Number(options.maxBytes || MAX_DOWNLOAD_BYTES)) { req.destroy(new Error('PATCH21_DOWNLOAD_TOO_LARGE')); return; } chunks.push(chunk); });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (status === 304 || (status >= 200 && status < 300)) return resolve({ statusCode:status, text, headers:response.headers, url:sanitizeUrl(url) });
        const error = new Error(`PATCH21_HTTP_${status}:${options.providerId || 'UNKNOWN'}`); error.httpStatus=status; error.retryable=RETRYABLE_HTTP.has(status); error.providerId=options.providerId; error.diagnostics={ providerId:options.providerId, url:sanitizeUrl(url), httpStatus:status, retryable:error.retryable, responseHeaders:safeHeaders(response.headers), bodyPreview:text.slice(0,160) }; reject(error);
      });
    });
    req.setTimeout(Number(options.timeoutMs || DEFAULT_TIMEOUT_MS), () => req.destroy(Object.assign(new Error(`PATCH21_TIMEOUT:${options.providerId || 'UNKNOWN'}`), { code:'ETIMEDOUT', retryable:true, providerId:options.providerId })));
    req.on('error', error => { if (error.retryable === undefined) error.retryable = ['ETIMEDOUT','ECONNRESET','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH'].includes(error.code); reject(error); });
  });
}
function cachePaths(dataDir, providerId, resourceId) { const safe = String(resourceId).replace(/[^a-z0-9_.-]/gi,'_'); const root = path.join(dataDir,CACHE_DIR,providerId); return { root, body:path.join(root,`${safe}.body`), meta:path.join(root,`${safe}.json`) }; }
async function fetchCachedResource(resource, options = {}) {
  const dataDir = path.resolve(options.dataDir); const paths = cachePaths(dataDir, options.providerId, resource.id); const meta = readJson(paths.meta, null); const now = new Date(options.now || Date.now());
  const ageHours = meta?.fetchedAt ? Math.max(0,(now.getTime()-new Date(meta.fetchedAt).getTime())/3600000) : Infinity;
  if (!options.force && fs.existsSync(paths.body) && ageHours < Number(options.cacheHours ?? DEFAULT_BULK_CACHE_HOURS)) return { text:fs.readFileSync(paths.body,'utf8'), fromCache:true, networkCalls:0, meta };
  const headers = {}; if (meta?.etag) headers['If-None-Match']=meta.etag; if (meta?.lastModified) headers['If-Modified-Since']=meta.lastModified;
  let lastError = null; const delays = options.retryDelaysMs || [0,1000,3000];
  for (let attempt=0; attempt<delays.length; attempt+=1) {
    if (delays[attempt]) await (options.sleepFn || sleep)(delays[attempt]);
    try {
      const response = await (options.requester || requestText)(resource.url,{ providerId:options.providerId, timeoutMs:options.timeoutMs, headers });
      if (Number(response.statusCode)===304 && fs.existsSync(paths.body)) return { text:fs.readFileSync(paths.body,'utf8'), fromCache:true, networkCalls:1, meta:{...meta,checkedAt:nowIso(now)} };
      fs.mkdirSync(paths.root,{recursive:true}); fs.writeFileSync(paths.body,response.text,'utf8');
      const nextMeta={ providerId:options.providerId, resourceId:resource.id, url:sanitizeUrl(resource.url), fetchedAt:nowIso(now), etag:response.headers?.etag||null, lastModified:response.headers?.['last-modified']||null, bytes:Buffer.byteLength(response.text), sha256:sha256(Buffer.from(response.text)) };
      writeJsonAtomic(paths.meta,nextMeta); return { text:response.text, fromCache:false, networkCalls:1, meta:nextMeta };
    } catch (error) { lastError=error; if (!error.retryable) break; }
  }
  if (fs.existsSync(paths.body) && options.allowStaleCache !== false) return { text:fs.readFileSync(paths.body,'utf8'), fromCache:true, staleCache:true, networkCalls:delays.length, meta, warning:lastError?.message||'NETWORK_FAILURE' };
  throw lastError || new Error(`PATCH21_PROVIDER_FETCH_FAILED:${options.providerId}`);
}
function utcDay(now = new Date()) { return nowIso(now).slice(0,10); }
function usageState(dataDir, now = new Date()) { const file=path.join(dataDir,USAGE_FILE); const state=readJson(file,{version:TENNIS_MULTI_PROVIDER_POLICY_VERSION,days:{}}); const day=utcDay(now); return { file,state,day,used:Number(state.days?.[day]?.API_TENNIS_OPTIONAL||0) }; }
function reserveApiCall(dataDir, options = {}) {
  const now=options.now||new Date(); const budget=Math.max(0,finite(options.dailyBudget ?? process.env.TENNIS_API_DAILY_BUDGET,DEFAULT_API_DAILY_BUDGET)); const usage=usageState(dataDir,now);
  if (usage.used>=budget) throw new Error(`PATCH21_API_BUDGET_EXHAUSTED:${usage.used}/${budget}`);
  usage.state.days=usage.state.days||{}; usage.state.days[usage.day]=usage.state.days[usage.day]||{}; usage.state.days[usage.day].API_TENNIS_OPTIONAL=usage.used+1;
  for (const day of Object.keys(usage.state.days).sort().slice(0,-31)) delete usage.state.days[day];
  writeJsonAtomic(usage.file,usage.state); return { day:usage.day, used:usage.used+1, budget, remaining:Math.max(0,budget-usage.used-1) };
}
function apiDateRange(localLatest, now = new Date(), maxDays = 14) {
  const end = new Date(now); end.setUTCHours(0,0,0,0); let start = localLatest ? new Date(localLatest) : new Date(end.getTime()-Number(maxDays)*86400000);
  if (!Number.isFinite(start.getTime())) start=new Date(end.getTime()-Number(maxDays)*86400000); else start=new Date(start.getTime()+86400000);
  const minStart=new Date(end.getTime()-(Number(maxDays)-1)*86400000); if (start<minStart) start=minStart; if (start>end) start=end;
  const fmt=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  return { dateStart:fmt(start), dateStop:fmt(end) };
}
async function fetchApiTennisOnce(options = {}) {
  const key=String(options.apiKey ?? process.env.API_TENNIS_KEY ?? '').trim(); if (!key) throw new Error('PATCH21_API_TENNIS_KEY_MISSING');
  if (!isApiEnabled(options.apiEnabled ?? process.env.TENNIS_API_PROVIDER_ENABLED ?? '0')) throw new Error('PATCH21_API_TENNIS_DISABLED');
  const dataDir=path.resolve(options.dataDir); const now=new Date(options.now||Date.now());
  const range=apiDateRange(options.localLatest,now,options.maxDays||14);
  const resourceId=`fixtures_${range.dateStart}_${range.dateStop}`;
  const paths=cachePaths(dataDir,'API_TENNIS_OPTIONAL',resourceId);
  const meta=readJson(paths.meta,null);
  const ageHours=meta?.fetchedAt?Math.max(0,(now.getTime()-new Date(meta.fetchedAt).getTime())/3600000):Infinity;
  if(!options.force&&fs.existsSync(paths.body)&&ageHours<Number(options.apiCacheHours??DEFAULT_API_CACHE_HOURS)){
    const cachedText=fs.readFileSync(paths.body,'utf8');
    const cached=JSON.parse(cachedText);
    if(Number(cached.success)===1&&Array.isArray(cached.result)){
      const usage=usageState(dataDir,now);
      const budget=Math.max(0,finite(options.dailyBudget??process.env.TENNIS_API_DAILY_BUDGET,DEFAULT_API_DAILY_BUDGET));
      return {payload:cached,usage:{day:usage.day,used:usage.used,budget,remaining:Math.max(0,budget-usage.used)},range,sanitizedUrl:meta?.url||'https://api.api-tennis.com/tennis/?method=get_fixtures&APIkey=***',networkCalls:0,fromCache:true,cacheAgeHours:round(ageHours,3)};
    }
  }
  const usage=reserveApiCall(dataDir,{...options,now});
  const url=new URL('https://api.api-tennis.com/tennis/'); url.searchParams.set('method','get_fixtures'); url.searchParams.set('APIkey',key); url.searchParams.set('date_start',range.dateStart); url.searchParams.set('date_stop',range.dateStop);
  const response=await (options.requester||requestText)(url.toString(),{providerId:'API_TENNIS_OPTIONAL',timeoutMs:options.timeoutMs});
  const parsed=JSON.parse(response.text); if (Number(parsed.success)!==1 || !Array.isArray(parsed.result)) throw new Error('PATCH21_API_TENNIS_RESPONSE_INVALID');
  fs.mkdirSync(paths.root,{recursive:true}); fs.writeFileSync(paths.body,JSON.stringify(parsed),'utf8');
  writeJsonAtomic(paths.meta,{providerId:'API_TENNIS_OPTIONAL',resourceId,url:sanitizeUrl(url.toString()),fetchedAt:nowIso(now),bytes:Buffer.byteLength(JSON.stringify(parsed)),sha256:sha256(Buffer.from(JSON.stringify(parsed))),dateStart:range.dateStart,dateStop:range.dateStop,keyPersisted:false,keyExposed:false});
  return { payload:parsed, usage, range, sanitizedUrl:sanitizeUrl(url.toString()), networkCalls:1, fromCache:false };
}
function inspectCanonical(text,target,options={}) { const refresh=require('./tennisPlayerDataRefresh'); return refresh.inspectCsvText(text,{id:target.id,localFile:target.localFile,sourceTier:`PATCH21_${options.providerId||'UNKNOWN'}`,minRows:target.minRows},{now:options.now,maxInvalidRatePct:5}); }
function inspectLocalTarget(dataDir,target,options={}) { const file=path.join(dataDir,target.localFile); if (!fs.existsSync(file)) return null; return inspectCanonical(fs.readFileSync(file,'utf8'),target,{providerId:'LAST_KNOWN_GOOD',now:options.now}); }
function compareCandidate(candidate,local,target) { if (!local || candidate.providerId==='LAST_KNOWN_GOOD') return {accepted:true,reasons:[]}; const refresh=require('./tennisPlayerDataRefresh'); return refresh.compareRemoteToLocal(candidate.inspection,local,{id:target.id}); }
async function localCandidates(target,options={}) {
  const found=[];
  for (const candidate of localImportCandidates(target,options)) {
    if (!fs.existsSync(candidate.path)) continue;
    const raw=fs.readFileSync(candidate.path,'utf8'); const text=candidate.format==='TENNIS_DATA'?normalizeTennisDataCsv(raw,{targetId:target.id,providerId:candidate.providerId}):normalizeCanonicalCsv(raw,{targetId:target.id,providerId:candidate.providerId});
    found.push({providerId:candidate.providerId,targetId:target.id,text,networkCalls:0,sourcePaths:[candidate.path],fromCache:false});
  }
  return found;
}
async function tmlCandidate(target,options={}) {
  const resources=tmlResources(target.id,options.year||currentYear(options.now)); if (!resources.length) return null; const fetched=[]; let networkCalls=0; const diagnostics=[];
  for (const resource of resources) { const result=await fetchCachedResource(resource,{...options,providerId:'TENNISMYLIFE_BULK',cacheHours:options.bulkCacheHours??DEFAULT_BULK_CACHE_HOURS}); fetched.push(result.text); networkCalls+=result.networkCalls; diagnostics.push({resourceId:resource.id,url:resource.url,fromCache:result.fromCache,staleCache:result.staleCache===true,warning:result.warning||null}); }
  const text=target.id==='ATP_QUAL_CHALL'?mergeCanonicalCsv(fetched,{targetId:target.id,providerId:'TENNISMYLIFE_BULK'}):normalizeCanonicalCsv(fetched[0],{targetId:target.id,providerId:'TENNISMYLIFE_BULK'});
  return {providerId:'TENNISMYLIFE_BULK',targetId:target.id,text,networkCalls,diagnostics,fromCache:diagnostics.every(x=>x.fromCache)};
}

async function githubWtaCandidate(target, options = {}) {
  if (target.id !== 'WTA_MAIN') return null;
  const refresh = require('./tennisPlayerDataRefresh');
  const year = options.year || currentYear(options.now);
  const source = refresh.defaultSources(year).find(item => item.id === 'WTA_MAIN');
  if (!source) throw new Error('PATCH36_WTA_GITHUB_SOURCE_MISSING');
  const dataDir = path.resolve(options.dataDir);
  const cache = cachePaths(dataDir, 'JEFF_SACKMANN_GITHUB', source.remotePath);
  const meta = readJson(cache.meta, null);
  const now = new Date(options.now || Date.now());
  const ageHours = meta?.fetchedAt ? Math.max(0, (now.getTime() - new Date(meta.fetchedAt).getTime()) / 3600000) : Infinity;
  if (!options.force && fs.existsSync(cache.body) && ageHours < Number(options.githubCacheHours ?? DEFAULT_GITHUB_CACHE_HOURS)) {
    return { providerId:'JEFF_SACKMANN_GITHUB', targetId:target.id, text:fs.readFileSync(cache.body,'utf8'), networkCalls:0, fromCache:true, diagnostics:[{status:'CACHE_HIT',ageHours:round(ageHours,3),source:source.repository}] };
  }
  const headers = {};
  if (meta?.etag) headers['If-None-Match'] = meta.etag;
  if (meta?.lastModified) headers['If-Modified-Since'] = meta.lastModified;
  try {
    const downloaded = await refresh.downloadSourceWithPolicy(source, {
      ...options,
      headers,
      retryDelaysMs: options.githubRetryDelaysMs || [0, 750, 2000, 4000]
    });
    const response = downloaded.response || {};
    if (Number(response.statusCode) === 304 && fs.existsSync(cache.body)) {
      return { providerId:'JEFF_SACKMANN_GITHUB', targetId:target.id, text:fs.readFileSync(cache.body,'utf8'), networkCalls:downloaded.attempts.length, fromCache:true, diagnostics:downloaded.attempts };
    }
    if (!response.text) throw new Error('PATCH36_WTA_GITHUB_EMPTY_RESPONSE');
    fs.mkdirSync(cache.root,{recursive:true});
    fs.writeFileSync(cache.body,response.text,'utf8');
    writeJsonAtomic(cache.meta,{providerId:'JEFF_SACKMANN_GITHUB',resourceId:source.remotePath,repository:source.repository,remotePath:source.remotePath,fetchedAt:nowIso(now),etag:response.headers?.etag||null,lastModified:response.headers?.['last-modified']||null,sha256:sha256(Buffer.from(response.text)),resolvedUrl:downloaded.resolvedUrl,license:'CC_BY_NC_SA_4_0'});
    return { providerId:'JEFF_SACKMANN_GITHUB', targetId:target.id, text:response.text, networkCalls:downloaded.attempts.length, fromCache:false, diagnostics:downloaded.attempts };
  } catch (error) {
    if (fs.existsSync(cache.body) && options.allowStaleCache !== false) {
      return { providerId:'JEFF_SACKMANN_GITHUB', targetId:target.id, text:fs.readFileSync(cache.body,'utf8'), networkCalls:Number(error?.patch20Attempts?.length||0), fromCache:true, staleCache:true, warning:error.message, diagnostics:error.patch20Attempts||[] };
    }
    throw error;
  }
}
function lkgCandidate(dataDir,target) { const file=path.join(dataDir,target.localFile); if (!fs.existsSync(file)) return null; return {providerId:'LAST_KNOWN_GOOD',targetId:target.id,text:fs.readFileSync(file,'utf8'),networkCalls:0,sourcePaths:[file],fromCache:true}; }
function providerPlan(options={}) {
  const year=options.year||currentYear(options.now); const providers=providerRegistry(options); const targets=targetRegistry(year);
  return { success:true, version:TENNIS_MULTI_PROVIDER_VERSION, audit16dRevision:AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_REVISION, registryVersion:TENNIS_MULTI_PROVIDER_REGISTRY_VERSION, policyVersion:TENNIS_MULTI_PROVIDER_POLICY_VERSION, strategy:'ZERO_KEY_LOCAL_THEN_ZERO_KEY_BULK_GITHUB_THEN_OPTIONAL_BUDGETED_API_THEN_LKG', year, providers, targets, retiredProviders:[], githubPolicy:{enabled:true,target:'WTA_MAIN',cacheHours:Number(options.githubCacheHours||DEFAULT_GITHUB_CACHE_HOURS),conditionalRequests:true,allowlistedOnly:true,apiKeyRequired:false,activationRequiresFreshnessValidation:true}, apiPolicy:{ enabled:providers.find(p=>p.id==='API_TENNIS_OPTIONAL').enabled, keyPresent:providers.find(p=>p.id==='API_TENNIS_OPTIONAL').apiKeyPresent, keyPersisted:false, keyExposed:false, dailyBudget:Math.max(0,finite(options.dailyBudget ?? process.env.TENNIS_API_DAILY_BUDGET,DEFAULT_API_DAILY_BUDGET)), cacheHours:Number(options.apiCacheHours||DEFAULT_API_CACHE_HOURS), oneSharedFixturesCallPerRefresh:true }, hardExclusion:false, productionAuthority:false, qualityGateAuthority:false, stakeAuthority:false };
}
async function resolveBundle(options={}) {
  const dataDir=path.resolve(options.dataDir); const now=options.now||new Date(); const targets=targetRegistry(options.year||currentYear(now)); const selected=[]; const diagnostics=[]; let apiPayload=null; let apiMeta=null;
  async function evaluate(target,candidate,local){
    if(!candidate)return null;
    try{
      candidate.inspection=inspectCanonical(candidate.text,target,{providerId:candidate.providerId,now});
      candidate.comparison=compareCandidate(candidate,local,target);
      diagnostics.push({targetId:target.id,providerId:candidate.providerId,status:candidate.comparison.accepted?'PASS':'REJECTED',comparison:candidate.comparison,latestMatchAt:candidate.inspection.latestMatchAt,validRows:candidate.inspection.validRows,networkCalls:candidate.networkCalls||0,fromCache:candidate.fromCache===true});
      return candidate.comparison.accepted?candidate:null;
    }catch(error){diagnostics.push({targetId:target.id,providerId:candidate.providerId,status:'FAIL',error:error.message});return null;}
  }
  for (const target of targets) {
    const local=inspectLocalTarget(dataDir,target,{now}); let chosen=null;
    let localSet=[];
    try{localSet=await localCandidates(target,options);}catch(error){diagnostics.push({targetId:target.id,providerId:'LOCAL_IMPORT',status:'FAIL',error:error.message});}
    const canonical=localSet.find(c=>c.providerId==='LOCAL_CANONICAL_IMPORT');
    chosen=await evaluate(target,canonical,local);
    if(!chosen&&(target.id.startsWith('ATP')||target.id==='WTA_MAIN')){
      try{chosen=await evaluate(target,await tmlCandidate(target,{...options,dataDir,now}),local);}catch(error){diagnostics.push({targetId:target.id,providerId:'TENNISMYLIFE_BULK',status:'FAIL',error:error.message,diagnostics:error.diagnostics||null});}
    }
    if(!chosen&&target.id==='WTA_MAIN'){
      try{chosen=await evaluate(target,await githubWtaCandidate(target,{...options,dataDir,now}),local);}catch(error){diagnostics.push({targetId:target.id,providerId:'JEFF_SACKMANN_GITHUB',status:'FAIL_USING_LKG_IF_NEEDED',error:error.message,attempts:error.patch20Attempts||[]});}
    }
    if(!chosen){const manual=localSet.find(c=>c.providerId==='TENNIS_DATA_MANUAL');chosen=await evaluate(target,manual,local);}
    if (!chosen && isApiEnabled(options.apiEnabled ?? process.env.TENNIS_API_PROVIDER_ENABLED ?? '0') && String(options.apiKey ?? process.env.API_TENNIS_KEY ?? '').trim()) {
      try {
        if(!apiPayload){ apiMeta=await fetchApiTennisOnce({...options,dataDir,now,localLatest:local?.latestMatchAt}); apiPayload=apiMeta.payload; }
        const apiText=normalizeApiTennisPayload(apiPayload,target.id,{providerId:'API_TENNIS_OPTIONAL'});
        const parsed=parseCsv(apiText);
        if(parsed.rows.length){
          const base=lkgCandidate(dataDir,target);
          const merged=base?mergeCanonicalCsv([base.text,apiText],{targetId:target.id,providerId:'API_TENNIS_OPTIONAL'}):apiText;
          const candidate={providerId:'API_TENNIS_OPTIONAL',targetId:target.id,text:merged,networkCalls:apiMeta.networkCalls,fromCache:apiMeta.fromCache===true,apiUsage:apiMeta.usage,apiRange:apiMeta.range};
          chosen=await evaluate(target,candidate,local);
          if(chosen){const last=diagnostics.at(-1);last.apiUsage=candidate.apiUsage;last.apiRange=candidate.apiRange;}
        }else diagnostics.push({targetId:target.id,providerId:'API_TENNIS_OPTIONAL',status:'NO_MATCHES_FOR_TARGET',apiRange:apiMeta.range,networkCalls:apiMeta.networkCalls,fromCache:apiMeta.fromCache===true});
      } catch(error){ diagnostics.push({targetId:target.id,providerId:'API_TENNIS_OPTIONAL',status:'FAIL',error:error.message}); }
    }
    if(!chosen){
      const lkg=lkgCandidate(dataDir,target);
      if(!lkg) throw new Error(`PATCH21_NO_VALID_PROVIDER_OR_LKG:${target.id}`);
      lkg.inspection=inspectCanonical(lkg.text,target,{providerId:'LAST_KNOWN_GOOD',now}); lkg.comparison={accepted:true,reasons:['SAFE_FALLBACK']}; chosen=lkg;
      diagnostics.push({targetId:target.id,providerId:'LAST_KNOWN_GOOD',status:'PASS_FALLBACK',latestMatchAt:lkg.inspection.latestMatchAt,validRows:lkg.inspection.validRows,networkCalls:0,fromCache:true});
    }
    selected.push(chosen);
  }
  return {selected,diagnostics,apiMeta};
}

function pidLiveness(pid){
  const n=Number(pid);
  if(!Number.isInteger(n)||n<=0)return null;
  try{process.kill(n,0);return true;}catch(error){if(error?.code==='EPERM')return true;if(error?.code==='ESRCH')return false;return null;}
}
function getRefreshLockStatus(dataDir,options={}){
  const file=path.join(path.resolve(dataDir),LOCK_FILE);
  if(!fs.existsSync(file))return{exists:false,status:'ABSENT',lockPath:file,recoverable:false,ownerAlive:false,pid:null,ageMs:null,revision:AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION};
  let stat=null,parsed=null,parseError=null;
  try{stat=fs.statSync(file);}catch(_){}
  try{parsed=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){parseError=error.message;}
  const pid=Number.isInteger(Number(parsed?.pid))&&Number(parsed?.pid)>0?Number(parsed.pid):null;
  const ownerAlive=pid===null?null:pidLiveness(pid);
  const parsedAt=parsed?.at||parsed?.createdAt||null;
  const parsedMs=parsedAt?new Date(parsedAt).getTime():NaN;
  const baseMs=Number.isFinite(parsedMs)?parsedMs:Number(stat?.mtimeMs||Date.now());
  const ageMs=Math.max(0,Date.now()-baseMs);
  const staleMs=Math.max(60000,Number(options.staleLockMs||PATCH21_LOCK_STALE_MS));
  let status='LOCKED_UNCERTAIN',recoverable=false;
  if(ownerAlive===true)status='LOCKED_ACTIVE_OWNER';
  else if(ownerAlive===false){status='STALE_DEAD_OWNER';recoverable=true;}
  else if(ageMs>staleMs){status='STALE_MALFORMED_OR_UNVERIFIABLE';recoverable=true;}
  return{exists:true,status,lockPath:file,recoverable,ownerAlive,pid,ageMs,ageMinutes:Math.round(ageMs/6000)/10,staleAfterMs:staleMs,parsedAt,parseError,revision:AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION};
}
function acquireLock(dataDir,options={}){
  const file=path.join(dataDir,LOCK_FILE);fs.mkdirSync(dataDir,{recursive:true});
  let recovered=null;
  const before=getRefreshLockStatus(dataDir,options);
  if(before.exists){
    if(before.recoverable){fs.rmSync(file,{force:true});recovered=before;}
    else{
      const error=new Error(before.ownerAlive===true?'PATCH21_REFRESH_ALREADY_RUNNING':'PATCH21_REFRESH_LOCK_UNCERTAIN');
      error.patch21Lock=before;throw error;
    }
  }
  try{fs.writeFileSync(file,JSON.stringify({pid:process.pid,at:new Date().toISOString(),operationId:options.operationId||null,revision:AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION}),{flag:'wx'});}
  catch(error){if(error.code==='EEXIST'){const e=new Error('PATCH21_REFRESH_ALREADY_RUNNING');e.patch21Lock=getRefreshLockStatus(dataDir,options);throw e;}throw error;}
  const release=()=>{try{const current=getRefreshLockStatus(dataDir,options);if(!current.exists||current.pid===process.pid)fs.rmSync(file,{force:true});}catch(_){}};
  release.lockRecovery=recovered;
  release.lockStatus=getRefreshLockStatus(dataDir,options);
  return release;
}
function backupCurrent(dataDir,targets,now=new Date()){ const root=path.join(dataDir,'last_known_good_patch21',safeIso(now)); fs.mkdirSync(root,{recursive:true}); for(const t of targets){const src=path.join(dataDir,t.localFile);if(fs.existsSync(src))fs.copyFileSync(src,path.join(root,t.localFile));} for(const f of [MANIFEST_FILE,'tennis_data_refresh_manifest.json']){const src=path.join(dataDir,f);if(fs.existsSync(src))fs.copyFileSync(src,path.join(root,f));} return root; }
function activateBundle(dataDir,bundle,options={}) {
  const targets=targetRegistry(options.year||currentYear(options.now)); const stage=path.join(dataDir,`.patch21-stage-${process.pid}-${Date.now()}`); fs.mkdirSync(stage,{recursive:true});
  try{ for(const candidate of bundle.selected) fs.writeFileSync(path.join(stage,targets.find(t=>t.id===candidate.targetId).localFile),candidate.text,'utf8'); for(const target of targets) inspectCanonical(fs.readFileSync(path.join(stage,target.localFile),'utf8'),target,{providerId:'STAGED_BUNDLE',now:options.now}); const backup=backupCurrent(dataDir,targets,options.now);
    try{ for(const target of targets){const src=path.join(stage,target.localFile);const dst=path.join(dataDir,target.localFile);const tmp=`${dst}.patch21-new`;fs.copyFileSync(src,tmp);fs.renameSync(tmp,dst);} return backup; }
    catch(error){for(const target of targets){const src=path.join(backup,target.localFile);if(fs.existsSync(src))fs.copyFileSync(src,path.join(dataDir,target.localFile));}throw error;}
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
async function refreshMultiProvider(options={}) {
  const dataDir=path.resolve(options.dataDir); const now=options.now||new Date(); const operationId=options.operationId||`PATCH21_MULTI_${Date.now()}`; const release=acquireLock(dataDir,{...options,operationId}); const lockRecovery=release.lockRecovery||null; const oldBytes=new Map(targetRegistry(currentYear(now)).map(t=>[t.localFile,fs.existsSync(path.join(dataDir,t.localFile))?fs.readFileSync(path.join(dataDir,t.localFile)):null]));
  try{
    const bundle=await resolveBundle({...options,dataDir,now}); const backup=activateBundle(dataDir,bundle,{...options,now});
    const playerEvidence=options.playerEvidence||require('./tennisPlayerEvidence'); const activeStatus=playerEvidence.init(dataDir,{force:true}); if(!activeStatus?.initialized||!activeStatus?.matchCount)throw new Error('PATCH21_ACTIVE_ENGINE_NOT_READY');
    const selected=bundle.selected.map(c=>({targetId:c.targetId,providerId:c.providerId,latestMatchAt:c.inspection.latestMatchAt,validRows:c.inspection.validRows,sha256:c.inspection.sha256,networkCalls:c.networkCalls||0,fromCache:c.fromCache===true,apiUsage:c.apiUsage||null,apiRange:c.apiRange||null}));
    const manifest={version:TENNIS_MULTI_PROVIDER_MANIFEST_VERSION,refreshVersion:TENNIS_MULTI_PROVIDER_VERSION,registryVersion:TENNIS_MULTI_PROVIDER_REGISTRY_VERSION,policyVersion:TENNIS_MULTI_PROVIDER_POLICY_VERSION,operationId,lastAttemptAt:nowIso(now),lastSuccessAt:nowIso(now),status:'SUCCESS_MIXED_PROVIDER_ATOMIC_BUNDLE',strategy:'ZERO_KEY_FIRST_OPTIONAL_API_LAST',selected,diagnostics:bundle.diagnostics,aggregate:{fileCount:activeStatus.fileCount,matchCount:activeStatus.matchCount,playerCount:activeStatus.playerCount,earliestMatchAt:activeStatus.earliestMatchAt,latestMatchAt:activeStatus.latestMatchAt,rejectedRows:activeStatus.rejectedRows,duplicateRows:activeStatus.duplicateRows},apiKeyPersisted:false,apiKeyExposed:false,apiCalls:selected.reduce((n,x)=>n+(x.providerId==='API_TENNIS_OPTIONAL'?1:0),0),atomicBundle:true,lastKnownGoodBackup:backup,productionAuthority:false,qualityGateAuthority:false,stakeAuthority:false,lockRevision:AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION,staleLockRecovered:lockRecovery!==null,staleLockRecovery:lockRecovery};
    writeJsonAtomic(path.join(dataDir,MANIFEST_FILE),manifest);
    writeJsonAtomic(path.join(dataDir,'tennis_data_refresh_manifest.json'),{version:'TENNIS_PLAYER_DATA_MANIFEST_V3_PATCH21',refreshVersion:'TENNIS_PLAYER_DATA_REFRESH_V3_PATCH21',operationId,lastAttemptAt:manifest.lastAttemptAt,lastSuccessAt:manifest.lastSuccessAt,status:'SUCCESS',dataDir,sources:selected.map(x=>({id:x.targetId,providerId:x.providerId,localFile:targetRegistry(currentYear(now)).find(t=>t.id===x.targetId).localFile,validRows:x.validRows,latestMatchAt:x.latestMatchAt,sha256:x.sha256})),aggregate:manifest.aggregate,networkUsed:selected.some(x=>x.networkCalls>0),allowlistedOnly:true,atomicActivation:true,lastKnownGoodBackup:backup,multiProvider:true});
    fs.rmSync(path.join(dataDir,FAILURE_FILE),{force:true}); fs.rmSync(path.join(dataDir,'tennis_data_refresh_last_failure.json'),{force:true});
    return {success:true,version:TENNIS_MULTI_PROVIDER_VERSION,operationId,status:manifest.status,selected,diagnostics:bundle.diagnostics,activeStatus,manifest,dataChanged:selected.some(x=>x.providerId!=='LAST_KNOWN_GOOD'),apiCalls:manifest.apiCalls,apiKeyPersisted:false,probabilityWeightsChanged:false,deepScanChanged:false,qualityGateChanged:false,stakePolicyChanged:false,lockRevision:AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION,staleLockRecovered:lockRecovery!==null,staleLockRecovery:lockRecovery};
  }catch(error){
    for(const [file,bytes] of oldBytes){const dst=path.join(dataDir,file);if(bytes)fs.writeFileSync(dst,bytes);else fs.rmSync(dst,{force:true});}
    try{(options.playerEvidence||require('./tennisPlayerEvidence')).init(dataDir,{force:true});}catch(_){}
    const localAvailable=[...oldBytes.values()].every(Boolean); const failure={version:TENNIS_MULTI_PROVIDER_MANIFEST_VERSION,refreshVersion:TENNIS_MULTI_PROVIDER_VERSION,operationId,lastAttemptAt:nowIso(now),status:localAvailable?'FAILED_USING_LAST_KNOWN_GOOD':'FAILED_NO_COMPLETE_BUNDLE',error:error.message,localSourcesAvailable:localAvailable,degradedUsingLastKnownGood:localAvailable,apiKeyPersisted:false,apiKeyExposed:false,productionAuthority:false,qualityGateAuthority:false,stakeAuthority:false,lockRevision:AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION,staleLockRecovered:lockRecovery!==null,staleLockRecovery:lockRecovery}; writeJsonAtomic(path.join(dataDir,FAILURE_FILE),failure); writeJsonAtomic(path.join(dataDir,'tennis_data_refresh_last_failure.json'),{...failure,refreshVersion:'TENNIS_PLAYER_DATA_REFRESH_V3_PATCH21'}); error.patch21=failure; error.patch20=failure; error.patch14=failure; throw error;
  }finally{release();}
}
async function probeProviders(options={}) {
  const plan=providerPlan(options); const dataDir=path.resolve(options.dataDir); const results=[];
  for(const target of targetRegistry(options.year||currentYear(options.now))){
    const local=await localCandidates(target,options).catch(()=>[]); results.push({targetId:target.id,providerId:'LOCAL_IMPORTS',status:local.length?'AVAILABLE':'NOT_CONFIGURED',files:local.map(x=>x.sourcePaths?.[0])});
    if(target.id.startsWith('ATP')||target.id==='WTA_MAIN'){ try{const c=await tmlCandidate(target,{...options,dataDir}); const inspection=inspectCanonical(c.text,target,{providerId:c.providerId,now:options.now}); results.push({targetId:target.id,providerId:c.providerId,status:'PASS',validRows:inspection.validRows,latestMatchAt:inspection.latestMatchAt,networkCalls:c.networkCalls,fromCache:c.fromCache});}catch(error){results.push({targetId:target.id,providerId:'TENNISMYLIFE_BULK',status:'FAIL',error:error.message});} }
    if(target.id==='WTA_MAIN'){ try{const c=await githubWtaCandidate(target,{...options,dataDir}); const inspection=inspectCanonical(c.text,target,{providerId:c.providerId,now:options.now}); results.push({targetId:target.id,providerId:c.providerId,status:'PASS',validRows:inspection.validRows,latestMatchAt:inspection.latestMatchAt,networkCalls:c.networkCalls,fromCache:c.fromCache,staleCache:c.staleCache===true});}catch(error){results.push({targetId:target.id,providerId:'JEFF_SACKMANN_GITHUB',status:'FAIL_LKG_PRESERVED',error:error.message});} }
    const lkg=lkgCandidate(dataDir,target); results.push({targetId:target.id,providerId:'LAST_KNOWN_GOOD',status:lkg?'PASS':'MISSING'});
  }
  const api=plan.providers.find(p=>p.id==='API_TENNIS_OPTIONAL'); results.push({targetId:'ALL',providerId:'API_TENNIS_OPTIONAL',status:api.enabled?'ENABLED_BUDGETED':'DISABLED_BY_DEFAULT',apiKeyPresent:api.apiKeyPresent,apiKeyExposed:false,networkCallExecuted:false});
  return {success:results.every(x=>x.providerId==='TENNISMYLIFE_BULK'?x.status==='PASS':true),version:TENNIS_MULTI_PROVIDER_VERSION,audit16dRevision:AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_REVISION,mode:'ZERO_KEY_PROVIDER_PROBE_NO_ACTIVATION_NO_PAID_API',plan,results,dataChanged:false,activationPerformed:false,paidApiCalls:0,apiKeyExposed:false};
}
function getHealth(options={}) {
  const dataDir=path.resolve(options.dataDir); const manifest=readJson(path.join(dataDir,MANIFEST_FILE),null); const failure=readJson(path.join(dataDir,FAILURE_FILE),null); const plan=providerPlan(options); const usage=usageState(dataDir,options.now||new Date()); const unresolved=failure?.lastAttemptAt&&(!manifest?.lastSuccessAt||new Date(failure.lastAttemptAt)>new Date(manifest.lastSuccessAt));
  return {success:true,status:unresolved?'DEGRADED_USING_LAST_KNOWN_GOOD':manifest?'READY':'NOT_YET_REFRESHED',version:TENNIS_MULTI_PROVIDER_VERSION,audit16dRevision:AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_REVISION,registryVersion:TENNIS_MULTI_PROVIDER_REGISTRY_VERSION,policyVersion:TENNIS_MULTI_PROVIDER_POLICY_VERSION,strategy:plan.strategy,providers:plan.providers,githubPolicy:plan.githubPolicy,selectedProviders:manifest?.selected||[],manifest,lastFailure:unresolved?failure:null,apiUsage:{day:usage.day,used:usage.used,budget:plan.apiPolicy.dailyBudget,remaining:Math.max(0,plan.apiPolicy.dailyBudget-usage.used),keyPresent:plan.apiPolicy.keyPresent,keyPersisted:false,keyExposed:false},costPolicy:{zeroKeyFirst:true,bulkBeforeApi:true,githubBeforePaidApi:true,cacheBeforeNetwork:true,oneSharedApiCallPerRefresh:true,lastKnownGoodBeforeFailure:true},atomicBundle:true,hardExclusion:false,productionAuthority:false,qualityGateAuthority:false,stakeAuthority:false,note:unresolved?'Refresh multi-provider degradato: bundle locale completo preservato.':manifest?'Registry multi-provider attivo con priorità zero-key e budget API.':'Registry multi-provider pronto; eseguire probe o refresh.'};
}

module.exports={
  TENNIS_MULTI_PROVIDER_VERSION,TENNIS_MULTI_PROVIDER_REGISTRY_VERSION,TENNIS_MULTI_PROVIDER_MANIFEST_VERSION,TENNIS_MULTI_PROVIDER_POLICY_VERSION,AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_REVISION,AUDIT16D_R3_T2_R1_REFRESH_LOCK_REVISION,PATCH21_LOCK_STALE_MS,
  MANIFEST_FILE,FAILURE_FILE,USAGE_FILE,CACHE_DIR,CANONICAL_HEADERS,ALLOWED_NETWORK_HOSTS,
  targetRegistry,providerRegistry,providerPlan,localImportCandidates,tmlResources,sanitizeUrl,assertAllowedNetworkUrl,isApiEnabled,
  parseCsv,normalizeCanonicalCsv,normalizeTennisDataCsv,normalizeApiTennisPayload,mergeCanonicalCsv,apiTarget,
  requestText,fetchCachedResource,githubWtaCandidate,reserveApiCall,apiDateRange,fetchApiTennisOnce,resolveBundle,refreshMultiProvider,probeProviders,getHealth,getRefreshLockStatus,acquireRefreshLock:acquireLock
};
