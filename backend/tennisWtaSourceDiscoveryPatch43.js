'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const VERSION = 'TENNIS_WTA_SOURCE_DISCOVERY_V1_PATCH43';
const POLICY_VERSION = 'TENNIS_WTA_SOURCE_POLICY_V1_PATCH43';
const STATE_FILE = 'tennis_wta_patch43_source_state.json';
const CACHE_DIR = '.tennis_wta_patch43_cache';
const MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 4;
const MIN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const NETWORK_HOSTS = new Set([
  'api.github.com',
  'raw.githubusercontent.com',
  'huggingface.co',
  'cdn-lfs.hf.co',
  'cas-bridge.xethub.hf.co'
]);

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function nowIso(value = new Date()) { const d = value instanceof Date ? value : new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString(); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function writeJsonAtomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.tmp-${process.pid}-${Date.now()}`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fs.renameSync(temp, file); }
function safeUrl(value) { try { const url = new URL(String(value)); url.search = ''; return url.toString(); } catch (_) { return String(value || ''); } }
function isNonCommercial(options = {}) { const mode = String(options.usageMode || process.env.TENNIS_DATA_USAGE_MODE || 'PERSONAL_RESEARCH').trim().toUpperCase(); return { mode, allowed: !['COMMERCIAL', 'PRODUCTION_COMMERCIAL'].includes(mode) }; }
function localImportAuthorized(options = {}) { return options.manualImportAuthorized === true || String(process.env.TENNISDATA_APP_IMPORT_AUTHORIZED || '0') === '1'; }
function sourceLicense(providerId) { if (providerId === 'TENNISDATA_APP_LOCAL_IMPORT') return 'USER_AUTHORIZED_LOCAL_FILE'; if (providerId === 'LAST_KNOWN_GOOD') return 'LOCAL_ACTIVE'; return 'CC_BY_NC_SA_4_0'; }
function sourceRegistry(year, options = {}) {
  const use = isNonCommercial(options);
  const manualAuthorized = localImportAuthorized(options);
  return Object.freeze([
    Object.freeze({ id: 'TENNISDATA_APP_LOCAL_IMPORT', priority: 0, enabled: manualAuthorized, network: false, authority: 'DATA_CANDIDATE', license: 'USER_AUTHORIZED_LOCAL_FILE', pathPattern: `${year}-wta-season.csv` }),
    Object.freeze({ id: 'JEFF_SACKMANN_GITHUB_DISCOVERY', priority: 10, enabled: use.allowed && options.skipNetwork !== true, network: true, authority: 'DATA_CANDIDATE', license: 'CC_BY_NC_SA_4_0', hosts: ['api.github.com', 'raw.githubusercontent.com'] }),
    Object.freeze({ id: 'HUGGINGFACE_SACKMANN_ARCHIVE', priority: 20, enabled: use.allowed && options.skipNetwork !== true, network: true, authority: 'MIRROR_DATA_CANDIDATE', license: 'CC_BY_NC_SA_4_0', hosts: ['huggingface.co', 'cdn-lfs.hf.co', 'cas-bridge.xethub.hf.co'] }),
    Object.freeze({ id: 'LAST_KNOWN_GOOD', priority: 1000, enabled: true, network: false, authority: 'SAFE_FALLBACK', license: 'LOCAL_ACTIVE' })
  ]);
}
function assertNetworkUrl(url) { const parsed = new URL(String(url)); if (parsed.protocol !== 'https:' || !NETWORK_HOSTS.has(parsed.hostname)) throw new Error(`PATCH43_WTA_HOST_BLOCKED:${parsed.hostname}`); return parsed; }
function requestText(url, options = {}, redirectCount = 0) {
  assertNetworkUrl(url);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'BettingApp-WTA-Patch43/1.0', 'Accept': 'text/csv,application/json;q=0.9,*/*;q=0.5', ...(options.headers || {}) } }, response => {
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) return reject(new Error('PATCH43_WTA_TOO_MANY_REDIRECTS'));
        const next = new URL(response.headers.location, url).toString();
        try { assertNetworkUrl(next); } catch (error) { return reject(error); }
        return resolve(requestText(next, options, redirectCount + 1));
      }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > Number(options.maxBytes || MAX_BYTES)) req.destroy(new Error('PATCH43_WTA_DOWNLOAD_TOO_LARGE')); else chunks.push(chunk); });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((status >= 200 && status < 300) || status === 304) return resolve({ statusCode: status, text, headers: response.headers, url: safeUrl(url), redirectCount });
        const error = new Error(`PATCH43_WTA_HTTP_${status}`); error.httpStatus = status; error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(status); error.url = safeUrl(url); reject(error);
      });
    });
    req.setTimeout(Number(options.timeoutMs || DEFAULT_TIMEOUT_MS), () => req.destroy(Object.assign(new Error('PATCH43_WTA_TIMEOUT'), { code: 'ETIMEDOUT', retryable: true })));
    req.on('error', reject);
  });
}
function cachePaths(dataDir, providerId, year) { const root = path.join(dataDir, CACHE_DIR, providerId); return { root, body: path.join(root, `wta_${year}.csv`), meta: path.join(root, `wta_${year}.json`) }; }
async function cachedFetch(resource, options = {}) {
  const cache = cachePaths(path.resolve(options.dataDir), resource.providerId, resource.year);
  const prior = readJson(cache.meta, null); const now = new Date(options.now || Date.now());
  const ageHours = prior?.fetchedAt ? Math.max(0, (now.getTime() - new Date(prior.fetchedAt).getTime()) / 3600000) : Infinity;
  if (!options.force && fs.existsSync(cache.body) && ageHours < Number(options.cacheHours || 6)) return { text: fs.readFileSync(cache.body, 'utf8'), providerId: resource.providerId, fromCache: true, networkCalls: 0, resolvedUrl: prior?.resolvedUrl || null, diagnostics: [{ status: 'CACHE_HIT', ageHours: Number(ageHours.toFixed(3)) }] };
  const headers = {}; if (prior?.etag) headers['If-None-Match'] = prior.etag; if (prior?.lastModified) headers['If-Modified-Since'] = prior.lastModified;
  const requester = options.requester || requestText;
  const response = await requester(resource.url, { timeoutMs: options.timeoutMs, headers, maxBytes: options.maxBytes });
  if (Number(response.statusCode) === 304 && fs.existsSync(cache.body)) return { text: fs.readFileSync(cache.body, 'utf8'), providerId: resource.providerId, fromCache: true, networkCalls: 1, resolvedUrl: prior?.resolvedUrl || safeUrl(resource.url), diagnostics: [{ status: 'NOT_MODIFIED' }] };
  if (!response.text || !String(response.text).trim()) throw new Error(`PATCH43_WTA_EMPTY:${resource.providerId}`);
  fs.mkdirSync(cache.root, { recursive: true }); fs.writeFileSync(cache.body, response.text, 'utf8');
  const meta = { providerId: resource.providerId, year: resource.year, fetchedAt: nowIso(now), resolvedUrl: safeUrl(response.url || resource.url), etag: response.headers?.etag || null, lastModified: response.headers?.['last-modified'] || null, bytes: Buffer.byteLength(response.text), sha256: sha256(Buffer.from(response.text)), license: resource.license };
  writeJsonAtomic(cache.meta, meta);
  return { text: response.text, providerId: resource.providerId, fromCache: false, networkCalls: 1, resolvedUrl: meta.resolvedUrl, diagnostics: [{ status: 'FETCHED', resolvedUrl: meta.resolvedUrl }] };
}
function parseRepoMetadata(text) { const parsed = JSON.parse(text); if (!parsed || typeof parsed.default_branch !== 'string') throw new Error('PATCH43_WTA_GITHUB_METADATA_INVALID'); return parsed; }
function parseGithubContent(text) { const parsed = JSON.parse(text); if (!parsed || typeof parsed.download_url !== 'string' || !parsed.download_url) throw new Error('PATCH43_WTA_GITHUB_CONTENT_INVALID'); return parsed; }
async function fetchGithubCandidate(year, options = {}) {
  const requester = options.requester || requestText; const calls = [];
  const metaUrl = 'https://api.github.com/repos/JeffSackmann/tennis_wta';
  const metaResponse = await requester(metaUrl, { timeoutMs: options.timeoutMs, headers: { Accept: 'application/vnd.github+json' } }); calls.push({ phase: 'REPO_METADATA', statusCode: metaResponse.statusCode, url: safeUrl(metaUrl) });
  const repo = parseRepoMetadata(metaResponse.text); const branch = repo.default_branch || 'master';
  const contentUrl = `https://api.github.com/repos/JeffSackmann/tennis_wta/contents/wta_matches_${year}.csv?ref=${encodeURIComponent(branch)}`;
  const contentResponse = await requester(contentUrl, { timeoutMs: options.timeoutMs, headers: { Accept: 'application/vnd.github+json' } }); calls.push({ phase: 'CONTENTS_DISCOVERY', statusCode: contentResponse.statusCode, url: safeUrl(contentUrl), branch });
  const content = parseGithubContent(contentResponse.text);
  const fetched = await cachedFetch({ providerId: 'JEFF_SACKMANN_GITHUB_DISCOVERY', year, url: content.download_url, license: 'CC_BY_NC_SA_4_0' }, options);
  return { ...fetched, diagnostics: [...calls, ...(fetched.diagnostics || [])], branch, discoveredPath: content.path || `wta_matches_${year}.csv` };
}
async function fetchHuggingFaceCandidate(year, options = {}) {
  const url = `https://huggingface.co/datasets/Aneeshers/tennis-sackmann-archive/resolve/main/wta/wta_matches_${year}.csv`;
  return cachedFetch({ providerId: 'HUGGINGFACE_SACKMANN_ARCHIVE', year, url, license: 'CC_BY_NC_SA_4_0' }, options);
}
function manualImportPaths(projectRoot, year) {
  const root = path.join(path.resolve(projectRoot), 'data', 'tennis_provider_imports', 'tennisdata-app');
  return [path.join(root, `${year}-wta-season.csv`), path.join(root, `WTA_${year}.csv`), path.join(root, `wta_${year}.csv`)];
}
function fetchManualCandidate(year, options = {}) {
  if (!localImportAuthorized(options)) throw new Error('PATCH43_TENNISDATA_MANUAL_IMPORT_NOT_AUTHORIZED');
  const multi = options.multiProvider || require('./tennisMultiProviderData'); const paths = manualImportPaths(options.projectRoot || path.resolve(__dirname, '..'), year); const file = paths.find(candidate => fs.existsSync(candidate));
  if (!file) throw new Error('PATCH43_TENNISDATA_MANUAL_FILE_MISSING');
  const raw = fs.readFileSync(file, 'utf8'); const text = multi.normalizeTennisDataCsv(raw, { targetId: 'WTA_MAIN', providerId: 'TENNISDATA_APP_LOCAL_IMPORT' });
  return { providerId: 'TENNISDATA_APP_LOCAL_IMPORT', text, fromCache: false, networkCalls: 0, sourcePath: file, diagnostics: [{ status: 'LOCAL_IMPORT', path: file }] };
}
function targetForYear(year, options = {}) { const multi = options.multiProvider || require('./tennisMultiProviderData'); return multi.targetRegistry(year).find(item => item.id === 'WTA_MAIN'); }
function inspect(text, year, providerId, options = {}) { const refresh = options.refreshModule || require('./tennisPlayerDataRefresh'); const target = targetForYear(year, options); return refresh.inspectCsvText(text, { ...target, sourceTier: `PATCH43_${providerId}` }, { now: options.now, maxInvalidRatePct: 5 }); }
function compare(candidateInspection, localInspection, year, options = {}) { const refresh = options.refreshModule || require('./tennisPlayerDataRefresh'); return refresh.compareRemoteToLocal(candidateInspection, localInspection, { id: 'WTA_MAIN', localFile: `wta_matches_${year}.csv` }); }
function candidateRank(candidate) { const date = candidate.inspection?.latestMatchAt ? new Date(candidate.inspection.latestMatchAt).getTime() : 0; return [Number.isFinite(date) ? date : 0, Number(candidate.inspection?.validRows || 0), -Number(candidate.priority || 999)]; }
function better(a, b) { const ra = candidateRank(a), rb = candidateRank(b); for (let i = 0; i < ra.length; i += 1) { if (ra[i] !== rb[i]) return ra[i] > rb[i] ? a : b; } return a; }
async function discoverCandidates(options = {}) {
  const now = new Date(options.now || Date.now()); const year = Number(options.year || now.getUTCFullYear()); const dataDir = path.resolve(options.dataDir); const projectRoot = path.resolve(options.projectRoot || path.join(dataDir, '..', '..')); const use = isNonCommercial(options); const registry = sourceRegistry(year, options); const localFile = path.join(dataDir, `wta_matches_${year}.csv`); const localText = fs.existsSync(localFile) ? fs.readFileSync(localFile, 'utf8') : null; const localInspection = localText ? inspect(localText, year, 'LAST_KNOWN_GOOD', options) : null;
  const diagnostics = []; const accepted = [];
  async function attempt(source, fn) {
    if (!source.enabled) { diagnostics.push({ providerId: source.id, status: 'DISABLED_BY_POLICY' }); return; }
    try { const candidate = await fn(); candidate.priority = source.priority; candidate.inspection = inspect(candidate.text, year, source.id, options); candidate.comparison = compare(candidate.inspection, localInspection, year, options); const ok = !localInspection || candidate.comparison.accepted; diagnostics.push({ providerId: source.id, status: ok ? 'ACCEPTED_CANDIDATE' : 'REJECTED_OLDER_OR_WEAKER', latestMatchAt: candidate.inspection.latestMatchAt, validRows: candidate.inspection.validRows, comparison: candidate.comparison, networkCalls: candidate.networkCalls || 0, fromCache: candidate.fromCache === true, diagnostics: candidate.diagnostics || [] }); if (ok) accepted.push(candidate); }
    catch (error) { diagnostics.push({ providerId: source.id, status: 'FAILED', error: error.message, httpStatus: error.httpStatus || null }); }
  }
  const manual = registry.find(x => x.id === 'TENNISDATA_APP_LOCAL_IMPORT'); await attempt(manual, () => Promise.resolve(fetchManualCandidate(year, { ...options, projectRoot })));
  const github = registry.find(x => x.id === 'JEFF_SACKMANN_GITHUB_DISCOVERY'); await attempt(github, () => fetchGithubCandidate(year, { ...options, dataDir }));
  const hf = registry.find(x => x.id === 'HUGGINGFACE_SACKMANN_ARCHIVE'); await attempt(hf, () => fetchHuggingFaceCandidate(year, { ...options, dataDir }));
  let selected = null; for (const candidate of accepted) selected = selected ? better(selected, candidate) : candidate;
  if (!selected && localText) selected = { providerId: 'LAST_KNOWN_GOOD', priority: 1000, text: localText, inspection: localInspection, comparison: { accepted: true, reasons: ['SAFE_FALLBACK'] }, networkCalls: 0, fromCache: true };
  return { success: Boolean(selected), version: VERSION, policyVersion: POLICY_VERSION, year, usageMode: use.mode, nonCommercialSourcesAllowed: use.allowed, manualImportAuthorized: localImportAuthorized(options), registry, diagnostics, selected, localInspection, dataChangedCandidate: Boolean(selected && selected.providerId !== 'LAST_KNOWN_GOOD' && (!localInspection || selected.inspection.sha256 !== localInspection.sha256)), authority: { probability: false, deepScan: false, qualityGate: false, stake: false, settlement: false } };
}

