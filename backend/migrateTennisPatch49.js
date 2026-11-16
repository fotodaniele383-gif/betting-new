#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const canonical = require('./tennisDeepScanCanonicalOnboardingPatch49');

const PATCH = 'TENNIS_PATCH_49_CROSS_SPORT_ANALYSIS_MEMORY_PREDICTION_INDEX_BANDS_AI_RELIABILITY';
const REVISION = 'R1_WINDOWS_NODE_CROSS_SPORT_ANALYSIS_MEMORY_ANALYTICS';
const apply = process.argv.includes('--apply');
const dbArg = process.argv.find(arg => arg.endsWith('.db'));
const dbPath = path.resolve(dbArg || path.join(__dirname, 'database_betting.db'));

function openDb() {
  try {
    const req = createRequire(path.join(__dirname, '..', 'package.json'));
    const BetterSqlite3 = req('better-sqlite3');
    return new BetterSqlite3(dbPath);
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(dbPath);
  }
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function immutableRows(db) {
  return db.prepare(`SELECT id,estimated_prob,odd,closing_odd,clv,clv_edge,stake,status,profit,
    settlement_contract_status,settlement_contract_reason
    FROM ai_forward_test ORDER BY id`).all();
}

const db = openDb();
try {
  const beforeRows = immutableRows(db);
  const beforeFingerprint = hash(beforeRows);
  const before = canonical.getCoverage(db);
  const reconcile = apply
    ? canonical.reconcileCanonicalCoverage(db, { source: 'PATCH49_INSTALL_MIGRATION' })
    : { success: true, preview: true, before, repaired: 0, repairedIds: [], after: before };
  const afterRows = immutableRows(db);
  const afterFingerprint = hash(afterRows);
  const integrity = db.prepare('PRAGMA integrity_check').get();
  const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
  const failures = [];
  if (!reconcile.success) failures.push('CANONICAL_DEEPSCAN_COVERAGE_INCOMPLETE');
  if (beforeFingerprint !== afterFingerprint) failures.push('IMMUTABLE_BUSINESS_VALUES_CHANGED');
  if (integrity.integrity_check !== 'ok') failures.push('DATABASE_INTEGRITY_FAILED');
  if (foreignKeyViolations.length) failures.push('FOREIGN_KEY_VIOLATIONS');
  const output = {
    success: failures.length === 0,
    patch: PATCH,
    revision: REVISION,
    mode: apply ? 'APPLY' : 'PREVIEW',
    migration: 'CANONICAL_DEEPSCAN_CONTINUOUS_ONBOARDING_NO_BUSINESS_VALUE_CHANGE',
    dbPath,
    before,
    reconcile,
    after: canonical.getCoverage(db),
    probabilityOddsClvStakeSettlementUnchanged: beforeFingerprint === afterFingerprint,
    beforeFingerprint,
    afterFingerprint,
    integrity: integrity.integrity_check,
    foreignKeyViolations: foreignKeyViolations.length,
    failures
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.success) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ success: false, patch: PATCH, revision: REVISION, error: error.stack || error.message }, null, 2));
  process.exitCode = 1;
} finally {
  if (typeof db.close === 'function') db.close();
}
