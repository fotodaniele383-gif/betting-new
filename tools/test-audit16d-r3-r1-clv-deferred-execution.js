#!/usr/bin/env node
'use strict';
const path = require('path');
const ROOT = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] || '.' : path.join(__dirname, '..'));
const coordinator = require(path.join(ROOT, 'backend', 'runtimeWorkloadCoordinatorAudit16dR3'));
const checks = [];
const add = (name, ok, details = null) => checks.push({ name, ok: Boolean(ok), details });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  try {
    coordinator.resetForTests();
    add('R3 contract version preserved', coordinator.VERSION === 'AUDIT16D_R3_RUNTIME_WORKLOAD_COORDINATOR_V1', coordinator.VERSION);
    add('R3_R1 revision exposed', coordinator.PATCH_REVISION === 'AUDIT16D_R3_R1_CLV_DEFERRED_EXECUTION_V1', coordinator.PATCH_REVISION);

    let deferredRuns = 0;
    const outerEnd = coordinator.beginCalcioAnalysis();
    const innerEnd = coordinator.beginCalcioAnalysis();
    const firstDecision = coordinator.beginClv({ source: 'AUTO_INTERVAL_A', urgent: false });
    add('Non urgent CLV is blocked during Calcio analysis', firstDecision.allowed === false && firstDecision.deferred === true && firstDecision.reason === 'CALCIO_ANALYSIS_ACTIVE_NON_URGENT_CLV', firstDecision);

    const r1 = coordinator.scheduleDeferredClv({
      source: 'AUTO_INTERVAL_A',
      run: async () => { deferredRuns += 1; }
    });
    const r2 = coordinator.scheduleDeferredClv({
      source: 'AUTO_INTERVAL_B',
      run: async () => { deferredRuns += 100; }
    });
    add('First deferred CLV run is armed', r1.registered === true && r1.merged === false && r1.reason === 'DEFERRED_CLV_ARMED_AFTER_CALCIO', r1);
    add('Repeated interval merges into same deferred run', r2.registered === true && r2.merged === true && r2.reason === 'DEFERRED_CLV_MERGED_SINGLE_FLIGHT', r2);
    add('Deferred run remains pending while nested analysis active', coordinator.snapshot().clvDeferredPending === true && coordinator.snapshot().calcioAnalysisDepth === 2, coordinator.snapshot());

    innerEnd();
    await sleep(20);
    add('Inner analysis completion does not flush early', deferredRuns === 0 && coordinator.snapshot().calcioAnalysisDepth === 1, { deferredRuns, snapshot: coordinator.snapshot() });

    outerEnd();
    await sleep(40);
    const afterFlush = coordinator.snapshot();
    add('Exactly one deferred CLV run executes after final Calcio completion', deferredRuns === 1, { deferredRuns, afterFlush });
    add('Deferred latch clears after execution', afterFlush.clvDeferredPending === false && afterFlush.clvDeferredFlushCount === 1 && afterFlush.clvDeferredMergedCount === 1, afterFlush);
    add('Merged sources remain visible in last flush metadata', String(afterFlush.lastDeferredFlushSource || '').includes('AUTO_INTERVAL_A') && String(afterFlush.lastDeferredFlushSource || '').includes('AUTO_INTERVAL_B'), afterFlush.lastDeferredFlushSource);

    coordinator.resetForTests();
    const end = coordinator.beginCalcioAnalysis();
    const urgent = coordinator.beginClv({ source: 'AUTO_URGENT', urgent: true });
    add('Urgent closing-window CLV remains allowed during Calcio', urgent.allowed === true && urgent.reason === 'URGENT_CLOSING_WINDOW_ALLOWED', urgent);
    urgent.release();
    end();
    await sleep(10);
    add('No deferred run invented for urgent CLV', coordinator.snapshot().clvDeferredFlushCount === 0 && coordinator.snapshot().clvDeferredPending === false, coordinator.snapshot());
  } catch (error) {
    add('Unhandled', false, { message: error.message, stack: error.stack });
  }

  const failures = checks.filter(x => !x.ok);
  console.log(JSON.stringify({ success: failures.length === 0, patch: 'AUDIT16D_R3_R1', suite: 'CLV_DEFERRED_EXECUTION', checks: checks.length, failures, details: checks }, null, 2));
  process.exit(failures.length ? 1 : 0);
})();
