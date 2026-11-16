'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ODDS_API_LEDGER_VERSION = 'BETTING_PATCH_12_ODDS_API_HEADER_LEDGER_V1';
const DEFAULT_FILE = process.env.ODDS_API_PROVIDER_LEDGER_FILE || path.resolve(__dirname, 'api_usage_provider_ledger.json');

function num(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function round(v, d = 4) { return Number(num(v,0).toFixed(d)); }
function monthKey(date = new Date()) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
const RETRYABLE_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
let lastPersistenceHealth = { ok: true, mode: 'NOT_WRITTEN_YET', error: null, at: null };
function sleepSync(ms) {
  if (!(ms > 0)) return;
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (_) { const until = Date.now() + ms; while (Date.now() < until) {} }
}
function cleanupTemp(file) { try { if (file && fs.existsSync(file)) fs.rmSync(file, { force: true }); } catch (_) {} }
function writeJsonAtomicResilient(file, value, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = JSON.stringify(value, null, 2);
  const nonce = crypto.randomBytes(4).toString('hex');
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${nonce}`;
  fs.writeFileSync(tmp, payload, 'utf8');
  const delays = Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs : [10, 25, 50, 100, 200, 400];
  let lastError = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return { ok: true, mode: attempt === 0 ? 'ATOMIC_RENAME' : 'ATOMIC_RENAME_RETRY', attempts: attempt + 1, error: null };
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_FS_CODES.has(error.code) || attempt >= delays.length) break;
      sleepSync(delays[attempt]);
    }
  }
  try {
    fs.copyFileSync(tmp, file);
    cleanupTemp(tmp);
    return { ok: true, mode: 'COPY_OVER_FALLBACK', attempts: delays.length + 2, error: lastError?.message || null };
  } catch (copyError) {
    cleanupTemp(tmp);
    return { ok: false, mode: 'MEMORY_ONLY_DEGRADED', attempts: delays.length + 2, error: copyError.message || lastError?.message || 'UNKNOWN_WRITE_ERROR' };
  }
}
function write(file, value) {
  const result = writeJsonAtomicResilient(file, value);
  lastPersistenceHealth = { ...result, at: new Date().toISOString() };
  if (!result.ok) console.warn(`⚠️ [ODDS_API_LEDGER] Persistenza degradata a memoria: ${result.error}`);
  return result;
}
function fingerprintKey(key) { return crypto.createHash('sha256').update(`PATCH12|${String(key||'')}`).digest('hex').slice(0,16); }
function headersObject(headers = {}) {
  const out = {};
  if (headers && typeof headers.entries === 'function') for (const [k,v] of headers.entries()) out[String(k).toLowerCase()] = v;
  else for (const [k,v] of Object.entries(headers || {})) out[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return out;
}
function exactHeaderValues(headers = {}) {
  const h = headersObject(headers);
  const used = num(h['x-requests-used'], NaN);
  const remaining = num(h['x-requests-remaining'], NaN);
  const last = num(h['x-requests-last'], NaN);
  return {
    available: Number.isFinite(used) || Number.isFinite(remaining) || Number.isFinite(last),
    used: Number.isFinite(used) ? used : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    last: Number.isFinite(last) ? last : null
  };
}
function parseQuery(urlTemplate = '') {
  try { return new URL(String(urlTemplate).replace('API_KEY_PLACEHOLDER','x')); }
  catch { return null; }
}
function estimateCost(urlTemplate = '', data = undefined) {
  const u = parseQuery(urlTemplate);
  const low = String(urlTemplate).toLowerCase();
  if (low.includes('/sports/?') || /\/sports\/?(?:\?|$)/.test(low)) return 0;
  if (Array.isArray(data) && data.length === 0) return 0;
  if (low.includes('/scores/')) return u?.searchParams?.has('daysFrom') ? 2 : 1;
  if (low.includes('/odds/')) {
    const markets = (u?.searchParams?.get('markets') || 'h2h').split(',').filter(Boolean).length || 1;
    const bookmakers = (u?.searchParams?.get('bookmakers') || '').split(',').filter(Boolean).length;
    const regions = bookmakers > 0 ? Math.ceil(bookmakers / 10) : ((u?.searchParams?.get('regions') || 'us').split(',').filter(Boolean).length || 1);
    const historical = low.includes('/historical/') ? 10 : 1;
    return historical * markets * regions;
  }
  return 1;
}
function emptyState(now = new Date()) {
  return {
    version: ODDS_API_LEDGER_VERSION,
    monthKey: monthKey(now),
    attempts: 0, successes: 0, failures: 0,
    reconciledResponses: 0, unreconciledResponses: 0,
    estimatedCredits: 0,
    providerKeys: {}, attemptsByOperation: {}, legacyBaselineCredits: null, legacyBaselineAttempts: null,
    lastEvent: null,
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
  };
}
function createLedger({ file = DEFAULT_FILE, nowFn = () => new Date(), writeFn = write } = {}) {
  let memoryState = null;
  function state() {
    const now = nowFn();
    const diskState = read(file, null);
    let s = diskState || memoryState;
    if (!s || s.monthKey !== monthKey(now)) s = emptyState(now);
    if (!s.providerKeys) s.providerKeys = {};
    if (!s.attemptsByOperation) s.attemptsByOperation = {};
    memoryState = s;
    return s;
  }
  function save(s) { memoryState=s; s.version=ODDS_API_LEDGER_VERSION; s.updatedAt=nowFn().toISOString(); try { const result=writeFn(file,s); lastPersistenceHealth={...(result||{ok:true,mode:'CUSTOM_WRITE'}),at:nowFn().toISOString()}; } catch(error) { lastPersistenceHealth={ok:false,mode:'MEMORY_ONLY_EXCEPTION',error:error.message||String(error),at:nowFn().toISOString()}; console.warn(`⚠️ [ODDS_API_LEDGER] Scrittura non bloccante fallita: ${lastPersistenceHealth.error}`); } return s; }
  function eventBase(input={}) {
    return {
      attemptId: input.attemptId || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      source: String(input.source || 'unknown'), route: String(input.route || 'fetchOddsApi'),
      operation: String(input.operation || 'odds_api_request'), urlClass: String(input.urlTemplate || '').replace(/apiKey=([^&]+)/i,'apiKey=REDACTED'),
      keyId: input.key ? fingerprintKey(input.key) : String(input.keyId || 'unknown'),
      at: nowFn().toISOString()
    };
  }
  function recordAttempt(input={}) {
    const s=state(); const ev=eventBase(input); s.attempts++;
    if (!s.attemptsByOperation[ev.operation]) s.attemptsByOperation[ev.operation]={attempts:0,successes:0,failures:0,estimatedCredits:0};
    s.attemptsByOperation[ev.operation].attempts++;
    s.lastEvent={...ev,type:'ATTEMPT'}; save(s); return ev;
  }
  function recordResponse(input={}) {
    const s=state(); const ev=eventBase(input); const h=exactHeaderValues(input.headers);
    s.successes++; s.attemptsByOperation[ev.operation] ||= {attempts:0,successes:0,failures:0,estimatedCredits:0}; s.attemptsByOperation[ev.operation].successes++;
    if (h.available) {
      const prev=s.providerKeys[ev.keyId] || {};
      const nextUsed=h.used ?? prev.used ?? null;
      const firstObservedUsedBeforeCall=prev.firstObservedUsedBeforeCall ?? (Number.isFinite(Number(nextUsed)) ? Math.max(0, num(nextUsed)-Math.max(0,num(h.last,0))) : null);
      s.providerKeys[ev.keyId]={...prev,keyId:ev.keyId,used:nextUsed,remaining:h.remaining ?? prev.remaining ?? null,lastCost:h.last ?? 0,firstObservedUsedBeforeCall,statusCode:num(input.statusCode,200),observedAt:ev.at,source:ev.source,operation:ev.operation};
      s.reconciledResponses++;
    } else {
      const estimate=estimateCost(input.urlTemplate,input.data); s.estimatedCredits=round(s.estimatedCredits+estimate); s.unreconciledResponses++;
      s.attemptsByOperation[ev.operation].estimatedCredits=round(num(s.attemptsByOperation[ev.operation].estimatedCredits)+estimate);
    }
    s.lastEvent={...ev,type:'SUCCESS',statusCode:num(input.statusCode,200),header:h,estimatedCost:h.available?null:estimateCost(input.urlTemplate,input.data)}; save(s); return s.lastEvent;
  }
  function recordFailure(input={}) {
    const s=state(); const ev=eventBase(input); const h=exactHeaderValues(input.headers);
    s.failures++; s.attemptsByOperation[ev.operation] ||= {attempts:0,successes:0,failures:0,estimatedCredits:0}; s.attemptsByOperation[ev.operation].failures++;
    if (h.available) {
      const prev=s.providerKeys[ev.keyId] || {};
      const nextUsed=h.used ?? prev.used ?? null;
      const firstObservedUsedBeforeCall=prev.firstObservedUsedBeforeCall ?? (Number.isFinite(Number(nextUsed)) ? Math.max(0, num(nextUsed)-Math.max(0,num(h.last,0))) : null);
      s.providerKeys[ev.keyId]={...prev,keyId:ev.keyId,used:nextUsed,remaining:h.remaining ?? prev.remaining ?? null,lastCost:h.last ?? 0,firstObservedUsedBeforeCall,statusCode:num(input.statusCode,0),observedAt:ev.at,source:ev.source,operation:ev.operation};
      s.reconciledResponses++;
    } else s.unreconciledResponses++;
    s.lastEvent={...ev,type:'FAILURE',statusCode:num(input.statusCode,0),errorCode:String(input.errorCode||''),header:h}; save(s); return s.lastEvent;
  }
  function summary(base={}) {
    const s=state();
    const snapshots=Object.values(s.providerKeys || {}).filter(x=>Number.isFinite(Number(x.used)));
    const exactUsed=round(snapshots.reduce((a,x)=>a+num(x.used),0));
    const exactRemaining=round(snapshots.reduce((a,x)=>a+Math.max(0,num(x.remaining)),0));
    const keyCount=Math.max(0,num(base.keyCount,0));
    const observedKeys=snapshots.length;
    const allObserved=keyCount>0 && observedKeys>=keyCount;
    const legacy=num(base.creditsUsed,0);
    let baselineChanged = false;
    if (s.legacyBaselineCredits === null || s.legacyBaselineCredits === undefined || !Number.isFinite(Number(s.legacyBaselineCredits))) { s.legacyBaselineCredits=legacy; baselineChanged=true; }
    if (s.legacyBaselineAttempts === null || s.legacyBaselineAttempts === undefined || !Number.isFinite(Number(s.legacyBaselineAttempts))) { s.legacyBaselineAttempts=Math.max(0,num(base.requestAttempts,0)); baselineChanged=true; }
    if (baselineChanged) save(s);
    const observedDelta=round(snapshots.reduce((sum,x)=>sum+Math.max(0,num(x.used)-num(x.firstObservedUsedBeforeCall,x.used)),0));
    const baselinePlusObserved=round(num(s.legacyBaselineCredits,legacy)+observedDelta+num(s.estimatedCredits,0));
    const effectiveUsed=allObserved ? Math.max(exactUsed,baselinePlusObserved) : Math.max(legacy,exactUsed,baselinePlusObserved);
    const total=num(base.monthlyCreditTotal,0);
    const remaining=Math.max(0,total-effectiveUsed);
    const accuracy=allObserved?'PROVIDER_HEADERS_ALL_KEYS':observedKeys>0?'MIXED_PROVIDER_HEADERS_AND_LEGACY':'LEGACY_ESTIMATE_ONLY';
    const lastSnapshot=s.lastEvent || null;
    return {
      ...base,
      mode:'BETTING_PATCH_12_ODDS_API_HEADER_LEDGER',
      creditsUsed:round(effectiveUsed), creditsRemaining:round(remaining),
      usagePct: total>0?round(effectiveUsed/total*100,2):0, remainingPct:total>0?round(remaining/total*100,2):0,
      requestAttempts:Math.max(0,num(s.legacyBaselineAttempts,0))+s.attempts, providerRequestAttempts:s.attempts, successfulRequests:s.successes, failedRequests:s.failures,
      exactCreditsObserved:exactUsed, exactRemainingObserved:exactRemaining,
      estimatedCreditsUnreconciled:round(s.estimatedCredits), observedCreditDelta:observedDelta, legacyBaselineCredits:num(s.legacyBaselineCredits,legacy), observedKeyCount:observedKeys,
      accuracyMode:accuracy, reconciledResponses:s.reconciledResponses, unreconciledResponses:s.unreconciledResponses,
      lastProviderEvent:lastSnapshot, providerKeySnapshots:s.providerKeys, networkByOperation:s.attemptsByOperation,
      lastCall:lastSnapshot ? {provider:'the_odds_api',source:lastSnapshot.source,operation:lastSnapshot.operation,route:lastSnapshot.route,credits:lastSnapshot.header?.last ?? lastSnapshot.estimatedCost ?? 0,at:lastSnapshot.at,status:lastSnapshot.type} : base.lastCall,
      ledgerVersion:ODDS_API_LEDGER_VERSION, persistenceHealth:{...lastPersistenceHealth},
      privacy:'API keys are fingerprinted locally and never returned.'
    };
  }
  return { recordAttempt, recordResponse, recordFailure, summary, state:()=>state(), persistenceHealth:()=>({...lastPersistenceHealth}), reset:()=>save(emptyState(nowFn())) };
}

const ledger=createLedger();
module.exports={ODDS_API_LEDGER_VERSION, fingerprintKey, exactHeaderValues, estimateCost, writeJsonAtomicResilient, createLedger,
  recordAttempt:ledger.recordAttempt, recordResponse:ledger.recordResponse, recordFailure:ledger.recordFailure,
  reconcileSummary:ledger.summary, getLedgerState:ledger.state, getPersistenceHealth:ledger.persistenceHealth, resetLedgerForTestsOnly:ledger.reset};