async function probe(options = {}) {
  const discovery = await discoverCandidates(options);
  return {
    success: discovery.success,
    status: discovery.selected ? 'SOURCE_CANDIDATE_SELECTED' : 'NO_SOURCE_AVAILABLE',
    version: VERSION,
    policyVersion: POLICY_VERSION,
    year: discovery.year,
    selectedProvider: discovery.selected?.providerId || null,
    selected: discovery.selected ? { latestMatchAt: discovery.selected.inspection?.latestMatchAt || null, validRows: Number(discovery.selected.inspection?.validRows || 0), sha256: discovery.selected.inspection?.sha256 || null, fromCache: discovery.selected.fromCache === true } : null,
    dataChangedCandidate: discovery.dataChangedCandidate,
    diagnostics: discovery.diagnostics,
    noActivation: true,
    authority: discovery.authority
  };
}
async function refresh(options = {}) {
  const dataDir = path.resolve(options.dataDir); const now = new Date(options.now || Date.now()); const year = Number(options.year || now.getUTCFullYear()); const statePath = path.join(dataDir, STATE_FILE); const prior = readJson(statePath, {});
  if (!options.force && prior.lastAttemptAt && now.getTime() - new Date(prior.lastAttemptAt).getTime() < MIN_REFRESH_INTERVAL_MS) return { success: true, status: 'SKIPPED_RECENT_ATTEMPT', version: VERSION, state: prior, dataChanged: false };
  const operationId = options.operationId || `WTA43_${Date.now()}`; const file = path.join(dataDir, `wta_matches_${year}.csv`); const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
  try {
    const discovery = await discoverCandidates({ ...options, dataDir, now, year });
    if (!discovery.selected) throw new Error('PATCH43_WTA_NO_SOURCE_OR_LKG');
    if (discovery.selected.providerId === 'LAST_KNOWN_GOOD' || !discovery.dataChangedCandidate) {
      const result = { success: true, status: discovery.selected.providerId === 'LAST_KNOWN_GOOD' ? 'STALE_LKG_PRESERVED' : 'NO_NEWER_CANDIDATE', version: VERSION, operationId, dataChanged: false, selectedProvider: discovery.selected.providerId, selected: { latestMatchAt: discovery.selected.inspection?.latestMatchAt || null, validRows: discovery.selected.inspection?.validRows || 0, sha256: discovery.selected.inspection?.sha256 || null }, diagnostics: discovery.diagnostics, probabilityAuthority: false, qualityGateAuthority: false, stakeAuthority: false, settlementAuthority: false, sourceLicense: sourceLicense(discovery.selected.providerId) };
      writeJsonAtomic(statePath, { ...result, lastAttemptAt: nowIso(now), previousSuccessAt: prior.lastSuccessAt || null }); return result;
    }
    const stage = `${file}.patch43-stage-${process.pid}-${Date.now()}`; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(stage, discovery.selected.text, 'utf8'); const staged = inspect(fs.readFileSync(stage, 'utf8'), year, discovery.selected.providerId, { ...options, now }); if (staged.sha256 !== discovery.selected.inspection.sha256) throw new Error('PATCH43_WTA_STAGED_HASH_MISMATCH');
    const backup = before ? `${file}.patch43-lkg-${nowIso(now).replace(/[:.]/g, '-')}` : null; if (before && backup) fs.writeFileSync(backup, before); fs.renameSync(stage, file);
    try { const playerEvidence = options.playerEvidence || require('./tennisPlayerEvidence'); playerEvidence.init(dataDir, { force: true }); }
    catch (error) { if (before) fs.writeFileSync(file, before); else fs.rmSync(file, { force: true }); throw error; }
    const result = { success: true, status: 'WTA_REFRESH_ACTIVATED', version: VERSION, operationId, dataChanged: true, selectedProvider: discovery.selected.providerId, before: discovery.localInspection ? { latestMatchAt: discovery.localInspection.latestMatchAt, validRows: discovery.localInspection.validRows, sha256: discovery.localInspection.sha256 } : null, after: { latestMatchAt: discovery.selected.inspection.latestMatchAt, validRows: discovery.selected.inspection.validRows, sha256: discovery.selected.inspection.sha256 }, backup, diagnostics: discovery.diagnostics, probabilityAuthority: false, qualityGateAuthority: false, stakeAuthority: false, settlementAuthority: false, sourceLicense: sourceLicense(discovery.selected.providerId) };
    writeJsonAtomic(statePath, { ...result, lastAttemptAt: nowIso(now), lastSuccessAt: nowIso(now) }); return result;
  } catch (error) {
    if (before && (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== sha256(before))) fs.writeFileSync(file, before);
    const result = { success: false, status: 'FAILED_LKG_PRESERVED', version: VERSION, operationId, error: error.message, dataChanged: false, lastKnownGoodPreserved: Boolean(before), probabilityAuthority: false, qualityGateAuthority: false, stakeAuthority: false, settlementAuthority: false };
    writeJsonAtomic(statePath, { ...result, lastAttemptAt: nowIso(now), previousSuccessAt: prior.lastSuccessAt || null }); return result;
  }
}
function schedule(options = {}) { if (String(process.env.TENNIS_PATCH43_WTA_AUTO_REFRESH || '1') === '0') return { enabled: false, reason: 'ENV_DISABLED', version: VERSION }; const delayMs = Math.max(5000, Number(options.delayMs || 60000)); const timer = setTimeout(() => { refresh(options).then(result => options.onResult?.(result)).catch(error => options.onError?.(error)); }, delayMs); timer.unref?.(); return { enabled: true, delayMs, version: VERSION, minimumRefreshIntervalHours: MIN_REFRESH_INTERVAL_MS / 3600000 }; }
function health(options = {}) { const dataDir = path.resolve(options.dataDir); const now = new Date(options.now || Date.now()); const year = Number(options.year || now.getUTCFullYear()); const state = readJson(path.join(dataDir, STATE_FILE), null); return { success: true, version: VERSION, policyVersion: POLICY_VERSION, year, state, registry: sourceRegistry(year, options), usage: isNonCommercial(options), manualImportAuthorized: localImportAuthorized(options), manualImportPaths: manualImportPaths(options.projectRoot || path.resolve(__dirname, '..'), year), autoRefreshEnabled: String(process.env.TENNIS_PATCH43_WTA_AUTO_REFRESH || '1') !== '0', minimumRefreshIntervalHours: MIN_REFRESH_INTERVAL_MS / 3600000, noScraping: true, noBotBypass: true, atomicActivation: true, lastKnownGoodPreserved: true, probabilityAuthority: false, stakeAuthority: false };
}

module.exports = { VERSION, POLICY_VERSION, STATE_FILE, CACHE_DIR, NETWORK_HOSTS, MIN_REFRESH_INTERVAL_MS, sourceRegistry, isNonCommercial, localImportAuthorized, sourceLicense, requestText, parseRepoMetadata, parseGithubContent, fetchGithubCandidate, fetchHuggingFaceCandidate, manualImportPaths, fetchManualCandidate, inspect, compare, discoverCandidates, probe, refresh, schedule, health };
