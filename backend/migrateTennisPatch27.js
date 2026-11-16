#!/usr/bin/env node
'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cohorts = require('./tennisForwardCohorts');

const dbPath = path.resolve(process.argv[2] || path.join(__dirname, 'database_betting.db'));
const db = new DatabaseSync(dbPath);
db.transaction = fn => (...args) => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(...args); db.exec('COMMIT'); return value; } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; } };
try {
  const countsBefore = {
    total: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0),
    members: Number(db.prepare(`SELECT COUNT(*) n FROM ${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE}`).get().n || 0)
  };
  const sealsBefore = new Map(db.prepare(`SELECT bet_id, cohort_id, snapshot_id, snapshot_hash, seal_hash FROM ${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE}`).all().map(row => [row.bet_id, row]));
  const before = cohorts.scanForwardCohorts(db, { limit: 200 });
  const reconciliation = cohorts.reconcileForwardCohortMaturity(db, {
    operationId: `TENNIS_PATCH27_INSTALL_${Date.now()}`,
    limit: 200
  });
  const after = cohorts.scanForwardCohorts(db, { limit: 200 });
  const sealsAfter = db.prepare(`SELECT bet_id, cohort_id, snapshot_id, snapshot_hash, seal_hash FROM ${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE}`).all();
  const immutableViolations = sealsAfter.filter(row => JSON.stringify(sealsBefore.get(row.bet_id)) !== JSON.stringify(row));
  const countsAfter = {
    total: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0),
    members: Number(db.prepare(`SELECT COUNT(*) n FROM ${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE}`).get().n || 0)
  };
  if (JSON.stringify(countsBefore) !== JSON.stringify(countsAfter)) throw new Error(`PATCH27_ROW_COUNTS_CHANGED:${JSON.stringify(countsBefore)}:${JSON.stringify(countsAfter)}`);
  if (immutableViolations.length) throw new Error(`PATCH27_COHORT_IMMUTABLE_FIELDS_CHANGED:${immutableViolations.map(x => x.bet_id).join(',')}`);
  console.log(JSON.stringify({
    success: true,
    patch: 'TENNIS_PATCH_27_DEEPSCAN_RAM_CACHE_EXPLAINABLE_MATCHUP_COHORT_RECONCILIATION',
    migration: 'DERIVED_COHORT_MATURITY_STATE_RECONCILIATION_ONLY',
    before: { trackedMembers: before.trackedMembers, unhealthyMembers: before.unhealthyMembers, leakageBlocked: before.leakageBlocked, counts: before.counts },
    reconciliation: { scanned: reconciliation.scanned, updated: reconciliation.updated, unchanged: reconciliation.unchanged, blocked: reconciliation.blocked },
    after: { trackedMembers: after.trackedMembers, unhealthyMembers: after.unhealthyMembers, leakageBlocked: after.leakageBlocked, counts: after.counts },
    immutableCohortFieldsChanged: 0,
    historicalRowsRewritten: 0,
    rowCounts: countsAfter
  }, null, 2));
} finally {
  db.close();
}
