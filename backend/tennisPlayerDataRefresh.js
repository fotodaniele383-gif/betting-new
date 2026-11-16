'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const TENNIS_PLAYER_DATA_REFRESH_VERSION = 'TENNIS_PLAYER_DATA_REFRESH_V2_PATCH20';
const TENNIS_PLAYER_DATA_MANIFEST_VERSION = 'TENNIS_PLAYER_DATA_MANIFEST_V2_PATCH20';
const TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION = 'TENNIS_PLAYER_DATA_REQUEST_POLICY_V2_PATCH20_R1';
const TENNIS_PLAYER_DATA_REFRESH_REVISION = 'PATCH20_R1_GITHUB_CONTENTS_API_FALLBACK';
const DEFAULT_DATA_DIR = path.join(__dirname, 'sackmann_data');
const MANIFEST_FILE = 'tennis_data_refresh_manifest.json';
const FAILURE_FILE = 'tennis_data_refresh_last_failure.json';
const LOCK_FILE = '.patch14_refresh.lock';
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;
const AUTO_REFRESH_INTERVAL_HOURS = 24;
const AUDIT16D_R3_T2_RECURRING_REFRESH_REVISION = 'AUDIT16D_R3_T2_ZERO_KEY_FRESHNESS_AND_RECURRING_REFRESH_V1';
const MIN_AUTO_REFRESH_INTERVAL_HOURS = 6;
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([0, 1000, 3000, 8000]);
const RETRYABLE_HTTP_STATUS = new Set([404, 408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND',
  'EAI_AGAIN', 'ETIMEDOUT', 'ERR_TLS_CERT_ALTNAME_INVALID'
]);
const ALLOWED_HOSTS = new Set(['raw.githubusercontent.com', 'api.github.com']);
const ALLOWED_REPOSITORIES = new Set(['JeffSackmann/tennis_atp', 'JeffSackmann/tennis_wta']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function round(value, decimals = 2) {
  const number = finite(value, 0);
  return Number(number.toFixed(decimals));
}
function nowIso(now = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  return Number.isFinite(value.getTime()) ? value.toISOString() : new Date().toISOString();
}
function safeIsoForPath(now = new Date()) {
  return nowIso(now).replace(/[:.]/g, '-');
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
function splitCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < String(line || '').length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current); current = '';
    } else current += char;
  }
  values.push(current);
  return values;
}
function parseSackmannDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return Number.isFinite(date.getTime()) ? date : null;
}
function currentYear(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return Number.isFinite(date.getTime()) ? date.getUTCFullYear() : new Date().getUTCFullYear();
}
function buildSourceUrls(repository, remotePath) {
  const [owner, repo] = String(repository || '').split('/');
  const encodedPath = String(remotePath || '').split('/').map(segment => encodeURIComponent(segment)).join('/');
  return [
    `https://raw.githubusercontent.com/${repository}/master/${remotePath}`,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=master`,
    `https://raw.githubusercontent.com/${repository}/refs/heads/master/${remotePath}`
  ];
}
function sourceTransport(url) {
  const parsed = new URL(String(url || ''));
  if (parsed.hostname === 'api.github.com') return 'GITHUB_CONTENTS_API';
  if (parsed.hostname === 'raw.githubusercontent.com') return 'GITHUB_RAW';
  return 'UNKNOWN';
}
function defaultSources(year = currentYear()) {
  return [
    {
      id: 'ATP_MAIN',
      repository: 'JeffSackmann/tennis_atp',
      remotePath: `atp_matches_${year}.csv`,
      localFile: `atp_matches_${year}.csv`,
      sourceTier: 'ATP_MAIN_STRUCTURED',
      minRows: 500
    },
    {
      id: 'ATP_QUAL_CHALL',
      repository: 'JeffSackmann/tennis_atp',
      remotePath: `atp_matches_qual_chall_${year}.csv`,
      localFile: `atp_matches_challenger_${year}.csv`,
      sourceTier: 'ATP_QUAL_CHALL_STRUCTURED',
      minRows: 1000
    },
    {
      id: 'WTA_MAIN',
      repository: 'JeffSackmann/tennis_wta',
      remotePath: `wta_matches_${year}.csv`,
      localFile: `wta_matches_${year}.csv`,
      sourceTier: 'WTA_MAIN_STRUCTURED',
      minRows: 500
    }
  ].map(source => {
    const urlCandidates = buildSourceUrls(source.repository, source.remotePath);
    return { ...source, url: urlCandidates[0], urlCandidates };
  });
}
function sourceUrlCandidates(source) {
  const declared = Array.isArray(source?.urlCandidates) ? source.urlCandidates : [];
  const candidates = [source?.url, ...declared, ...buildSourceUrls(source?.repository, source?.remotePath)];
  return [...new Set(candidates.filter(Boolean).map(value => String(value)))];
}
function allowedPathnames(source) {
  return {
    raw: new Set([
      `/${source.repository}/master/${source.remotePath}`,
      `/${source.repository}/refs/heads/master/${source.remotePath}`
    ]),
    api: `/repos/${source.repository}/contents/${source.remotePath}`
  };
}
function assertAllowedUrl(source, url) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) throw new Error(`PATCH20_SOURCE_HOST_BLOCKED:${parsed.hostname || 'UNKNOWN'}`);
  if (!ALLOWED_REPOSITORIES.has(source.repository)) throw new Error(`PATCH20_SOURCE_REPOSITORY_BLOCKED:${source.repository || 'UNKNOWN'}`);
  const allowed = allowedPathnames(source);
  if (parsed.hostname === 'raw.githubusercontent.com') {
    if (!allowed.raw.has(decodeURIComponent(parsed.pathname)) || parsed.search) throw new Error(`PATCH20_SOURCE_PATH_MISMATCH:${source.id || 'UNKNOWN'}`);
  } else if (parsed.hostname === 'api.github.com') {
    if (decodeURIComponent(parsed.pathname) !== allowed.api) throw new Error(`PATCH20_SOURCE_PATH_MISMATCH:${source.id || 'UNKNOWN'}`);
    const keys = [...parsed.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== 'ref' || parsed.searchParams.get('ref') !== 'master') throw new Error(`PATCH20_SOURCE_QUERY_MISMATCH:${source.id || 'UNKNOWN'}`);
  } else {
    throw new Error(`PATCH20_SOURCE_HOST_BLOCKED:${parsed.hostname || 'UNKNOWN'}`);
  }
  return true;
}
function assertAllowedSource(source) {
  if (!source || typeof source !== 'object') throw new Error('PATCH20_SOURCE_REQUIRED');
  if (!/^(atp|wta)_matches(?:_qual_chall)?_20\d{2}\.csv$/i.test(source.remotePath)) throw new Error(`PATCH20_SOURCE_FILE_BLOCKED:${source.remotePath}`);
  if (!/^(atp|wta)_matches(?:_challenger)?_20\d{2}\.csv$/i.test(source.localFile)) throw new Error(`PATCH20_LOCAL_FILE_BLOCKED:${source.localFile}`);
  const candidates = sourceUrlCandidates(source);
  if (!candidates.length) throw new Error(`PATCH20_SOURCE_URL_MISSING:${source.id || 'UNKNOWN'}`);
  for (const candidate of candidates) assertAllowedUrl(source, candidate);
  return true;
}
function inspectCsvText(text, source = {}, options = {}) {
  const content = String(text || '').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) throw new Error(`PATCH20_CSV_EMPTY:${source.id || source.localFile || 'UNKNOWN'}`);
  const headers = splitCsvLine(lines[0]).map(value => String(value || '').trim());
  const index = new Map(headers.map((header, position) => [header, position]));
  const required = ['tourney_id', 'tourney_name', 'surface', 'tourney_level', 'tourney_date', 'match_num', 'winner_name', 'loser_name', 'score', 'best_of'];
  const missing = required.filter(header => !index.has(header));
  if (missing.length) throw new Error(`PATCH20_CSV_HEADER_INVALID:${source.id || 'UNKNOWN'}:${missing.join(',')}`);
  let validRows = 0; let rejectedRows = 0; let earliestMs = null; let latestMs = null;
  const futureLimitMs = new Date(options.now || Date.now()).getTime() + 3 * 86400000;
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const date = parseSackmannDate(values[index.get('tourney_date')]);
    const winner = String(values[index.get('winner_name')] || '').trim();
    const loser = String(values[index.get('loser_name')] || '').trim();
    if (!date || !winner || !loser || winner === loser || date.getTime() > futureLimitMs) { rejectedRows += 1; continue; }
    validRows += 1;
    if (earliestMs === null || date.getTime() < earliestMs) earliestMs = date.getTime();
    if (latestMs === null || date.getTime() > latestMs) latestMs = date.getTime();
  }
  const rowCount = lines.length - 1;
  const invalidRatePct = rowCount > 0 ? rejectedRows / rowCount * 100 : 100;
  const minRows = Number(source.minRows || 1);
  if (validRows < minRows) throw new Error(`PATCH20_CSV_TOO_SMALL:${source.id || 'UNKNOWN'}:${validRows}<${minRows}`);
  if (invalidRatePct > Number(options.maxInvalidRatePct ?? 3)) throw new Error(`PATCH20_CSV_INVALID_RATE:${source.id || 'UNKNOWN'}:${round(invalidRatePct, 2)}%`);
  return {
    sourceId: source.id || null,
    repository: source.repository || null,
    remotePath: source.remotePath || null,
    localFile: source.localFile || null,
    sourceTier: source.sourceTier || null,
    bytes: Buffer.byteLength(content),
    sha256: sha256(Buffer.from(content)),
    rowCount,
    validRows,
    rejectedRows,
    invalidRatePct: round(invalidRatePct, 4),
    earliestMatchAt: earliestMs === null ? null : new Date(earliestMs).toISOString(),
    latestMatchAt: latestMs === null ? null : new Date(latestMs).toISOString(),
    headers
  };
}
function inspectCsvFile(file, source = {}, options = {}) {
  if (!fs.existsSync(file)) return null;
  return inspectCsvText(fs.readFileSync(file, 'utf8'), source, options);
}
function compareRemoteToLocal(remote, local, source) {
  if (!local) return { accepted: true, reasons: ['LOCAL_FILE_ABSENT'] };
  const reasons = [];
  if (remote.validRows < Math.max(Number(source.minRows || 1), Math.floor(local.validRows * 0.8))) reasons.push('ROW_COUNT_REGRESSION');
  const remoteLatest = remote.latestMatchAt ? new Date(remote.latestMatchAt).getTime() : 0;
  const localLatest = local.latestMatchAt ? new Date(local.latestMatchAt).getTime() : 0;
  if (remoteLatest + 86400000 < localLatest) reasons.push('LATEST_DATE_REGRESSION');
  return { accepted: reasons.length === 0, reasons };
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}
function getManifestPath(dataDir = DEFAULT_DATA_DIR) {
  return path.join(path.resolve(dataDir), MANIFEST_FILE);
}
function getFailurePath(dataDir = DEFAULT_DATA_DIR) {
  return path.join(path.resolve(dataDir), FAILURE_FILE);
}
function freshnessStatus(latestMatchAt, now = new Date()) {
  const latestMs = latestMatchAt ? new Date(latestMatchAt).getTime() : NaN;
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(latestMs) || !Number.isFinite(nowMs)) return { status: 'UNAVAILABLE', dataAgeDays: null };
  const dataAgeDays = Math.max(0, (nowMs - latestMs) / 86400000);
  const status = dataAgeDays <= 21 ? 'CURRENT' : dataAgeDays <= 45 ? 'AGING' : 'STALE';
  return { status, dataAgeDays: round(dataAgeDays, 1) };
}
function inspectLocalSources(dataDir = DEFAULT_DATA_DIR, options = {}) {
  const resolved = path.resolve(dataDir);
  const sources = options.sources || defaultSources(options.year || currentYear(options.now));
  const files = [];
  for (const source of sources) {
    assertAllowedSource(source);
    const file = path.join(resolved, source.localFile);
    const inspection = inspectCsvFile(file, source, { now: options.now, maxInvalidRatePct: options.maxInvalidRatePct });
    files.push(inspection ? { ...inspection, exists: true } : { sourceId: source.id, localFile: source.localFile, sourceTier: source.sourceTier, exists: false });
  }
  const valid = files.filter(file => file.exists && file.latestMatchAt);
  const latest = valid.map(file => new Date(file.latestMatchAt).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const freshness = freshnessStatus(Number.isFinite(latest) ? new Date(latest).toISOString() : null, options.now || new Date());
  return {
    dataDir: resolved,
    files,
    latestMatchAt: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
    ...freshness
  };
}
function safeResponseHeaders(headers = {}) {
  const output = {};
  for (const key of ['content-type', 'content-length', 'etag', 'last-modified', 'retry-after', 'x-github-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'server', 'location']) {
    if (headers[key] !== undefined) output[key] = String(headers[key]);
  }
  return output;
}
function makeDownloadError(code, context = {}, cause = null) {
  const sourceId = context.sourceId || 'UNKNOWN';
  const status = context.httpStatus ? `:${context.httpStatus}` : '';
  const error = new Error(`${code}:${sourceId}${status}`);
  error.code = code;
  error.httpStatus = context.httpStatus || null;
  error.sourceId = sourceId;
  error.patch20Network = {
    policyVersion: TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION,
    sourceId,
    repository: context.repository || null,
    remotePath: context.remotePath || null,
    url: context.url || null,
    attempt: context.attempt || null,
    maxAttempts: context.maxAttempts || null,
    candidateIndex: context.candidateIndex ?? null,
    httpStatus: context.httpStatus || null,
    responseHeaders: context.responseHeaders || {},
    retryable: context.retryable === true,
    causeCode: cause?.code || null,
    causeMessage: cause?.message || null,
    observedAt: new Date().toISOString()
  };
  if (cause?.stack) error.cause = cause;
  return error;
}
function decodeGitHubContentsApiResponse(text, headers = {}) {
  const raw = String(text || '');
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  if (!contentType.includes('json') && !/^\s*\{/.test(raw)) return raw;
  let payload;
  try { payload = JSON.parse(raw); }
  catch (_) { return raw; }
  if (payload && payload.encoding === 'base64' && typeof payload.content === 'string') {
    return Buffer.from(payload.content.replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  return raw;
}
function requestText(url, options = {}) {
  const maxBytes = Number(options.maxBytes || MAX_DOWNLOAD_BYTES);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const source = options.source || {};
  const commonHeaders = { 'User-Agent': 'BettingApp-Tennis-Patch20-R1/2.1', ...(options.headers || {}) };
  const visit = (target, redirects = 0) => new Promise((resolve, reject) => {
    if (redirects > 5) return reject(makeDownloadError('PATCH20_TOO_MANY_REDIRECTS', { ...options, sourceId: source.id, repository: source.repository, remotePath: source.remotePath, url: target }));
    let parsed;
    try { parsed = new URL(target); assertAllowedUrl(source, parsed.toString()); }
    catch (error) { return reject(error); }
    const transport = sourceTransport(parsed.toString());
    const requestHeaders = transport === 'GITHUB_CONTENTS_API'
      ? { ...commonHeaders, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' }
      : { ...commonHeaders, Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1' };
    const request = https.get(parsed, { headers: requestHeaders, timeout: timeoutMs }, response => {
      const statusCode = Number(response.statusCode || 0);
      const responseHeaders = safeResponseHeaders(response.headers);
      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, parsed).toString();
        try { assertAllowedUrl(source, next); }
        catch (error) { return reject(makeDownloadError('PATCH20_REDIRECT_BLOCKED', { ...options, sourceId: source.id, repository: source.repository, remotePath: source.remotePath, url: next, httpStatus: statusCode, responseHeaders }, error)); }
        return visit(next, redirects + 1).then(resolve, reject);
      }
      if (statusCode === 304) {
        response.resume();
        return resolve({ statusCode, text: null, headers: response.headers, url: parsed.toString(), redirects });
      }
      if (statusCode !== 200) {
        let errorBody = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { if (errorBody.length < 1024) errorBody += chunk.slice(0, 1024 - errorBody.length); });
        response.on('end', () => reject(makeDownloadError(`PATCH20_HTTP_${statusCode || 'UNKNOWN'}`, {
          ...options,
          sourceId: source.id,
          repository: source.repository,
          remotePath: source.remotePath,
          url: parsed.toString(),
          httpStatus: statusCode,
          responseHeaders: { ...responseHeaders, bodyPreview: errorBody.replace(/\s+/g, ' ').trim().slice(0, 300) },
          retryable: RETRYABLE_HTTP_STATUS.has(statusCode)
            || (statusCode === 403 && (responseHeaders['retry-after'] !== undefined || responseHeaders['x-ratelimit-remaining'] === '0'))
        })));
        return;
      }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) { request.destroy(makeDownloadError('PATCH20_DOWNLOAD_TOO_LARGE', { ...options, sourceId: source.id, repository: source.repository, remotePath: source.remotePath, url: parsed.toString() })); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const rawText = Buffer.concat(chunks).toString('utf8');
        const decodedText = transport === 'GITHUB_CONTENTS_API'
          ? decodeGitHubContentsApiResponse(rawText, response.headers)
          : rawText;
        resolve({ statusCode, text: decodedText, headers: response.headers, url: parsed.toString(), redirects, transport });
      });
    });
    request.on('timeout', () => request.destroy(makeDownloadError('PATCH20_DOWNLOAD_TIMEOUT', { ...options, sourceId: source.id, repository: source.repository, remotePath: source.remotePath, url: parsed.toString(), retryable: true })));
    request.on('error', error => {
      if (error?.patch20Network) return reject(error);
      const retryable = RETRYABLE_NETWORK_CODES.has(error?.code);
      return reject(makeDownloadError('PATCH20_NETWORK_ERROR', { ...options, sourceId: source.id, repository: source.repository, remotePath: source.remotePath, url: parsed.toString(), retryable }, error));
    });
  });
  return visit(url);
}
function retryAfterMs(error) {
  const raw = error?.patch20Network?.responseHeaders?.['retry-after'];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(30000, Math.max(0, seconds * 1000));
  const date = new Date(raw).getTime();
  return Number.isFinite(date) ? Math.min(30000, Math.max(0, date - Date.now())) : null;
}
function isRetryableDownloadError(error) {
  if (error?.patch20Network?.retryable === true) return true;
  if (RETRYABLE_HTTP_STATUS.has(Number(error?.httpStatus))) return true;
  if (RETRYABLE_NETWORK_CODES.has(error?.code)) return true;
  return /PATCH20_(?:HTTP_(?:404|408|425|429|500|502|503|504)|DOWNLOAD_TIMEOUT|NETWORK_ERROR)/.test(String(error?.message || ''));
}
async function downloadSourceWithPolicy(source, options = {}) {
  assertAllowedSource(source);
  const downloader = options.downloader || requestText;
  const retryCustomDownloader = options.retryCustomDownloader === true;
  const productionDownloader = downloader === requestText;
  const retryDelays = (productionDownloader || retryCustomDownloader)
    ? (Array.isArray(options.retryDelaysMs) && options.retryDelaysMs.length ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS)
    : [0];
  const candidates = sourceUrlCandidates(source);
  const candidateOrder = candidates.length === 3 ? [0, 1, 2, 1] : candidates.map((_, index) => index);
  const sleepFn = options.sleepFn || sleep;
  const attempts = [];
  let lastError = null;
  for (let attemptIndex = 0; attemptIndex < retryDelays.length; attemptIndex += 1) {
    const candidateIndex = candidateOrder[attemptIndex] ?? (attemptIndex % candidates.length);
    const url = candidates[candidateIndex];
    const delayMs = attemptIndex === 0 ? 0 : (retryAfterMs(lastError) ?? Number(retryDelays[attemptIndex] || 0));
    if (delayMs > 0) await sleepFn(delayMs);
    const attempt = attemptIndex + 1;
    const startedAt = new Date().toISOString();
    try {
      const response = await downloader(url, {
        ...options,
        source,
        attempt,
        maxAttempts: retryDelays.length,
        candidateIndex,
        timeoutMs: options.timeoutMs,
        maxBytes: options.maxBytes || MAX_DOWNLOAD_BYTES
      });
      attempts.push({ attempt, candidateIndex, url, transport: response?.transport || sourceTransport(url), statusCode: Number(response?.statusCode || 0), success: true, startedAt, completedAt: new Date().toISOString() });
      return { response, attempts, resolvedUrl: response?.url || url, candidateIndex };
    } catch (error) {
      lastError = error;
      const retryable = isRetryableDownloadError(error);
      attempts.push({
        attempt,
        candidateIndex,
        url,
        transport: sourceTransport(url),
        statusCode: Number(error?.httpStatus || error?.patch20Network?.httpStatus || 0) || null,
        success: false,
        retryable,
        error: error?.message || String(error),
        startedAt,
        completedAt: new Date().toISOString()
      });
      if (!retryable || attempt === retryDelays.length) break;
    }
  }
  if (!lastError) lastError = makeDownloadError('PATCH20_DOWNLOAD_FAILED', { sourceId: source.id, repository: source.repository, remotePath: source.remotePath });
  lastError.patch20Attempts = attempts;
  lastError.patch20Network = { ...(lastError.patch20Network || {}), attempts, exhausted: true, sourceId: source.id, repository: source.repository, remotePath: source.remotePath };
  throw lastError;
}
async function probePlayerDataSources(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const sources = options.sources || defaultSources(options.year || currentYear(now));
  const results = [];
  for (const source of sources) {
    const startedAt = new Date().toISOString();
    try {
      const downloaded = await downloadSourceWithPolicy(source, options);
      const response = downloaded.response;
      if (Number(response?.statusCode) === 304) throw makeDownloadError('PATCH20_PROBE_304_UNSUPPORTED', { sourceId: source.id, repository: source.repository, remotePath: source.remotePath, url: downloaded.resolvedUrl });
      const inspection = inspectCsvText(response?.text, source, { now, maxInvalidRatePct: options.maxInvalidRatePct });
      results.push({
        sourceId: source.id,
        status: 'PASS',
        httpStatus: Number(response?.statusCode || 200),
        resolvedUrl: downloaded.resolvedUrl,
        attempts: downloaded.attempts,
        inspection,
        startedAt,
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      results.push({
        sourceId: source.id,
        status: 'FAIL',
        error: error.message,
        diagnostics: error.patch20Network || null,
        attempts: error.patch20Attempts || error.patch20Network?.attempts || [],
        startedAt,
        completedAt: new Date().toISOString()
      });
    }
  }
  return {
    success: results.every(item => item.status === 'PASS'),
    version: TENNIS_PLAYER_DATA_REFRESH_VERSION,
    requestPolicyVersion: TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION,
    mode: 'NETWORK_PROBE_READ_ONLY_NO_ACTIVATION',
    sources: results,
    generatedAt: new Date().toISOString(),
    dataChanged: false,
    activationPerformed: false,
    modelProbabilityAuthority: false,
    stakeAuthority: false
  };
}
function acquireLock(dataDir, options = {}) {
  const lockPath = path.join(dataDir, LOCK_FILE);
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(lockPath)) {
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (ageMs > Number(options.staleLockMs || 30 * 60 * 1000)) fs.rmSync(lockPath, { force: true });
  }
  let fd;
  try { fd = fs.openSync(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('PATCH20_REFRESH_ALREADY_RUNNING');
    throw error;
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  return () => {
    try { fs.closeSync(fd); } catch (_) {}
    try { fs.rmSync(lockPath, { force: true }); } catch (_) {}
  };
}
function copyCsvSet(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  if (!fs.existsSync(sourceDir)) return;
  for (const name of fs.readdirSync(sourceDir)) {
    if (!/^(atp|wta)_matches.*\.csv$/i.test(name)) continue;
    fs.copyFileSync(path.join(sourceDir, name), path.join(destinationDir, name));
  }
}
function retainRecentBackups(root, keep = 3) {
  if (!fs.existsSync(root)) return;
  const entries = fs.readdirSync(root).map(name => ({ name, file: path.join(root, name) }))
    .filter(item => fs.statSync(item.file).isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const item of entries.slice(keep)) fs.rmSync(item.file, { recursive: true, force: true });
}
async function refreshPlayerData(options = {}) {
  const dataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const sources = options.sources || defaultSources(options.year || currentYear(now));
  const release = acquireLock(dataDir, options);
  const manifestPath = getManifestPath(dataDir);
  const failurePath = getFailurePath(dataDir);
  const previousManifest = readJson(manifestPath, null);
  const attemptId = options.operationId || `PATCH20_DATA_REFRESH_${safeIsoForPath(now)}_${crypto.randomBytes(4).toString('hex')}`;
  const stageDir = path.join(dataDir, `.patch20_stage_${attemptId.replace(/[^a-z0-9_-]/gi, '_')}`);
  const backupRoot = path.join(dataDir, '.patch14_lkg');
  const backupDir = path.join(backupRoot, safeIsoForPath(now));
  const downloaded = [];
  const sourceDiagnostics = [];
  let activated = false;
  try {
    fs.rmSync(stageDir, { recursive: true, force: true });
    copyCsvSet(dataDir, stageDir);
    for (const source of sources) {
      assertAllowedSource(source);
      const localPath = path.join(dataDir, source.localFile);
      const local = inspectCsvFile(localPath, source, { now });
      const previousSource = previousManifest?.sources?.find(item => item.id === source.id);
      const headers = {};
      if (previousSource?.etag) headers['If-None-Match'] = previousSource.etag;
      if (previousSource?.lastModified) headers['If-Modified-Since'] = previousSource.lastModified;
      const transfer = await downloadSourceWithPolicy(source, {
        downloader: options.downloader,
        retryCustomDownloader: options.retryCustomDownloader,
        retryDelaysMs: options.retryDelaysMs,
        sleepFn: options.sleepFn,
        headers,
        timeoutMs: options.timeoutMs,
        maxBytes: MAX_DOWNLOAD_BYTES
      });
      const response = transfer.response;
      let text = response?.text;
      const notModified = Number(response?.statusCode) === 304;
      if (notModified) {
        if (!fs.existsSync(localPath)) throw new Error(`PATCH20_304_WITHOUT_LOCAL:${source.id}`);
        text = fs.readFileSync(localPath, 'utf8');
      }
      const remote = inspectCsvText(text, source, { now });
      const comparison = compareRemoteToLocal(remote, local, source);
      if (!comparison.accepted) throw new Error(`PATCH20_SOURCE_REGRESSION:${source.id}:${comparison.reasons.join(',')}`);
      fs.writeFileSync(path.join(stageDir, source.localFile), text, 'utf8');
      const diagnostic = {
        sourceId: source.id,
        resolvedUrl: transfer.resolvedUrl,
        attempts: transfer.attempts,
        status: 'PASS'
      };
      sourceDiagnostics.push(diagnostic);
      downloaded.push({
        id: source.id,
        repository: source.repository,
        remotePath: source.remotePath,
        url: transfer.resolvedUrl,
        canonicalUrl: source.url,
        urlCandidates: sourceUrlCandidates(source),
        localFile: source.localFile,
        sourceTier: source.sourceTier,
        notModified,
        etag: response?.headers?.etag || previousSource?.etag || null,
        lastModified: response?.headers?.['last-modified'] || previousSource?.lastModified || null,
        attempts: transfer.attempts,
        ...remote
      });
    }
    const playerEvidence = options.playerEvidence || require('./tennisPlayerEvidence');
    const stagedStatus = playerEvidence.init(stageDir, { force: true });
    if (!stagedStatus.initialized || !stagedStatus.matchCount) throw new Error('PATCH20_STAGED_ENGINE_NOT_READY');
    fs.mkdirSync(backupDir, { recursive: true });
    for (const source of sources) {
      const current = path.join(dataDir, source.localFile);
      if (fs.existsSync(current)) fs.copyFileSync(current, path.join(backupDir, source.localFile));
    }
    if (fs.existsSync(manifestPath)) fs.copyFileSync(manifestPath, path.join(backupDir, MANIFEST_FILE));
    for (const source of sources) {
      const staged = path.join(stageDir, source.localFile);
      const target = path.join(dataDir, source.localFile);
      const temporary = `${target}.patch20-new`;
      fs.copyFileSync(staged, temporary);
      fs.renameSync(temporary, target);
    }
    const aggregateLatest = downloaded.map(item => item.latestMatchAt).filter(Boolean).sort().slice(-1)[0] || stagedStatus.latestMatchAt || null;
    const refreshManifest = {
      version: TENNIS_PLAYER_DATA_MANIFEST_VERSION,
      refreshVersion: TENNIS_PLAYER_DATA_REFRESH_VERSION,
      requestPolicyVersion: TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION,
      operationId: attemptId,
      lastAttemptAt: nowIso(now),
      lastSuccessAt: nowIso(now),
      status: 'SUCCESS',
      dataDir,
      sources: downloaded,
      sourceDiagnostics,
      aggregate: {
        fileCount: stagedStatus.fileCount,
        matchCount: stagedStatus.matchCount,
        playerCount: stagedStatus.playerCount,
        earliestMatchAt: stagedStatus.earliestMatchAt,
        latestMatchAt: aggregateLatest,
        rejectedRows: stagedStatus.rejectedRows,
        duplicateRows: stagedStatus.duplicateRows
      },
      networkUsed: true,
      allowlistedOnly: true,
      retryAndFallbackEnabled: true,
      atomicActivation: true,
      lastKnownGoodBackup: backupDir
    };
    writeJsonAtomic(manifestPath, refreshManifest);
    const activeStatus = playerEvidence.init(dataDir, { force: true });
    if (!activeStatus.initialized || !activeStatus.matchCount) throw new Error('PATCH20_ACTIVE_ENGINE_NOT_READY');
    activated = true;
    retainRecentBackups(backupRoot, Number(options.keepBackups || 3));
    try { fs.rmSync(failurePath, { force: true }); } catch (_) {}
    return {
      success: true,
      version: TENNIS_PLAYER_DATA_REFRESH_VERSION,
      requestPolicyVersion: TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION,
      operationId: attemptId,
      status: 'SUCCESS',
      sources: downloaded,
      sourceDiagnostics,
      activeStatus,
      manifest: refreshManifest,
      dataChanged: downloaded.some(item => item.notModified !== true),
      probabilityWeightsChanged: false,
      deepScanChanged: false,
      qualityGateChanged: false,
      stakePolicyChanged: false
    };
  } catch (error) {
    if (fs.existsSync(backupDir)) {
      for (const source of sources) {
        const backup = path.join(backupDir, source.localFile);
        const target = path.join(dataDir, source.localFile);
        if (fs.existsSync(backup)) fs.copyFileSync(backup, target);
      }
      const backupManifest = path.join(backupDir, MANIFEST_FILE);
      if (fs.existsSync(backupManifest)) fs.copyFileSync(backupManifest, manifestPath);
      else if (!previousManifest) fs.rmSync(manifestPath, { force: true });
    }
    try { (options.playerEvidence || require('./tennisPlayerEvidence')).init(dataDir, { force: true }); } catch (_) {}
    let localHealth = null;
    try { localHealth = inspectLocalSources(dataDir, { now, sources }); } catch (_) {}
    const localSourcesAvailable = Array.isArray(localHealth?.files) && localHealth.files.length > 0 && localHealth.files.every(item => item.exists === true);
    const failure = {
      version: TENNIS_PLAYER_DATA_MANIFEST_VERSION,
      refreshVersion: TENNIS_PLAYER_DATA_REFRESH_VERSION,
      requestPolicyVersion: TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION,
      operationId: attemptId,
      lastAttemptAt: nowIso(now),
      lastSuccessAt: previousManifest?.lastSuccessAt || null,
      status: localSourcesAvailable ? 'FAILED_USING_LAST_KNOWN_GOOD' : 'FAILED_NO_CERTIFIED_LOCAL_DATA',
      error: error.message,
      errorCode: error.code || null,
      sourceId: error.sourceId || error.patch20Network?.sourceId || null,
      networkDiagnostics: error.patch20Network || null,
      attempts: error.patch20Attempts || error.patch20Network?.attempts || [],
      sourceDiagnostics,
      networkUsed: true,
      allowlistedOnly: true,
      retryAndFallbackEnabled: true,
      atomicActivation: true,
      activatedBeforeFailure: activated,
      restoredLastKnownGood: fs.existsSync(backupDir),
      localSourcesAvailable,
      localLatestMatchAt: localHealth?.latestMatchAt || null,
      degradedUsingLastKnownGood: localSourcesAvailable
    };
    try { writeJsonAtomic(failurePath, failure); } catch (_) {}
    error.patch20 = failure;
    error.patch14 = failure;
    throw error;
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
    release();
  }
}
function getPlayerDataHealth(options = {}) {
  const dataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
  const manifest = readJson(getManifestPath(dataDir), null);
  const lastFailure = readJson(getFailurePath(dataDir), null);
  let engine = null; let engineError = null;
  try {
    const playerEvidence = options.playerEvidence || require('./tennisPlayerEvidence');
    if (options.initialize !== false) playerEvidence.init(dataDir, { force: options.force === true });
    engine = playerEvidence.getStatus();
  } catch (error) { engineError = error.message; }
  const local = inspectLocalSources(dataDir, { now: options.now || new Date(), sources: options.sources });
  const freshness = freshnessStatus(engine?.latestMatchAt || local.latestMatchAt, options.now || new Date());
  const manifestAgeHours = manifest?.lastSuccessAt ? Math.max(0, (new Date(options.now || Date.now()).getTime() - new Date(manifest.lastSuccessAt).getTime()) / 3600000) : null;
  const missingSources = local.files.filter(file => !file.exists).map(file => file.sourceId);
  const errors = [];
  if (engineError) errors.push(`ENGINE:${engineError}`);
  if (missingSources.length) errors.push(`MISSING_SOURCES:${missingSources.join(',')}`);
  const status = errors.length ? 'ERROR' : freshness.status;
  const localSourcesAvailable = local.files.length > 0 && local.files.every(file => file.exists === true);
  const failureMs = lastFailure?.lastAttemptAt ? new Date(lastFailure.lastAttemptAt).getTime() : NaN;
  const successMs = manifest?.lastSuccessAt ? new Date(manifest.lastSuccessAt).getTime() : NaN;
  const unresolvedFailure = Number.isFinite(failureMs) && (!Number.isFinite(successMs) || failureMs > successMs);
  const degradedUsingLastKnownGood = unresolvedFailure && localSourcesAvailable && errors.length === 0;
  const refreshState = errors.length
    ? 'PLAYER_DATA_REFRESH_ERROR_NO_CERTIFIED_DATA'
    : degradedUsingLastKnownGood
      ? 'PLAYER_DATA_REFRESH_DEGRADED_USING_LAST_KNOWN_GOOD'
      : status === 'CURRENT'
        ? 'PLAYER_DATA_REFRESH_CURRENT'
        : status === 'AGING'
          ? 'PLAYER_DATA_REFRESH_AGING'
          : 'PLAYER_DATA_REFRESH_STALE';
  let multiProvider = null;
  try { multiProvider = require('./tennisMultiProviderData').getHealth({ dataDir, now: options.now || new Date() }); }
  catch (error) { multiProvider = { success: false, status: 'UNAVAILABLE', error: error.message }; }
  let tourReadiness = null;
  try {
    tourReadiness = require('./tennisTourDataReadiness').buildTargetReadiness({
      dataDir,
      now: options.now || new Date(),
      multiProviderHealth: multiProvider,
      sources: options.sources,
      projectRoot: options.projectRoot
    });
  } catch (error) {
    tourReadiness = { success: false, status: 'UNAVAILABLE', error: error.message, targets: [], tours: [] };
  }
  return {
    success: errors.length === 0,
    healthy: errors.length === 0 && status !== 'STALE',
    status,
    refreshState,
    degradedUsingLastKnownGood,
    version: TENNIS_PLAYER_DATA_REFRESH_VERSION,
    manifestVersion: TENNIS_PLAYER_DATA_MANIFEST_VERSION,
    requestPolicyVersion: TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION,
    mode: multiProvider?.status && multiProvider.status !== 'NOT_YET_REFRESHED'
      ? 'MULTI_PROVIDER_ZERO_KEY_FIRST_ATOMIC_LAST_KNOWN_GOOD'
      : 'ALLOWLISTED_ATOMIC_RETRY_FALLBACK_LAST_KNOWN_GOOD',
    multiProvider,
    tourReadiness,
    readinessStatus: tourReadiness?.status || status,
    mixedFreshnessDetected: tourReadiness?.mixedFreshnessDetected === true,
    sourceFreshnessNotMasked: tourReadiness?.sourceFreshnessNotMasked === true,
    providerStrategy: multiProvider?.strategy || null,
    dataDir,
    latestMatchAt: engine?.latestMatchAt || local.latestMatchAt,
    dataAgeDays: freshness.dataAgeDays,
    engine,
    localSources: local.files,
    manifest,
    lastFailure: unresolvedFailure ? lastFailure : null,
    manifestAgeHours: manifestAgeHours === null ? null : round(manifestAgeHours, 1),
    lastRefreshAt: manifest?.lastSuccessAt || null,
    lastRefreshAttemptAt: lastFailure?.lastAttemptAt || manifest?.lastAttemptAt || null,
    neverRefreshed: !manifest?.lastSuccessAt,
    errors,
    autoRefreshEnabled: String(process.env.TENNIS_PLAYER_DATA_AUTO_REFRESH || '1') !== '0',
    autoRefreshRecurring: true,
    autoRefreshRevision: AUDIT16D_R3_T2_RECURRING_REFRESH_REVISION,
    autoRefreshIntervalHours: Math.max(MIN_AUTO_REFRESH_INTERVAL_HOURS, finite(process.env.TENNIS_PLAYER_DATA_REFRESH_HOURS, AUTO_REFRESH_INTERVAL_HOURS)),
    retryDelaysMs: [...DEFAULT_RETRY_DELAYS_MS],
    probabilityWeightsChanged: false,
    deepScanSeparate: true,
    qualityGateAuthority: false,
    stakeAuthority: false,
    note: errors.length
      ? 'Dati giocatori non certificabili: almeno un controllo critico è fallito.'
      : degradedUsingLastKnownGood
        ? `Ultimo refresh di rete non riuscito (${lastFailure?.sourceId || 'fonte non identificata'}). Dataset locale last-known-good preservato e utilizzabile in modalità prudente.`
        : tourReadiness?.status === 'MIXED_CURRENT_STALE'
          ? 'Dati giocatori a freschezza mista: ATP corrente, almeno un segmento WTA/altro obsoleto. Il motore applica la freschezza per circuito senza mascheramento aggregato.'
          : status === 'CURRENT'
            ? 'Dati giocatori aggregati correnti; la readiness per circuito resta disponibile separatamente.'
            : status === 'AGING'
              ? 'Dati giocatori in invecchiamento: aggiornamento consigliato.'
              : 'Dati giocatori obsoleti: il motore resta prudente e limita l’evidenza.'
  };
}
function shouldAutoRefresh(health, options = {}) {
  if (String(process.env.TENNIS_PLAYER_DATA_AUTO_REFRESH || '1') === '0') return false;
  const intervalHours = Math.max(MIN_AUTO_REFRESH_INTERVAL_HOURS, finite(options.intervalHours ?? process.env.TENNIS_PLAYER_DATA_REFRESH_HOURS, AUTO_REFRESH_INTERVAL_HOURS));
  if (health.status === 'ERROR' || health.status === 'STALE' || health.neverRefreshed || health.degradedUsingLastKnownGood) return true;
  return health.manifestAgeHours === null || health.manifestAgeHours >= intervalHours;
}
function scheduleAutoRefresh(options = {}) {
  if (process.env.NODE_ENV === 'test') return { scheduled: false, reason: 'TEST_ENVIRONMENT', revision:AUDIT16D_R3_T2_RECURRING_REFRESH_REVISION };
  if (global.__TENNIS_PATCH20_AUTO_REFRESH_SCHEDULED) return { scheduled: false, reason: 'ALREADY_SCHEDULED', revision:AUDIT16D_R3_T2_RECURRING_REFRESH_REVISION };
  global.__TENNIS_PATCH20_AUTO_REFRESH_SCHEDULED = true;
  const delayMs = Number(options.delayMs ?? 15000);
  const intervalHours = Math.max(MIN_AUTO_REFRESH_INTERVAL_HOURS, finite(options.intervalHours ?? process.env.TENNIS_PLAYER_DATA_REFRESH_HOURS, AUTO_REFRESH_INTERVAL_HOURS));
  const intervalMs = intervalHours * 3600000;
  const setTimer = options.setTimeoutFn || setTimeout;
  const tick = async () => {
    try {
      const health = getPlayerDataHealth({ dataDir: options.dataDir || DEFAULT_DATA_DIR });
      if (shouldAutoRefresh(health, { ...options, intervalHours })) {
        const refreshFn = typeof options.refreshFn === 'function'
          ? options.refreshFn
          : (() => {
              try { return require('./tennisMultiProviderData').refreshMultiProvider; }
              catch (_) { return refreshPlayerData; }
            })();
        const result = await refreshFn({ dataDir: options.dataDir || DEFAULT_DATA_DIR, operationId: `PATCH21_AUTO_${Date.now()}` });
        if (typeof options.onSuccess === 'function') options.onSuccess(result);
      }
    } catch (error) {
      if (typeof options.onError === 'function') options.onError(error);
    } finally {
      const next = setTimer(tick, intervalMs);
      if (typeof next?.unref === 'function') next.unref();
      global.__TENNIS_PATCH20_AUTO_REFRESH_TIMER = next;
    }
  };
  const timer = setTimer(tick, delayMs);
  if (typeof timer?.unref === 'function') timer.unref();
  global.__TENNIS_PATCH20_AUTO_REFRESH_TIMER = timer;
  return { scheduled: true, delayMs, recurring:true, intervalHours, revision:AUDIT16D_R3_T2_RECURRING_REFRESH_REVISION };
}

module.exports = {
  TENNIS_PLAYER_DATA_REFRESH_VERSION,
  TENNIS_PLAYER_DATA_MANIFEST_VERSION,
  TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION,
  TENNIS_PLAYER_DATA_REFRESH_REVISION,
  AUDIT16D_R3_T2_RECURRING_REFRESH_REVISION,
  AUTO_REFRESH_INTERVAL_HOURS,
  MIN_AUTO_REFRESH_INTERVAL_HOURS,
  DEFAULT_DATA_DIR,
  MANIFEST_FILE,
  FAILURE_FILE,
  ALLOWED_HOSTS,
  ALLOWED_REPOSITORIES,
  DEFAULT_RETRY_DELAYS_MS,
  RETRYABLE_HTTP_STATUS,
  defaultSources,
  sourceUrlCandidates,
  sourceTransport,
  assertAllowedSource,
  inspectCsvText,
  inspectCsvFile,
  compareRemoteToLocal,
  inspectLocalSources,
  freshnessStatus,
  requestText,
  decodeGitHubContentsApiResponse,
  isRetryableDownloadError,
  downloadSourceWithPolicy,
  probePlayerDataSources,
  refreshPlayerData,
  getPlayerDataHealth,
  shouldAutoRefresh,
  scheduleAutoRefresh
};
