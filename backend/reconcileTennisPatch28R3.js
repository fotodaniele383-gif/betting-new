#!/usr/bin/env node
'use strict';
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const tennisForwardLifecycle = require('./tennisForwardLifecycle');
const tennisForwardCohorts = require('./tennisForwardCohorts');
const tennisForwardCaptureHealth = require('./tennisForwardCaptureHealth');

const dbArg = process.argv.find(arg => /database_betting\.db$/i.test(arg));
const dbPath = path.resolve(dbArg || path.join(__dirname, 'database_betting.db'));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function hashRows(rows) { return crypto.createHash('sha256').update(JSON.stringify(stable(rows))).digest('hex'); }
const db = new DatabaseSync(dbPath);
db.transaction = fn => (...args) => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(...args); db.exec('COMMIT'); return value; } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; } };
try {
  const sourceBefore = db.prepare('SELECT * FROM ai_forward_test ORDER BY id').all();
  const sourceHashBefore = hashRows(sourceBefore);
  const lifecycleBefore = tennisForwardLifecycle.scanForwardLifecycle(db, { includeDetails: true, limit: 100000 });
  const operationId = `TENNIS_PATCH28_R3_ALIGNMENT_${Date.now()}`;
  const lifecycle = tennisForwardLifecycle.reconcileForwardLifecycle(db, { apply: true, operationId });
  const cohorts = tennisForwardCohorts.reconcileForwardCohortMaturity(db, { operationId, limit: 100000 });
  const lifecycleAfter = tennisForwardLifecycle.scanForwardLifecycle(db, { includeDetails: true, limit: 100000 });
  const capture = tennisForwardCaptureHealth.scanForwardCaptureHealth(db, { limit: 100000, operationId });
  const sourceAfter = db.prepare('SELECT * FROM ai_forward_test ORDER BY id').all();
  const sourceHashAfter = hashRows(sourceAfter);
  const output = {
    success: lifecycle.success === true && lifecycleAfter.driftBets === 0 && Number(cohorts.blocked || 0) === 0 && Number(capture.structuralBlocked || 0) === 0 && sourceHashBefore === sourceHashAfter,
    patch: 'TENNIS_PATCH_28_R3_RUNTIME_DIAGNOSTICS_SCOPE_ODDS_TIMEOUT_DERIVED_STATE_ALIGNMENT',
    version: 'TENNIS_PATCH28_R3_DERIVED_STATE_ORCHESTRATOR_V1',
    mutation: 'DERIVED_LIFECYCLE_AND_COHORT_STATE_ALIGNMENT_ONLY',
    lifecycleBefore: { trackedBets: lifecycleBefore.trackedBets, healthyBets: lifecycleBefore.healthyBets, driftBets: lifecycleBefore.driftBets, counts: lifecycleBefore.counts },
    lifecycleReconcile: { repaired: lifecycle.repaired, failed: lifecycle.failed },
    lifecycleAfter: { trackedBets: lifecycleAfter.trackedBets, healthyBets: lifecycleAfter.healthyBets, driftBets: lifecycleAfter.driftBets, counts: lifecycleAfter.counts },
    cohorts: { scanned: cohorts.scanned, updated: cohorts.updated, unchanged: cohorts.unchanged, blocked: cohorts.blocked, errors: cohorts.errors },
    capture: { status: capture.status, runtimeSeverity: capture.runtimeSeverity, trackedBets: capture.trackedBets, structuralBlocked: capture.structuralBlocked, evidenceOverdue: capture.evidenceOverdue },
    sourceRows: sourceAfter.length,
    sourceRowsUnchanged: sourceHashBefore === sourceHashAfter,
    sourceHashBefore,
    sourceHashAfter,
    probabilityAuthorityChanged: false,
    qualityGateAuthorityChanged: false,
    stakeAuthorityChanged: false,
    settlementAuthorityChanged: false
  };
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = output.success ? 0 : 1;
} finally {
  db.close();
}
