'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const patch53 = require('./clvCrossSportCoveragePatch53');
const patch55 = require('./statisticalProductionReadinessGatePatch55');
const patch57 = require('./productionSecuritySafeReleasePatch57');

const VERSION = 'SCHEDULER_RELIABILITY_OPERATIONAL_STATE_MACHINE_V1_PATCH58';
const POLICY_VERSION = 'SCHEDULER_RELIABILITY_POLICY_V1_PATCH58';
const STATE_SCHEMA_VERSION = 'SCHEDULER_OPERATIONAL_STATE_SCHEMA_V1_PATCH58';
const MODE = 'PAPER_SHADOW_CONTINUITY_REAL_MONEY_FAIL_CLOSED';
const RUNTIME_DIR_NAME = '.scheduler_patch58_runtime';
const DEFAULT_HEARTBEAT_MS = 30 * 1000;
const DEFAULT_RUN_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 25 * 60 * 1000;
const DEFAULT_BACKOFF_BASE_MS = 5 * 60 * 1000;
const DEFAULT_BACKOFF_MAX_MS = 2 * 60 * 60 * 1000;

const STATES = Object.freeze([
  'DISABLED',
  'IDLE',
  'SCHEDULED',
  'RUNNING',
  'RECONCILING',
  'DEGRADED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'BLOCKED_UPSTREAM_GATE',
  'READY_FOR_CONTROLLED_CANARY_REVIEW'
]);
const STATE_SET = new Set(STATES);

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function bool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const v = text(value).toLowerCase();
  if (['1','true','yes','on'].includes(v)) return true;
  if (['0','false','no','off'].includes(v)) return false;
  return fallback;
}
function iso(value = Date.now()) { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString(); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex'); }
function normalizeSport(value) {
  const s = upper(value);
  if (s.includes('TENNIS') || s.includes('ATP') || s.includes('WTA')) return 'TENNIS';
  if (s.includes('CALCIO') || s.includes('SOCCER') || s.includes('FOOTBALL')) return 'CALCIO';
  throw new Error('PATCH58_SUPPORTED_SPORT_REQUIRED');
}
function projectRoot(input) { return path.resolve(input || path.join(__dirname, '..')); }
function runtimeDir(root) { return path.join(projectRoot(root), 'backend', RUNTIME_DIR_NAME); }
function statePath(sport, root) { return path.join(runtimeDir(root), `${normalizeSport(sport).toLowerCase()}_scheduler_state.json`); }
function eventsPath(sport, root) { return path.join(runtimeDir(root), `${normalizeSport(sport).toLowerCase()}_scheduler_events.jsonl`); }
function lockPath(sport, root) { return path.join(runtimeDir(root), `${normalizeSport(sport).toLowerCase()}_scheduler.lock`); }
function cronPath(sport, root) { return path.join(projectRoot(root), 'backend', normalizeSport(sport) === 'TENNIS' ? 'tennis_cron_config.json' : 'calcio_cron_config.json'); }
function dbPath(root) { return path.join(projectRoot(root), 'backend', 'database_betting.db'); }
function mkdirRuntime(root) { fs.mkdirSync(runtimeDir(root), { recursive: true }); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.patch58-${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
function appendEvent(sport, root, event) {
  mkdirRuntime(root);
  fs.appendFileSync(eventsPath(sport, root), JSON.stringify(event) + '\n', 'utf8');
}
function defaultState(sport, config = {}, now = Date.now()) {
  const normalizedSport = normalizeSport(sport);
  const enabled = config.enabled === true;
  const legacyFailed = config.lastRunSuccess === false;
  const state = !enabled ? 'DISABLED' : legacyFailed ? 'DEGRADED' : 'SCHEDULED';
  const reasonCode = !enabled ? 'SCHEDULER_DISABLED_BY_CONFIG' : legacyFailed ? 'PRE_PATCH58_LAST_RUN_FAILED_NO_REASON' : 'SCHEDULER_CONFIGURED';
  return {
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    sport: normalizedSport,
    state,
    handoffState: 'BLOCKED_UPSTREAM_GATE',
    reasonCode,
    updatedAt: iso(now),
    lastTransitionAt: iso(now),
    transitionSeq: 0,
    runId: null,
    heartbeatAt: null,
    runStartedAt: null,
    runCompletedAt: null,
    lastSuccessAt: config.lastRunSuccess === true ? (config.lastCompletedAt || config.lastRunAt || null) : null,
    lastFailureAt: legacyFailed ? (config.lastCompletedAt || config.lastRunAt || null) : null,
    lastFailureReason: legacyFailed ? 'PRE_PATCH58_LAST_RUN_FAILED_NO_REASON' : null,
    failureCount: legacyFailed ? 1 : 0,
    nextRetryAt: null,
    configEnabled: enabled,
    configFingerprint: sha256({ enabled, type: config.type || null, intervalHours: config.intervalHours || null, times: config.times || null, days: config.days || null, updateMode: config.updateMode || null }),
    historical: {
      importedFromLegacyScheduler: true,
      lastRunSuccess: config.lastRunSuccess ?? null,
      lastRunAt: config.lastRunAt || null,
      lastCompletedAt: config.lastCompletedAt || null,
      lastSkipReason: config.lastSkipReason || null
    },
    reconcile: null,
    lock: { held: false, runId: null, acquiredAt: null, recoveredStaleLock: false },
    authority: {
      schedulerOperationalStateOnly: true,
      probabilityMutation: false,
      paperStakeMutation: false,
      realMoneyStakeAuthority: false,
      settlementAuthority: false,
      automaticProductionActivation: false
    }
  };
}
function getState(sport, root) { return readJson(statePath(sport, root), null); }
function writeState(sport, root, state) { atomicWrite(statePath(sport, root), state); return state; }
function transition(sport, toState, options = {}) {
  const root = projectRoot(options.projectRoot);
  const normalizedSport = normalizeSport(sport);
  if (!STATE_SET.has(toState)) throw new Error(`PATCH58_INVALID_STATE:${toState}`);
  const now = iso(options.now || Date.now());
  let current = getState(normalizedSport, root);
  if (!current) {
    const config = readJson(cronPath(normalizedSport, root), {});
    current = defaultState(normalizedSport, config, options.now || Date.now());
  }
  const fromState = current.state;
  const next = {
    ...current,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    state: toState,
    reasonCode: options.reasonCode || current.reasonCode || 'UNSPECIFIED',
    updatedAt: now,
    lastTransitionAt: now,
    transitionSeq: num(current.transitionSeq, 0) + 1,
    runId: options.runId !== undefined ? options.runId : current.runId,
    heartbeatAt: options.heartbeatAt !== undefined ? options.heartbeatAt : current.heartbeatAt,
    ...(options.patch || {})
  };
  writeState(normalizedSport, root, next);
  appendEvent(normalizedSport, root, {
    version: VERSION,
    seq: next.transitionSeq,
    at: now,
    sport: normalizedSport,
    from: fromState || null,
    to: toState,
    runId: next.runId || null,
    reasonCode: next.reasonCode,
    evidenceHash: options.evidenceHash || null,
    idempotencyKey: sha256({ sport: normalizedSport, seq: next.transitionSeq, from: fromState || null, to: toState, runId: next.runId || null, reasonCode: next.reasonCode, at: now })
  });
  return next;
}
function initializeSportState(sport, root, options = {}) {
  const normalizedSport = normalizeSport(sport);
  const existing = getState(normalizedSport, root);
  if (existing && existing.version === VERSION) return existing;
  const config = readJson(cronPath(normalizedSport, root), {});
  const created = defaultState(normalizedSport, config, options.now || Date.now());
  writeState(normalizedSport, root, created);
  appendEvent(normalizedSport, root, {
    version: VERSION, seq: 0, at: created.updatedAt, sport: normalizedSport, from: null, to: created.state,
    runId: null, reasonCode: created.reasonCode, evidenceHash: null,
    idempotencyKey: sha256({ sport: normalizedSport, createdAt: created.updatedAt, initial: created.state, reasonCode: created.reasonCode })
  });
  return created;
}
function noteConfigChange(sport, config = {}, options = {}) {
  const root = projectRoot(options.projectRoot);
  const normalizedSport = normalizeSport(sport);
  let state = initializeSportState(normalizedSport, root, options);
  const enabled = config.enabled === true;
  const fingerprint = sha256({ enabled, type: config.type || null, intervalHours: config.intervalHours || null, times: config.times || null, days: config.days || null, updateMode: config.updateMode || null });
  const patch = { configEnabled: enabled, configFingerprint: fingerprint };
  if (!enabled && state.state !== 'DISABLED') return transition(normalizedSport, 'DISABLED', { projectRoot: root, reasonCode: 'SCHEDULER_DISABLED_BY_CONFIG', patch });
  if (enabled && state.state === 'DISABLED') return transition(normalizedSport, 'SCHEDULED', { projectRoot: root, reasonCode: 'SCHEDULER_EXPLICITLY_ENABLED', patch });
  state = { ...state, ...patch, updatedAt: iso() };
  return writeState(normalizedSport, root, state);
}
function lockInfo(sport, root) { return readJson(lockPath(sport, root), null); }
function lockAgeMs(info, now = Date.now()) { const t = new Date(info?.heartbeatAt || info?.acquiredAt || 0).getTime(); return Number.isFinite(t) ? Math.max(0, now - t) : Number.POSITIVE_INFINITY; }
function acquireLock(sport, root, runId, options = {}) {
  const normalizedSport = normalizeSport(sport);
  const staleMs = num(options.lockStaleMs, DEFAULT_LOCK_STALE_MS);
  const file = lockPath(normalizedSport, root);
  mkdirRuntime(root);
  let recoveredStaleLock = false;
  if (fs.existsSync(file)) {
    const info = lockInfo(normalizedSport, root);
    if (lockAgeMs(info) > staleMs) { fs.rmSync(file, { force: true }); recoveredStaleLock = true; }
  }
  let fd;
  try { fd = fs.openSync(file, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') return { acquired: false, recoveredStaleLock: false, existing: lockInfo(normalizedSport, root) }; throw error; }
  const value = { version: VERSION, sport: normalizedSport, runId, pid: process.pid, acquiredAt: iso(), heartbeatAt: iso() };
  fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8'); fs.closeSync(fd);
  return { acquired: true, recoveredStaleLock, info: value };
}
function heartbeatLock(sport, root, runId) {
  const normalizedSport = normalizeSport(sport);
  const file = lockPath(normalizedSport, root);
  const info = readJson(file, null);
  if (!info || info.runId !== runId) return false;
  atomicWrite(file, { ...info, heartbeatAt: iso() });
  const state = getState(normalizedSport, root);
  if (state && state.runId === runId) writeState(normalizedSport, root, { ...state, heartbeatAt: iso(), updatedAt: iso() });
  return true;
}
function releaseLock(sport, root, runId) {
  const file = lockPath(sport, root);
  const info = readJson(file, null);
  if (!info || info.runId === runId) { try { fs.rmSync(file, { force: true }); } catch (_) {} return true; }
  return false;
}
function backoffMs(failureCount, options = {}) {
  const base = num(options.backoffBaseMs, DEFAULT_BACKOFF_BASE_MS), max = num(options.backoffMaxMs, DEFAULT_BACKOFF_MAX_MS);
  return Math.min(max, base * (2 ** Math.max(0, Math.min(8, num(failureCount, 1) - 1))));
}
function classifyFailure(error) {
  const message = text(error?.message || error);
  const status = num(error?.response?.status || error?.status, 0);
  const retryable = /TIMEOUT|ECONN|EAI_AGAIN|RATE|429|5\d\d|TEMPORAR|BUSY|LOCK/i.test(message) || status === 429 || status >= 500 || status === 0;
  return { retryable, reasonCode: retryable ? 'RUN_FAILED_RETRYABLE' : 'RUN_FAILED_TERMINAL', message: message.slice(0, 500), status: status || null };
}
function eligiblePersistedCounts(db) {
  const eligible = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,'')) IN ('PENDING','WON','LOST') AND UPPER(COALESCE(bet_type,'')) NOT LIKE 'MULTI%' AND UPPER(COALESCE(data_quality,'')) NOT IN ('LEGACY_DIRTY','DIRTY','OLD_METRICS')`).get().n || 0);
  const persisted = Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,'')) IN ('PENDING','WON','LOST') AND UPPER(COALESCE(bet_type,'')) NOT LIKE 'MULTI%' AND UPPER(COALESCE(data_quality,'')) NOT IN ('LEGACY_DIRTY','DIRTY','OLD_METRICS') AND clv_cross_sport_resolution_version=?`).get(patch53.SPORT_KEY_RESOLUTION_VERSION).n || 0);
  return { eligible, persisted, gap: Math.max(0, eligible - persisted) };
}
function businessFingerprint(db) {
  const rows = db.prepare(`SELECT id,status,profit,stake,estimated_prob,odd,clv,clv_edge,closing_odd,clv_verified,settlement_contract_status,settlement_contract_reason,settlement_source,settlement_score FROM ai_forward_test ORDER BY id`).all();
  return sha256(rows);
}
function reconcilePatch53(root, options = {}) {
  const project = projectRoot(root);
  const file = dbPath(project);
  if (!fs.existsSync(file)) throw new Error('PATCH58_DATABASE_MISSING');
  const db = new DatabaseSync(file);
  try {
    const businessBefore = businessFingerprint(db);
    patch53.createSchema(db);
    const before = eligiblePersistedCounts(db);
    const firstPass = patch53.backfillResolutionMetadata(db, patch53.DEFAULT_FOOTBALL_LEAGUES, { resolvedAt: options.resolvedAt || iso() });
    const secondPass = patch53.backfillResolutionMetadata(db, patch53.DEFAULT_FOOTBALL_LEAGUES, { resolvedAt: options.resolvedAt || iso() });
    const after = eligiblePersistedCounts(db);
    const businessAfter = businessFingerprint(db);
    const integrity = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length;
    const success = String(integrity).toLowerCase() === 'ok' && foreignKeyViolations === 0 && businessBefore === businessAfter && after.gap === 0 && secondPass.changed === 0;
    const report = { success, version: patch53.SPORT_KEY_RESOLUTION_VERSION, before, after, firstPass, secondPass, integrity, foreignKeyViolations, businessValuesUnchanged: businessBefore === businessAfter, networkCalls: 0, evidenceHash: sha256({ before, after, firstPass, secondPass, integrity, foreignKeyViolations }) };
    if (!success) throw Object.assign(new Error(`PATCH58_PATCH53_RECONCILE_FAILED:${JSON.stringify(report)}`), { report });
    return report;
  } finally { try { db.close(); } catch (_) {} }
}
function readPatch53Gap(root) {
  const file = dbPath(root);
  if (!fs.existsSync(file)) return { eligible: 0, persisted: 0, gap: null, success: false };
  const db = new DatabaseSync(file, { readOnly: true });
  try { const counts = eligiblePersistedCounts(db); return { ...counts, success: counts.gap === 0 }; }
  catch (error) { return { eligible: 0, persisted: 0, gap: null, success: false, error: error.message }; }
  finally { try { db.close(); } catch (_) {} }
}
function recoverStaleRun(sport, root, options = {}) {
  const project = projectRoot(root);
  const normalizedSport = normalizeSport(sport);
  let state = initializeSportState(normalizedSport, project, options);
  const staleMs = num(options.lockStaleMs, DEFAULT_LOCK_STALE_MS), now = num(options.now, Date.now());
  const activeState = ['RUNNING','RECONCILING'].includes(state.state);
  const hb = new Date(state.heartbeatAt || state.runStartedAt || 0).getTime();
  if (activeState && (!Number.isFinite(hb) || now - hb > staleMs)) {
    const existingLock = lockInfo(normalizedSport, project);
    if (!existingLock || lockAgeMs(existingLock, now) > staleMs) try { fs.rmSync(lockPath(normalizedSport, project), { force: true }); } catch (_) {}
    const failures = num(state.failureCount, 0) + 1;
    state = transition(normalizedSport, 'FAILED_RETRYABLE', { projectRoot: project, reasonCode: 'STALE_RUN_RECOVERED', patch: { failureCount: failures, lastFailureAt: iso(now), lastFailureReason: 'STALE_RUN_RECOVERED', nextRetryAt: iso(now + backoffMs(failures, options)), runId: null, heartbeatAt: null, lock: { held: false, runId: null, acquiredAt: null, recoveredStaleLock: true } } });
  }
  return state;
}
function bootstrap(options = {}) {
  const root = projectRoot(options.projectRoot);
  mkdirRuntime(root);
  const tennis = recoverStaleRun('TENNIS', root, options);
  const calcio = recoverStaleRun('CALCIO', root, options);
  return { success: true, version: VERSION, root, tennis, calcio, networkCalls: 0 };
}
function upstreamSnapshot(root, sport, db = null, options = {}) {
  const project = projectRoot(root), normalizedSport = normalizeSport(sport);
  let ownsDb = false, handle = db;
  if (!handle) { handle = new DatabaseSync(dbPath(project), { readOnly: true }); ownsDb = true; }
  try {
    const readiness = options.readinessReport || patch55.buildStatisticalProductionReadinessReport(handle, { projectRoot: project });
    // Patch58 is invoked on every portfolio decision and scheduler health read. Do not
    // rescan the complete release surface here: Patch57 already exposes a lightweight
    // runtime security handoff specifically for downstream authorities. The exhaustive
    // strict-release scan remains owned by Patch57 audit/release commands.
    const securityReady = patch57.portfolioSecurityReady({ projectRoot: project }) === true;
    const sportReadiness = normalizedSport === 'TENNIS' ? readiness.tennis : readiness.calcio;
    return { readinessStatus: sportReadiness?.gateStatus || 'BLOCKED_STATISTICAL_READINESS', globalReadinessStatus: readiness.gateStatus, readinessEvidenceHash: readiness.evidenceHash || null, securityReady, securityStatus: securityReady ? 'PRODUCTION_SECURITY_READY' : 'PRODUCTION_SECURITY_BLOCKED' };
  } finally { if (ownsDb) try { handle.close(); } catch (_) {} }
}
function handoffForSport(root, sport, state, gap, upstream) {
  const operationalReady = ['IDLE','SCHEDULED'].includes(state?.state) && state?.configEnabled === true && !state?.runId;
  const statisticalReady = upstream.readinessStatus === 'MANUAL_CANARY_REVIEW_ELIGIBLE';
  const metadataReady = gap?.gap === 0;
  const securityReady = upstream.securityReady === true;
  const ready = operationalReady && statisticalReady && metadataReady && securityReady;
  return {
    state: ready ? 'READY_FOR_CONTROLLED_CANARY_REVIEW' : 'BLOCKED_UPSTREAM_GATE',
    ready,
    requirements: { operationalReady, statisticalReady, metadataReady, securityReady },
    reasonCode: ready ? 'PATCH58_ALL_PRE_CANARY_REQUIREMENTS_SATISFIED' : !operationalReady ? 'PATCH58_OPERATIONAL_STATE_NOT_READY' : !statisticalReady ? 'PATCH55_STATISTICAL_READINESS_BLOCKED' : !metadataReady ? 'PATCH53_METADATA_RECONCILE_REQUIRED' : 'PATCH57_SECURITY_NOT_READY'
  };
}
function buildHealth(options = {}) {
  const root = projectRoot(options.projectRoot);
  const gap = readPatch53Gap(root);
  // Compute the statistical snapshot once per health read and share it across sports.
  // This keeps scheduler/portfolio health cheap enough for runtime use while preserving
  // the exact Patch55 authority semantics.
  let sharedReadiness = options.readinessReport || null;
  if (!sharedReadiness) {
    let handle = null;
    try {
      handle = new DatabaseSync(dbPath(root), { readOnly: true });
      sharedReadiness = patch55.buildStatisticalProductionReadinessReport(handle, { projectRoot: root });
    } catch (_) { sharedReadiness = null; }
    finally { if (handle) try { handle.close(); } catch (_) {} }
  }
  const sharedOptions = sharedReadiness ? { ...options, readinessReport: sharedReadiness } : options;
  const sports = {};
  for (const sport of ['TENNIS','CALCIO']) {
    const state = getState(sport, root);
    let upstream;
    try { upstream = upstreamSnapshot(root, sport, null, sharedOptions); } catch (error) { upstream = { readinessStatus: 'BLOCKED_STATISTICAL_READINESS', globalReadinessStatus: 'BLOCKED_STATISTICAL_READINESS', readinessEvidenceHash: null, securityReady: false, securityStatus: 'ERROR', error: error.message }; }
    const handoff = handoffForSport(root, sport, state || {}, gap, upstream);
    sports[sport] = { state, upstream, handoff };
  }
  const runtimePresent = ['TENNIS','CALCIO'].every(s => Boolean(sports[s].state?.version === VERSION));
  const infrastructureReady = runtimePresent && gap.success === true && sports.TENNIS.upstream.securityReady === true && sports.CALCIO.upstream.securityReady === true;
  return {
    success: infrastructureReady,
    healthy: infrastructureReady,
    version: VERSION,
    policyVersion: POLICY_VERSION,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    mode: MODE,
    status: infrastructureReady ? 'SCHEDULER_STATE_MACHINE_OPERATIONAL' : 'SCHEDULER_STATE_MACHINE_DEGRADED',
    infrastructureReady,
    patch53Reconcile: gap,
    sports,
    portfolioHandoff: {
      TENNIS: sports.TENNIS.handoff,
      CALCIO: sports.CALCIO.handoff,
      allSportsReady: sports.TENNIS.handoff.ready && sports.CALCIO.handoff.ready
    },
    authority: {
      schedulerStateOnly: true,
      paperShadowExecutionPreserved: true,
      realMoneyStakeAuthority: false,
      canBypassPatch55: false,
      canBypassPatch56: false,
      canBypassPatch57: false,
      automaticProductionActivation: false
    }
  };
}
function portfolioSchedulerReady(options = {}) {
  const sport = upper(options.sport || 'ALL');
  const health = buildHealth(options);
  if (sport === 'TENNIS' || sport === 'CALCIO') return health.portfolioHandoff[sport]?.ready === true;
  return health.portfolioHandoff.allSportsReady === true;
}
async function runManagedCycle(sport, core, options = {}) {
  if (typeof core !== 'function') throw new Error('PATCH58_CORE_FUNCTION_REQUIRED');
  const root = projectRoot(options.projectRoot), normalizedSport = normalizeSport(sport), config = options.config || readJson(cronPath(normalizedSport, root), {});
  let state = initializeSportState(normalizedSport, root, options);
  state = noteConfigChange(normalizedSport, config, { projectRoot: root });
  if (config.enabled !== true) return { success: false, skipped: true, reason: 'SCHEDULER_DISABLED', patch58: { state: 'DISABLED', version: VERSION } };
  const now = Date.now(), retryAt = state.nextRetryAt ? new Date(state.nextRetryAt).getTime() : 0;
  if (Number.isFinite(retryAt) && retryAt > now) return { success: false, skipped: true, reason: 'PATCH58_BACKOFF_ACTIVE', patch58: { state: state.state, nextRetryAt: state.nextRetryAt, version: VERSION } };
  const runId = options.runId || `${normalizedSport.toLowerCase()}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const lock = acquireLock(normalizedSport, root, runId, options);
  if (!lock.acquired) return { success: false, skipped: true, reason: 'PATCH58_SINGLE_FLIGHT_LOCKED', patch58: { state: state.state, version: VERSION, existingRunId: lock.existing?.runId || null } };
  let heartbeatTimer = null, timeoutTimer = null, timeoutExceeded = false, reconcile = null;
  try {
    transition(normalizedSport, 'RECONCILING', { projectRoot: root, runId, reasonCode: 'PATCH53_PRE_RUN_RECONCILE', heartbeatAt: iso(), patch: { runStartedAt: iso(), lock: { held: true, runId, acquiredAt: lock.info?.acquiredAt || iso(), recoveredStaleLock: lock.recoveredStaleLock } } });
    try {
      reconcile = reconcilePatch53(root);
      state = getState(normalizedSport, root) || {};
      writeState(normalizedSport, root, { ...state, reconcile, updatedAt: iso() });
    } catch (error) {
      const failures = num(state.failureCount, 0) + 1;
      transition(normalizedSport, 'DEGRADED', { projectRoot: root, runId: null, reasonCode: 'PATCH53_RECONCILE_FAILED', evidenceHash: error.report?.evidenceHash || null, patch: { lastFailureAt: iso(), lastFailureReason: text(error.message).slice(0, 500), failureCount: failures, nextRetryAt: iso(Date.now() + backoffMs(failures, options)), heartbeatAt: null, lock: { held: false, runId: null, acquiredAt: null, recoveredStaleLock: lock.recoveredStaleLock } } });
      return { success: false, skipped: true, reason: 'PATCH58_RECONCILE_BLOCKED', error: error.message, patch58: { state: 'DEGRADED', reconcile: error.report || null, version: VERSION } };
    }
    transition(normalizedSport, 'RUNNING', { projectRoot: root, runId, reasonCode: 'AUTOMATION_CORE_RUNNING', heartbeatAt: iso(), evidenceHash: reconcile.evidenceHash });
    const heartbeatMs = Math.max(1000, num(options.heartbeatMs, DEFAULT_HEARTBEAT_MS));
    heartbeatTimer = setInterval(() => heartbeatLock(normalizedSport, root, runId), heartbeatMs);
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
    const timeoutMs = Math.max(1000, num(options.runTimeoutMs, DEFAULT_RUN_TIMEOUT_MS));
    timeoutTimer = setTimeout(() => {
      timeoutExceeded = true;
      const current = getState(normalizedSport, root) || {};
      writeState(normalizedSport, root, { ...current, reasonCode: 'RUN_TIMEOUT_WATCHDOG_EXCEEDED', timeoutExceededAt: iso(), updatedAt: iso() });
    }, timeoutMs);
    if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();
    let result;
    try { result = await core(); }
    catch (error) { result = { success: false, error: error.message, _error: error }; }
    if (result?.success === true && !timeoutExceeded) {
      const nextState = config.enabled === true ? 'SCHEDULED' : 'IDLE';
      transition(normalizedSport, nextState, { projectRoot: root, runId: null, reasonCode: 'RUN_COMPLETED_SUCCESSFULLY', evidenceHash: reconcile.evidenceHash, patch: { heartbeatAt: null, runCompletedAt: iso(), lastSuccessAt: iso(), lastFailureReason: null, failureCount: 0, nextRetryAt: null, reconcile, lock: { held: false, runId: null, acquiredAt: null, recoveredStaleLock: lock.recoveredStaleLock } } });
      return { ...result, patch58: { version: VERSION, state: nextState, runId, reconcile, timeoutExceeded: false } };
    }
    const failure = timeoutExceeded ? { retryable: true, reasonCode: 'RUN_TIMEOUT_EXCEEDED', message: 'PATCH58_RUN_TIMEOUT_EXCEEDED', status: null } : classifyFailure(result?._error || result?.error || 'AUTOMATION_CORE_FAILED');
    const current = getState(normalizedSport, root) || {};
    const failures = num(current.failureCount, 0) + 1;
    const toState = failure.retryable ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
    transition(normalizedSport, toState, { projectRoot: root, runId: null, reasonCode: failure.reasonCode, evidenceHash: reconcile.evidenceHash, patch: { heartbeatAt: null, runCompletedAt: iso(), lastFailureAt: iso(), lastFailureReason: failure.message, failureCount: failures, nextRetryAt: failure.retryable ? iso(Date.now() + backoffMs(failures, options)) : null, reconcile, lock: { held: false, runId: null, acquiredAt: null, recoveredStaleLock: lock.recoveredStaleLock } } });
    return { ...(result || {}), success: false, patch58: { version: VERSION, state: toState, runId, reconcile, timeoutExceeded, nextRetryAt: getState(normalizedSport, root)?.nextRetryAt || null } };
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    releaseLock(normalizedSport, root, runId);
  }
}

module.exports = {
  VERSION, POLICY_VERSION, STATE_SCHEMA_VERSION, MODE, STATES, RUNTIME_DIR_NAME,
  DEFAULT_HEARTBEAT_MS, DEFAULT_RUN_TIMEOUT_MS, DEFAULT_LOCK_STALE_MS,
  DEFAULT_BACKOFF_BASE_MS, DEFAULT_BACKOFF_MAX_MS,
  projectRoot, runtimeDir, statePath, eventsPath, lockPath, getState, transition,
  initializeSportState, noteConfigChange, acquireLock, heartbeatLock, releaseLock,
  backoffMs, classifyFailure, reconcilePatch53, readPatch53Gap, recoverStaleRun,
  bootstrap, buildHealth, portfolioSchedulerReady, runManagedCycle, eligiblePersistedCounts,
  businessFingerprint, sha256
};
