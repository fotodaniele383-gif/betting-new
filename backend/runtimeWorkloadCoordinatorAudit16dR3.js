'use strict';

const VERSION = 'AUDIT16D_R3_RUNTIME_WORKLOAD_COORDINATOR_V1';
const PATCH_REVISION = 'AUDIT16D_R3_R1_CLV_DEFERRED_EXECUTION_V1';

const state = {
  calcioAnalysisDepth: 0,
  calcioAnalysisStartedAt: null,
  clvRunning: false,
  clvSource: null,
  clvStartedAt: null,
  clvDeferredCount: 0,
  clvSkipAlreadyRunningCount: 0,
  lastDeferredAt: null,
  lastDeferredReason: null,
  lastCalcioAnalysisCompletedAt: null,
  lastClvCompletedAt: null,
  clvDeferredPending: false,
  clvDeferredRegisteredAt: null,
  clvDeferredSources: [],
  clvDeferredMergedCount: 0,
  clvDeferredFlushScheduled: false,
  clvDeferredFlushCount: 0,
  lastDeferredFlushAt: null,
  lastDeferredFlushSource: null,
  lastDeferredFlushError: null
};

let deferredClvRunner = null;

function nowIso() { return new Date().toISOString(); }
function isCalcioAnalysisRunning() { return state.calcioAnalysisDepth > 0; }

function uniquePush(list, value, max = 12) {
  const text = String(value || 'UNKNOWN');
  if (!list.includes(text)) list.push(text);
  if (list.length > max) list.splice(0, list.length - max);
}

function maybeFlushDeferredClv() {
  if (!state.clvDeferredPending) return { scheduled: false, reason: 'NO_DEFERRED_CLV_PENDING' };
  if (isCalcioAnalysisRunning()) return { scheduled: false, reason: 'CALCIO_ANALYSIS_STILL_ACTIVE' };
  if (state.clvRunning) return { scheduled: false, reason: 'CLV_ALREADY_RUNNING' };
  if (state.clvDeferredFlushScheduled) return { scheduled: true, reason: 'DEFERRED_FLUSH_ALREADY_SCHEDULED' };
  if (typeof deferredClvRunner !== 'function') return { scheduled: false, reason: 'DEFERRED_RUNNER_MISSING' };

  state.clvDeferredFlushScheduled = true;
  setImmediate(async () => {
    state.clvDeferredFlushScheduled = false;
    if (!state.clvDeferredPending || isCalcioAnalysisRunning() || state.clvRunning || typeof deferredClvRunner !== 'function') {
      return;
    }

    const runner = deferredClvRunner;
    const sources = state.clvDeferredSources.slice();
    const source = sources.length ? sources.join(',') : 'UNKNOWN';

    // Clear the latch before invoking the callback. If a new Calcio analysis starts
    // before the callback acquires the CLV lease, runStep103 will re-register one
    // deferred execution instead of multiplying queued jobs.
    state.clvDeferredPending = false;
    state.clvDeferredRegisteredAt = null;
    state.clvDeferredSources = [];
    deferredClvRunner = null;
    state.clvDeferredFlushCount += 1;
    state.lastDeferredFlushAt = nowIso();
    state.lastDeferredFlushSource = source;
    state.lastDeferredFlushError = null;

    try {
      await runner({
        source,
        reason: 'CALCIO_ANALYSIS_COMPLETED_DEFERRED_CLV_FLUSH',
        flushCount: state.clvDeferredFlushCount
      });
    } catch (error) {
      state.lastDeferredFlushError = error?.message || String(error);
    }
  });
  return { scheduled: true, reason: 'DEFERRED_FLUSH_SCHEDULED' };
}

function beginCalcioAnalysis() {
  state.calcioAnalysisDepth += 1;
  if (state.calcioAnalysisDepth === 1) state.calcioAnalysisStartedAt = nowIso();
  let ended = false;
  return function endCalcioAnalysis() {
    if (ended) return;
    ended = true;
    state.calcioAnalysisDepth = Math.max(0, state.calcioAnalysisDepth - 1);
    if (state.calcioAnalysisDepth === 0) {
      state.lastCalcioAnalysisCompletedAt = nowIso();
      state.calcioAnalysisStartedAt = null;
      maybeFlushDeferredClv();
    }
  };
}

function calcioAnalysisMiddleware(req, res, next) {
  const end = beginCalcioAnalysis();
  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    end();
  };
  res.once('finish', finish);
  res.once('close', finish);
  try { next(); } catch (error) { finish(); throw error; }
}

