'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const VERSION = 'TENNIS_WTA_INFORMATION_RECOVERY_V2_PATCH52_R2';
const POLICY_VERSION = 'TENNIS_WTA_INFORMATION_RECOVERY_POLICY_V2_PATCH52_R2';
const STATE_FILE = 'tennis_wta_patch52_recovery_state.json';
const CACHE_DIR = '.tennis_wta_patch52_cache';
const CURRENT_MAX_AGE_DAYS = 21;
const AGING_MAX_AGE_DAYS = 45;
const MIN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_PROVIDER_COOLDOWN_MS = 60 * 60 * 1000;
const PERMANENT_MISSING_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_COOLDOWN_MS = 15 * 60 * 1000;
const AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const NETWORK_HOSTS = new Set(['api.github.com','raw.githubusercontent.com','huggingface.co','cdn-lfs.hf.co','cas-bridge.xethub.hf.co']);

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function writeJsonAtomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp-${process.pid}-${Date.now()}`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fs.renameSync(tmp, file); }
function iso(value = new Date()) { const date = value instanceof Date ? value : new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(); }
function safeUrl(value) { try { const url = new URL(String(value)); url.search = ''; return url.toString(); } catch (_) { return String(value || ''); } }
function usagePolicy(options = {}) { const mode = String(options.usageMode || process.env.TENNIS_DATA_USAGE_MODE || 'PERSONAL_RESEARCH').trim().toUpperCase(); return { mode, nonCommercialAllowed: !['COMMERCIAL','PRODUCTION_COMMERCIAL'].includes(mode) }; }
function manualAuthorized(options = {}) { return options.manualImportAuthorized === true || String(process.env.TENNISDATA_APP_IMPORT_AUTHORIZED || '0') === '1'; }
function freshness(latestMatchAt, now = new Date()) { const t = latestMatchAt ? new Date(latestMatchAt).getTime() : NaN; const n = new Date(now).getTime(); if (!Number.isFinite(t) || !Number.isFinite(n)) return { status:'UNAVAILABLE', dataAgeDays:null }; const days = Math.max(0, (n - t) / 86400000); return { status: days <= CURRENT_MAX_AGE_DAYS ? 'CURRENT' : days <= AGING_MAX_AGE_DAYS ? 'AGING' : 'STALE', dataAgeDays: Number(days.toFixed(1)) }; }


const STATE_SCHEMA_VERSION = 'TENNIS_WTA_RECOVERY_STATE_SCHEMA_V2_PATCH52_R2';

function statePath(dataDir) { return path.join(path.resolve(dataDir), STATE_FILE); }
function emptyState(now = new Date()) {
  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: iso(now),
    providers: {},
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastStatus: null,
    lastSemanticStatus: null,
    selectedCandidate: null,
    activeDataset: null,
    active: null
  };
}
function snapshotFromInspection(providerId, inspection, now = new Date(), extra = {}) {
  if (!inspection) return null;
  return {
    providerId: providerId || 'UNKNOWN',
    latestMatchAt: inspection.latestMatchAt || null,
    validRows: Number(inspection.validRows || 0),
    sha256: inspection.sha256 || null,
    freshness: freshness(inspection.latestMatchAt, now),
    ...extra
  };
}
function normalizeCandidateSnapshot(value, now = new Date()) {
  if (!value || typeof value !== 'object') return null;
  return {
    providerId: value.providerId || null,
    latestMatchAt: value.latestMatchAt || null,
    validRows: Number(value.validRows || 0),
    sha256: value.sha256 || null,
    fromCache: value.fromCache === true,
    freshness: freshness(value.latestMatchAt, now)
  };
}
function semanticStatusForCandidate(candidate, diagnostics = [], now = new Date()) {
  if (!candidate) return 'NO_FRESH_SOURCE_AVAILABLE';
  const f = candidate.freshness || freshness(candidate.latestMatchAt, now);
  if (candidate.providerId !== 'LAST_KNOWN_GOOD') {
    if (f.status === 'CURRENT') return 'FRESH_CANDIDATE_AVAILABLE';
    if (f.status === 'AGING') return 'AGING_CANDIDATE_AVAILABLE';
    return 'STALE_CANDIDATE_REJECTED_FOR_AUTHORITY';
  }
  const cooldown = Array.isArray(diagnostics) && diagnostics.some(row => row?.status === 'SKIPPED_COOLDOWN' || row?.status === 'FAILED_COOLDOWN_SET');
  return cooldown ? 'PROVIDER_COOLDOWN_LKG' : 'STALE_LKG_PAPER_ONLY';
}
function inspectActiveDataset(dataDir, year, patch43, state, now = new Date(), options = {}) {
  const file = path.join(path.resolve(dataDir), `wta_matches_${year}.csv`);
  if (!fs.existsSync(file)) return null;
  const inspection = patch43.inspect(fs.readFileSync(file, 'utf8'), year, 'LAST_KNOWN_GOOD', { ...options, now });
  const prior = state?.activeDataset || state?.active || null;
  const priorMatches = Boolean(prior?.sha256 && prior.sha256 === inspection.sha256);
  const priorWasActivated = Boolean(priorMatches && state?.lastSuccessAt && prior?.providerId && prior.providerId !== 'LAST_KNOWN_GOOD');
  return snapshotFromInspection(priorWasActivated ? prior.providerId : 'LAST_KNOWN_GOOD', inspection, now, {
    role: 'ACTIVE_DATASET',
    activationSource: priorWasActivated ? 'RECORDED_SUCCESSFUL_ACTIVATION' : 'LOCAL_LAST_KNOWN_GOOD'
  });
}
function normalizeStateTruth(dataDir, rawState, options = {}) {
  const now = new Date(options.now || Date.now());
  const year = Number(options.year || now.getUTCFullYear());
  const patch43 = options.patch43 || require('./tennisWtaSourceDiscoveryPatch43');
  const base = { ...emptyState(now), ...(rawState || {}), providers: { ...((rawState || {}).providers || {}) } };
  const legacyActive = normalizeCandidateSnapshot(base.active, now);
  let selectedCandidate = normalizeCandidateSnapshot(base.selectedCandidate, now);
  const activeDataset = inspectActiveDataset(dataDir, year, patch43, base, now, options);

  // Patch52 R1 wrote the last discovered mirror into `active` even when no activation occurred.
  // Recover that value as a candidate only when it cannot be attributed to a successful activation.
  if (!selectedCandidate && legacyActive && legacyActive.providerId !== 'LAST_KNOWN_GOOD') {
    const activeHash = activeDataset?.sha256 || null;
    const noSuccessfulActivation = !base.lastSuccessAt;
    const legacyLooksLikeCandidate = noSuccessfulActivation || legacyActive.sha256 === activeHash;
    if (legacyLooksLikeCandidate) selectedCandidate = { ...legacyActive, role: 'SELECTED_CANDIDATE' };
  }

  const explicitStatus = base.lastSemanticStatus || base.lastStatus || null;
  const preserveExplicit = new Set([
    'RECOVERED_CURRENT_SHADOW',
    'RECOVERED_AGING_SHADOW',
    'RECOVERED_STALE_PAPER_ONLY',
    'FAILED_LKG_PRESERVED'
  ]);
  let semanticStatus = preserveExplicit.has(explicitStatus) ? explicitStatus : null;
  if (!semanticStatus && selectedCandidate) semanticStatus = semanticStatusForCandidate(selectedCandidate, [], now);
  else if (!semanticStatus && activeDataset) {
    if (activeDataset.freshness?.status === 'CURRENT') semanticStatus = base.lastSuccessAt ? 'ACTIVE_CURRENT_DATASET' : 'READY_CURRENT_LKG';
    else if (activeDataset.freshness?.status === 'AGING') semanticStatus = 'DEGRADED_AGING_LKG';
    else semanticStatus = 'STALE_LKG_PAPER_ONLY';
  }

  return {
    ...base,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    selectedCandidate,
    activeDataset,
    active: activeDataset,
    lastStatus: semanticStatus,
    lastSemanticStatus: semanticStatus
  };
}
function loadState(dataDir, now = new Date(), options = {}) {
  const raw = readJson(statePath(dataDir), emptyState(now));
  return normalizeStateTruth(dataDir, raw, { ...options, now });
}
function saveState(dataDir, state, now = new Date(), options = {}) {
  const next = normalizeStateTruth(dataDir, {
    ...state,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: iso(now)
  }, { ...options, now });
  writeJsonAtomic(statePath(dataDir), next);
  return next;
}
function migrateStateTruth(options = {}) {
  const dataDir = path.resolve(options.dataDir);
  const now = new Date(options.now || Date.now());
  const before = readJson(statePath(dataDir), null);
  const next = normalizeStateTruth(dataDir, { ...(before || emptyState(now)), updatedAt: iso(now) }, { ...options, now });
  const changed = JSON.stringify(before || null) !== JSON.stringify(next);
  if (options.persist !== false) writeJsonAtomic(statePath(dataDir), next);
  return {
    success: true,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    changed,
    before: before ? {
      lastStatus: before.lastStatus || null,
      lastSuccessAt: before.lastSuccessAt || null,
      activeProviderId: before.active?.providerId || before.activeDataset?.providerId || null
    } : null,
    after: {
      lastStatus: next.lastStatus,
      lastSemanticStatus: next.lastSemanticStatus,
      selectedCandidateProviderId: next.selectedCandidate?.providerId || null,
      selectedCandidateFreshness: next.selectedCandidate?.freshness?.status || null,
      activeDatasetProviderId: next.activeDataset?.providerId || null,
      activeDatasetFreshness: next.activeDataset?.freshness?.status || null
    },
    state: next
  };
}


function statusCodeFromError(error) { if (Number(error?.httpStatus)) return Number(error.httpStatus); const m = String(error?.message || '').match(/(?:HTTP_|:)(\d{3})(?:\D|$)/); return m ? Number(m[1]) : null; }
function failureClass(error) { const httpStatus = statusCodeFromError(error); if ([404,410].includes(httpStatus)) return { class:'PERMANENT_RESOURCE_MISSING', cooldownMs:PERMANENT_MISSING_COOLDOWN_MS, retryable:false, httpStatus }; if ([401,403].includes(httpStatus)) return { class:'AUTH_OR_POLICY_DENIED', cooldownMs:AUTH_COOLDOWN_MS, retryable:false, httpStatus }; if ([408,425,429,500,502,503,504].includes(httpStatus) || error?.retryable === true || ['ETIMEDOUT','ECONNRESET','EAI_AGAIN','ENOTFOUND'].includes(error?.code)) return { class:'TRANSIENT_NETWORK', cooldownMs:TRANSIENT_COOLDOWN_MS, retryable:true, httpStatus }; return { class:'PROVIDER_FAILURE', cooldownMs:DEFAULT_PROVIDER_COOLDOWN_MS, retryable:false, httpStatus }; }
function providerCooling(state, providerId, now = new Date(), force = false) { if (force) return false; const until = state.providers?.[providerId]?.cooldownUntil; return Boolean(until && new Date(until).getTime() > new Date(now).getTime()); }
function recordFailure(state, providerId, error, now = new Date()) { const info = failureClass(error); const prior = state.providers?.[providerId] || {}; state.providers[providerId] = { ...prior, providerId, status:'COOLDOWN', failureClass:info.class, httpStatus:info.httpStatus, retryable:info.retryable, lastError:String(error?.message || error), lastAttemptAt:iso(now), cooldownUntil:iso(new Date(new Date(now).getTime()+info.cooldownMs)), consecutiveFailures:Number(prior.consecutiveFailures || 0)+1 }; return state.providers[providerId]; }
function recordSuccess(state, providerId, details = {}, now = new Date()) { state.providers[providerId] = { providerId, status:'AVAILABLE', failureClass:null, httpStatus:null, retryable:false, lastError:null, lastAttemptAt:iso(now), lastSuccessAt:iso(now), cooldownUntil:null, consecutiveFailures:0, ...details }; return state.providers[providerId]; }
function providerRegistry(year, options = {}) { const usage = usagePolicy(options); const manual = manualAuthorized(options); return [
  { id:'TENNISDATA_APP_LOCAL_IMPORT', priority:0, enabled:manual, network:false, license:'USER_AUTHORIZED_LOCAL_FILE', authority:'DATA_CANDIDATE' },
  { id:'JEFF_SACKMANN_GITHUB_DISCOVERY', priority:10, enabled:usage.nonCommercialAllowed && options.skipNetwork !== true, network:true, license:'CC_BY_NC_SA_4_0', authority:'DATA_CANDIDATE' },
  { id:'HUGGINGFACE_SACKMANN_ARCHIVE', priority:20, enabled:usage.nonCommercialAllowed && options.skipNetwork !== true, network:true, license:'CC_BY_NC_SA_4_0', authority:'MIRROR_DATA_CANDIDATE' },
  { id:'ANEESHERS_GITHUB_ARCHIVE', priority:30, enabled:usage.nonCommercialAllowed && options.skipNetwork !== true, network:true, license:'CC_BY_NC_SA_4_0', authority:'MIRROR_DATA_CANDIDATE' },
  { id:'LAST_KNOWN_GOOD', priority:1000, enabled:true, network:false, license:'LOCAL_ACTIVE', authority:'SAFE_FALLBACK' }
]; }
function requestText(url, options = {}, redirects = 0) { const parsed = new URL(String(url)); if (parsed.protocol !== 'https:' || !NETWORK_HOSTS.has(parsed.hostname)) return Promise.reject(new Error(`PATCH52_WTA_HOST_BLOCKED:${parsed.hostname}`)); return new Promise((resolve,reject)=>{ const req=https.get(parsed,{headers:{'User-Agent':'BettingApp-WTA-Patch52-R2/2.0','Accept':'text/csv,*/*;q=0.5',...(options.headers||{})}},res=>{ const status=Number(res.statusCode||0); if ([301,302,303,307,308].includes(status)&&res.headers.location) { res.resume(); if(redirects>=4) return reject(new Error('PATCH52_WTA_TOO_MANY_REDIRECTS')); return requestText(new URL(res.headers.location,parsed).toString(),options,redirects+1).then(resolve,reject); } const chunks=[]; let bytes=0; res.on('data',c=>{bytes+=c.length;if(bytes>25*1024*1024)req.destroy(new Error('PATCH52_WTA_DOWNLOAD_TOO_LARGE'));else chunks.push(c)}); res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');if(status>=200&&status<300)return resolve({statusCode:status,text,headers:res.headers,url:safeUrl(parsed)});const e=new Error(`PATCH52_WTA_HTTP_${status}`);e.httpStatus=status;e.retryable=[408,425,429,500,502,503,504].includes(status);reject(e)}); }); req.setTimeout(Number(options.timeoutMs||15000),()=>req.destroy(Object.assign(new Error('PATCH52_WTA_TIMEOUT'),{code:'ETIMEDOUT',retryable:true})));req.on('error',reject); }); }
function cachePaths(dataDir, providerId, year) { const dir=path.join(path.resolve(dataDir),CACHE_DIR,providerId);return{dir,body:path.join(dir,`wta_${year}.csv`),meta:path.join(dir,`wta_${year}.json`)}; }
async function directCandidate(providerId, url, year, options = {}) { const cache=cachePaths(options.dataDir,providerId,year),prior=readJson(cache.meta,null),now=new Date(options.now||Date.now()),age=prior?.fetchedAt?(now-new Date(prior.fetchedAt))/3600000:Infinity;if(!options.force&&fs.existsSync(cache.body)&&age<Number(options.cacheHours||6))return{providerId,text:fs.readFileSync(cache.body,'utf8'),fromCache:true,networkCalls:0,diagnostics:[{status:'CACHE_HIT',ageHours:Number(age.toFixed(2))}]};const requester=options.requester||requestText;const res=await requester(url,{timeoutMs:options.timeoutMs});if(!String(res.text||'').trim())throw new Error(`PATCH52_WTA_EMPTY:${providerId}`);fs.mkdirSync(cache.dir,{recursive:true});fs.writeFileSync(cache.body,res.text,'utf8');writeJsonAtomic(cache.meta,{providerId,year,fetchedAt:iso(now),url:safeUrl(res.url||url),bytes:Buffer.byteLength(res.text),sha256:sha256(Buffer.from(res.text))});return{providerId,text:res.text,fromCache:false,networkCalls:1,diagnostics:[{status:'FETCHED',url:safeUrl(res.url||url)}]}; }
function candidateRank(candidate) { const latest=candidate.inspection?.latestMatchAt?new Date(candidate.inspection.latestMatchAt).getTime():0;return[Number.isFinite(latest)?latest:0,Number(candidate.inspection?.validRows||0),-Number(candidate.priority||999)]; }
function better(a,b){const x=candidateRank(a),y=candidateRank(b);for(let i=0;i<x.length;i+=1){if(x[i]!==y[i])return x[i]>y[i]?a:b}return a;}


async function discover(options = {}) {
  const patch43 = options.patch43 || require('./tennisWtaSourceDiscoveryPatch43');
  const now = new Date(options.now || Date.now());
  const year = Number(options.year || now.getUTCFullYear());
  const dataDir = path.resolve(options.dataDir);
  const projectRoot = path.resolve(options.projectRoot || path.join(dataDir, '..', '..'));
  const state = loadState(dataDir, now, { ...options, year, patch43 });
  const registry = providerRegistry(year, options);
  const localFile = path.join(dataDir, `wta_matches_${year}.csv`);
  const localText = fs.existsSync(localFile) ? fs.readFileSync(localFile, 'utf8') : null;
  const localInspection = localText ? patch43.inspect(localText, year, 'LAST_KNOWN_GOOD', { ...options, now }) : null;
  const diagnostics = [];
  const accepted = [];
  const custom = options.providerFetchers || {};

  async function attempt(source, fn) {
    if (!source.enabled) {
      diagnostics.push({ providerId: source.id, status: 'DISABLED_BY_POLICY' });
      return;
    }
    if (providerCooling(state, source.id, now, options.force === true)) {
      diagnostics.push({
        providerId: source.id,
        status: 'SKIPPED_COOLDOWN',
        cooldownUntil: state.providers[source.id].cooldownUntil,
        failureClass: state.providers[source.id].failureClass
      });
      return;
    }
    try {
      const candidate = await fn();
      candidate.providerId = candidate.providerId || source.id;
      candidate.priority = source.priority;
      candidate.inspection = patch43.inspect(candidate.text, year, candidate.providerId, { ...options, now });
      candidate.comparison = patch43.compare(candidate.inspection, localInspection, year, options);
      const ok = !localInspection || candidate.comparison.accepted;
      recordSuccess(state, source.id, {
        latestMatchAt: candidate.inspection.latestMatchAt,
        validRows: candidate.inspection.validRows,
        sha256: candidate.inspection.sha256
      }, now);
      diagnostics.push({
        providerId: source.id,
        status: ok ? 'ACCEPTED_CANDIDATE' : 'REJECTED_OLDER_OR_WEAKER',
        latestMatchAt: candidate.inspection.latestMatchAt,
        validRows: candidate.inspection.validRows,
        comparison: candidate.comparison,
        networkCalls: candidate.networkCalls || 0,
        fromCache: candidate.fromCache === true
      });
      if (ok) accepted.push(candidate);
    } catch (error) {
      const providerState = recordFailure(state, source.id, error, now);
      diagnostics.push({
        providerId: source.id,
        status: 'FAILED_COOLDOWN_SET',
        error: error.message,
        httpStatus: providerState.httpStatus,
        failureClass: providerState.failureClass,
        cooldownUntil: providerState.cooldownUntil,
        retryable: providerState.retryable
      });
    }
  }

  const hasCurrent = () => accepted.some(candidate => freshness(candidate.inspection?.latestMatchAt, now).status === 'CURRENT');
  const skipLower = source => diagnostics.push({ providerId: source.id, status: 'SKIPPED_CURRENT_CANDIDATE_ALREADY_FOUND' });
  const manual = registry[0];
  await attempt(manual, () => custom[manual.id] ? custom[manual.id]({ year, options }) : Promise.resolve(patch43.fetchManualCandidate(year, { ...options, projectRoot })));
  const gh = registry[1];
  if (hasCurrent()) skipLower(gh); else await attempt(gh, () => custom[gh.id] ? custom[gh.id]({ year, options }) : patch43.fetchGithubCandidate(year, { ...options, dataDir }));
  const hf = registry[2];
  if (hasCurrent()) skipLower(hf); else await attempt(hf, () => custom[hf.id] ? custom[hf.id]({ year, options }) : patch43.fetchHuggingFaceCandidate(year, { ...options, dataDir }));
  const mirror = registry[3];
  if (hasCurrent()) skipLower(mirror); else await attempt(mirror, () => custom[mirror.id] ? custom[mirror.id]({ year, options }) : directCandidate(mirror.id, `https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main/wta/wta_matches_${year}.csv`, year, { ...options, dataDir }));

  let selected = null;
  for (const candidate of accepted) selected = selected ? better(selected, candidate) : candidate;
  if (!selected && localText) {
    selected = {
      providerId: 'LAST_KNOWN_GOOD',
      priority: 1000,
      text: localText,
      inspection: localInspection,
      comparison: { accepted: true, reasons: ['SAFE_FALLBACK'] },
      networkCalls: 0,
      fromCache: true
    };
  }

  const selectedSnapshot = selected ? snapshotFromInspection(selected.providerId, selected.inspection, now, {
    role: selected.providerId === 'LAST_KNOWN_GOOD' ? 'SAFE_FALLBACK' : 'SELECTED_CANDIDATE',
    fromCache: selected.fromCache === true
  }) : null;
  const selectedCandidate = selected?.providerId === 'LAST_KNOWN_GOOD' ? null : selectedSnapshot;
  const activeDataset = inspectActiveDataset(dataDir, year, patch43, state, now, options);
  const semanticStatus = semanticStatusForCandidate(selectedSnapshot, diagnostics, now);
  const dataChangedCandidate = Boolean(selected && selected.providerId !== 'LAST_KNOWN_GOOD' && (!localInspection || selected.inspection.sha256 !== localInspection.sha256));

  const nextState = {
    ...state,
    lastAttemptAt: iso(now),
    lastStatus: semanticStatus,
    lastSemanticStatus: semanticStatus,
    selectedCandidate,
    activeDataset,
    active: activeDataset
  };
  const persistedState = options.persistProviderState !== false
    ? saveState(dataDir, nextState, now, { ...options, year, patch43 })
    : normalizeStateTruth(dataDir, nextState, { ...options, year, patch43, now });

  return {
    success: Boolean(selected),
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    year,
    usage: usagePolicy(options),
    registry,
    selected,
    selectedCandidate,
    activeDataset,
    localInspection,
    diagnostics,
    state: persistedState,
    semanticStatus,
    dataChangedCandidate,
    authority: { probability: false, deepScan: false, qualityGate: false, stake: false, settlement: false, automaticPromotion: false }
  };
}
function deriveStatus(discovery, now = new Date()) {
  if (discovery?.semanticStatus) return discovery.semanticStatus;
  if (!discovery?.selected) return 'NO_FRESH_SOURCE_AVAILABLE';
  const selectedSnapshot = snapshotFromInspection(discovery.selected.providerId, discovery.selected.inspection, now);
  return semanticStatusForCandidate(selectedSnapshot, discovery.diagnostics || [], now);
}
async function probe(options = {}) {
  const now = new Date(options.now || Date.now());
  const discovery = await discover({ ...options, now });
  const selected = discovery.selected ? snapshotFromInspection(discovery.selected.providerId, discovery.selected.inspection, now, {
    fromCache: discovery.selected.fromCache === true,
    role: discovery.selected.providerId === 'LAST_KNOWN_GOOD' ? 'SAFE_FALLBACK' : 'SELECTED_CANDIDATE'
  }) : null;
  return {
    success: discovery.success,
    status: deriveStatus(discovery, now),
    semanticStatus: deriveStatus(discovery, now),
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    year: discovery.year,
    selectedProvider: discovery.selected?.providerId || null,
    selected,
    selectedCandidate: discovery.selectedCandidate,
    activeDataset: discovery.activeDataset,
    dataChangedCandidate: discovery.dataChangedCandidate,
    diagnostics: discovery.diagnostics,
    providerState: discovery.state.providers,
    state: discovery.state,
    noActivation: true,
    lastKnownGoodPreserved: true,
    authority: discovery.authority
  };
}
async function refresh(options = {}) {
  const dataDir = path.resolve(options.dataDir);
  const now = new Date(options.now || Date.now());
  const year = Number(options.year || now.getUTCFullYear());
  const patch43 = options.patch43 || require('./tennisWtaSourceDiscoveryPatch43');
  const state = loadState(dataDir, now, { ...options, year, patch43 });
  if (!options.force && state.lastAttemptAt && now - new Date(state.lastAttemptAt) < MIN_REFRESH_INTERVAL_MS) {
    return {
      success: true,
      status: 'SKIPPED_RECENT_ATTEMPT',
      semanticStatus: state.lastSemanticStatus || state.lastStatus,
      version: VERSION,
      policyVersion: POLICY_VERSION,
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      state,
      selectedCandidate: state.selectedCandidate,
      activeDataset: state.activeDataset,
      dataChanged: false,
      authority: { probability: false, stake: false }
    };
  }

  const operationId = options.operationId || `WTA52R2_${Date.now()}`;
  const file = path.join(dataDir, `wta_matches_${year}.csv`);
  const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
  try {
    const discovery = await discover({ ...options, dataDir, now, year, patch43 });
    if (!discovery.selected) throw new Error('PATCH52_WTA_NO_SOURCE_OR_LKG');
    const selectedFresh = freshness(discovery.selected.inspection?.latestMatchAt, now);
    const selectedCandidate = discovery.selectedCandidate;

    if (discovery.selected.providerId === 'LAST_KNOWN_GOOD' || !discovery.dataChangedCandidate) {
      const status = deriveStatus(discovery, now);
      const activeDataset = inspectActiveDataset(dataDir, year, patch43, discovery.state, now, options);
      const next = saveState(dataDir, {
        ...discovery.state,
        lastStatus: status,
        lastSemanticStatus: status,
        selectedCandidate,
        activeDataset,
        active: activeDataset
      }, now, { ...options, year, patch43 });
      return {
        success: true,
        status,
        semanticStatus: status,
        version: VERSION,
        policyVersion: POLICY_VERSION,
        stateSchemaVersion: STATE_SCHEMA_VERSION,
        operationId,
        dataChanged: false,
        selectedProvider: discovery.selected.providerId,
        selected: snapshotFromInspection(discovery.selected.providerId, discovery.selected.inspection, now, { fromCache: discovery.selected.fromCache === true }),
        selectedCandidate: next.selectedCandidate,
        activeDataset: next.activeDataset,
        diagnostics: discovery.diagnostics,
        providerState: next.providers,
        state: next,
        lastKnownGoodPreserved: Boolean(before),
        probabilityAuthority: false,
        qualityGateAuthority: false,
        stakeAuthority: false,
        settlementAuthority: false,
        automaticPromotion: false
      };
    }

    const stage = `${file}.patch52-r2-stage-${process.pid}-${Date.now()}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(stage, discovery.selected.text, 'utf8');
    const staged = patch43.inspect(fs.readFileSync(stage, 'utf8'), year, discovery.selected.providerId, { ...options, now });
    if (staged.sha256 !== discovery.selected.inspection.sha256) throw new Error('PATCH52_WTA_STAGED_HASH_MISMATCH');
    const backup = before ? `${file}.patch52-r2-lkg-${iso(now).replace(/[:.]/g, '-')}` : null;
    if (before && backup) fs.writeFileSync(backup, before);
    fs.renameSync(stage, file);
    try {
      const playerEvidence = options.playerEvidence || require('./tennisPlayerEvidence');
      playerEvidence.init(dataDir, { force: true });
    } catch (error) {
      if (before) fs.writeFileSync(file, before); else fs.rmSync(file, { force: true });
      throw error;
    }

    const activeFresh = freshness(staged.latestMatchAt, now);
    const status = activeFresh.status === 'CURRENT' ? 'RECOVERED_CURRENT_SHADOW' : activeFresh.status === 'AGING' ? 'RECOVERED_AGING_SHADOW' : 'RECOVERED_STALE_PAPER_ONLY';
    const activeDataset = snapshotFromInspection(discovery.selected.providerId, staged, now, {
      role: 'ACTIVE_DATASET',
      activationSource: 'PATCH52_R2_ATOMIC_ACTIVATION'
    });
    const next = saveState(dataDir, {
      ...discovery.state,
      lastStatus: status,
      lastSemanticStatus: status,
      lastSuccessAt: iso(now),
      selectedCandidate,
      activeDataset,
      active: activeDataset
    }, now, { ...options, year, patch43 });
    return {
      success: true,
      status,
      semanticStatus: status,
      version: VERSION,
      policyVersion: POLICY_VERSION,
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      operationId,
      dataChanged: true,
      selectedProvider: discovery.selected.providerId,
      selectedCandidate: next.selectedCandidate,
      activeDataset: next.activeDataset,
      before: discovery.localInspection ? {
        latestMatchAt: discovery.localInspection.latestMatchAt,
        validRows: discovery.localInspection.validRows,
        sha256: discovery.localInspection.sha256
      } : null,
      after: activeDataset,
      backup,
      diagnostics: discovery.diagnostics,
      providerState: next.providers,
      state: next,
      probabilityAuthority: false,
      qualityGateAuthority: false,
      stakeAuthority: false,
      settlementAuthority: false,
      automaticPromotion: false
    };
  } catch (error) {
    if (before && (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== sha256(before))) fs.writeFileSync(file, before);
    const activeDataset = inspectActiveDataset(dataDir, year, patch43, state, now, options);
    const next = saveState(dataDir, {
      ...state,
      lastAttemptAt: iso(now),
      lastStatus: 'FAILED_LKG_PRESERVED',
      lastSemanticStatus: 'FAILED_LKG_PRESERVED',
      activeDataset,
      active: activeDataset,
      lastError: error.message
    }, now, { ...options, year, patch43 });
    return {
      success: false,
      status: 'FAILED_LKG_PRESERVED',
      semanticStatus: 'FAILED_LKG_PRESERVED',
      version: VERSION,
      policyVersion: POLICY_VERSION,
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      operationId,
      error: error.message,
      dataChanged: false,
      selectedCandidate: next.selectedCandidate,
      activeDataset: next.activeDataset,
      lastKnownGoodPreserved: Boolean(before),
      providerState: next.providers,
      state: next,
      probabilityAuthority: false,
      qualityGateAuthority: false,
      stakeAuthority: false,
      settlementAuthority: false,
      automaticPromotion: false
    };
  }
}
function health(options = {}) {
  const dataDir = path.resolve(options.dataDir);
  const now = new Date(options.now || Date.now());
  const year = Number(options.year || now.getUTCFullYear());
  const patch43 = options.patch43 || require('./tennisWtaSourceDiscoveryPatch43');
  const state = loadState(dataDir, now, { ...options, year, patch43 });
  const activeDataset = inspectActiveDataset(dataDir, year, patch43, state, now, options);
  const selectedCandidate = state.selectedCandidate;
  const status = activeDataset?.freshness?.status === 'CURRENT' ? 'READY_CURRENT' : activeDataset?.freshness?.status === 'AGING' ? 'DEGRADED_AGING' : 'PAPER_ONLY_STALE';
  const truthfulState = {
    ...state,
    selectedCandidate,
    activeDataset,
    active: activeDataset
  };
  return {
    success: true,
    status,
    semanticStatus: truthfulState.lastSemanticStatus || truthfulState.lastStatus,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    year,
    state: truthfulState,
    selectedCandidate,
    activeDataset,
    active: activeDataset,
    registry: providerRegistry(year, options),
    usage: usagePolicy(options),
    manualImportAuthorized: manualAuthorized(options),
    manualImportPaths: patch43.manualImportPaths(options.projectRoot || path.resolve(__dirname, '..'), year),
    autoRefreshEnabled: String(process.env.TENNIS_PATCH52_WTA_AUTO_REFRESH || '1') !== '0',
    minimumRefreshIntervalHours: MIN_REFRESH_INTERVAL_MS / 3600000,
    lastKnownGoodPreserved: true,
    circuitBreakerActive: status !== 'READY_CURRENT',
    noScraping: true,
    noBotBypass: true,
    atomicActivation: true,
    candidateActiveSeparation: true,
    legacyActiveAlias: 'activeDataset',
    cliFormats: ['tool.js "."', 'tool.js --root "."'],
    probabilityAuthority: false,
    deepScanDecisionAuthority: false,
    qualityGateAuthority: false,
    stakeAuthority: false,
    settlementAuthority: false,
    automaticPromotion: false
  };
}
function schedule(options = {}) {
  if (String(process.env.TENNIS_PATCH52_WTA_AUTO_REFRESH || '1') === '0') return { enabled: false, reason: 'ENV_DISABLED', version: VERSION };
  const delayMs = Math.max(5000, Number(options.delayMs || 60000));
  const timer = setTimeout(() => refresh(options).then(result => options.onResult?.(result)).catch(error => options.onError?.(error)), delayMs);
  timer.unref?.();
  return { enabled: true, delayMs, version: VERSION, minimumRefreshIntervalHours: MIN_REFRESH_INTERVAL_MS / 3600000 };
}
module.exports = {
  VERSION,
  POLICY_VERSION,
  STATE_SCHEMA_VERSION,
  STATE_FILE,
  CACHE_DIR,
  CURRENT_MAX_AGE_DAYS,
  AGING_MAX_AGE_DAYS,
  MIN_REFRESH_INTERVAL_MS,
  PERMANENT_MISSING_COOLDOWN_MS,
  TRANSIENT_COOLDOWN_MS,
  AUTH_COOLDOWN_MS,
  usagePolicy,
  manualAuthorized,
  freshness,
  providerRegistry,
  failureClass,
  providerCooling,
  loadState,
  saveState,
  normalizeStateTruth,
  migrateStateTruth,
  semanticStatusForCandidate,
  requestText,
  directCandidate,
  discover,
  deriveStatus,
  probe,
  refresh,
  health,
  schedule
};