function clvDecision({ source = 'UNKNOWN', urgent = false } = {}) {
  if (state.clvRunning) {
    state.clvSkipAlreadyRunningCount += 1;
    return { allowed: false, deferred: false, skipped: true, reason: 'CLV_ALREADY_RUNNING', source };
  }
  if (isCalcioAnalysisRunning() && urgent !== true) {
    state.clvDeferredCount += 1;
    state.lastDeferredAt = nowIso();
    state.lastDeferredReason = 'CALCIO_ANALYSIS_ACTIVE_NON_URGENT_CLV';
    return { allowed: false, deferred: true, skipped: false, reason: state.lastDeferredReason, source };
  }
  return { allowed: true, deferred: false, skipped: false, reason: urgent ? 'URGENT_CLOSING_WINDOW_ALLOWED' : 'NO_CONTENTION', source };
}

function beginClv({ source = 'UNKNOWN', urgent = false } = {}) {
  const decision = clvDecision({ source, urgent });
  if (!decision.allowed) return { ...decision, release: () => {} };
  state.clvRunning = true;
  state.clvSource = source;
  state.clvStartedAt = nowIso();
  let released = false;
  return {
    ...decision,
    release() {
      if (released) return;
      released = true;
      state.clvRunning = false;
      state.clvSource = null;
      state.clvStartedAt = null;
      state.lastClvCompletedAt = nowIso();
      maybeFlushDeferredClv();
    }
  };
}

function scheduleDeferredClv({ source = 'UNKNOWN', run } = {}) {
  if (typeof run !== 'function') {
    return { registered: false, merged: false, scheduled: false, reason: 'DEFERRED_RUNNER_REQUIRED' };
  }

  const wasPending = state.clvDeferredPending;
  if (!wasPending) {
    state.clvDeferredPending = true;
    state.clvDeferredRegisteredAt = nowIso();
    deferredClvRunner = run;
  } else {
    state.clvDeferredMergedCount += 1;
  }
  uniquePush(state.clvDeferredSources, source);

  const flush = maybeFlushDeferredClv();
  return {
    registered: true,
    merged: wasPending,
    pending: state.clvDeferredPending,
    scheduled: flush.scheduled,
    reason: wasPending ? 'DEFERRED_CLV_MERGED_SINGLE_FLIGHT' : 'DEFERRED_CLV_ARMED_AFTER_CALCIO',
    flushReason: flush.reason,
    sources: state.clvDeferredSources.slice()
  };
}

function snapshot() {
  return {
    version: VERSION,
    patchRevision: PATCH_REVISION,
    calcioAnalysisRunning: isCalcioAnalysisRunning(),
    calcioAnalysisDepth: state.calcioAnalysisDepth,
    calcioAnalysisStartedAt: state.calcioAnalysisStartedAt,
    clvRunning: state.clvRunning,
    clvSource: state.clvSource,
    clvStartedAt: state.clvStartedAt,
    clvDeferredCount: state.clvDeferredCount,
    clvSkipAlreadyRunningCount: state.clvSkipAlreadyRunningCount,
    lastDeferredAt: state.lastDeferredAt,
    lastDeferredReason: state.lastDeferredReason,
    lastCalcioAnalysisCompletedAt: state.lastCalcioAnalysisCompletedAt,
    lastClvCompletedAt: state.lastClvCompletedAt,
    clvDeferredPending: state.clvDeferredPending,
    clvDeferredRegisteredAt: state.clvDeferredRegisteredAt,
    clvDeferredSources: state.clvDeferredSources.slice(),
    clvDeferredMergedCount: state.clvDeferredMergedCount,
    clvDeferredFlushScheduled: state.clvDeferredFlushScheduled,
    clvDeferredFlushCount: state.clvDeferredFlushCount,
    lastDeferredFlushAt: state.lastDeferredFlushAt,
    lastDeferredFlushSource: state.lastDeferredFlushSource,
    lastDeferredFlushError: state.lastDeferredFlushError
  };
}

function resetForTests() {
  deferredClvRunner = null;
  Object.assign(state, {
    calcioAnalysisDepth: 0,
    calcioAnalysisStartedAt: null,
    clvRunning: false,
    clvSource: null,
    clvStartedAt: null,
    clvDeferredCount: 0,
    clvSkipAlreadyRunningCount: 0,
    lastDeferredAt: null,
    lastDeferredReason: null,
    lastCalcioAnalysisCompletedAt: null,
    lastClvCompletedAt: null,
    clvDeferredPending: false,
    clvDeferredRegisteredAt: null,
    clvDeferredSources: [],
    clvDeferredMergedCount: 0,
    clvDeferredFlushScheduled: false,
    clvDeferredFlushCount: 0,
    lastDeferredFlushAt: null,
    lastDeferredFlushSource: null,
    lastDeferredFlushError: null
  });
}

module.exports = {
  VERSION,
  PATCH_REVISION,
  beginCalcioAnalysis,
  calcioAnalysisMiddleware,
  isCalcioAnalysisRunning,
  clvDecision,
  beginClv,
  scheduleDeferredClv,
  maybeFlushDeferredClv,
  snapshot,
  resetForTests
};
