#!/usr/bin/env node
'use strict';
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const tennisForwardLifecycle = require('./tennisForwardLifecycle');

const dbArg = process.argv.find(arg => /database_betting\.db$/i.test(arg));
const dbPath = path.resolve(dbArg || path.join(__dirname, 'database_betting.db'));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function hashRows(rows) { return crypto.createHash('sha256').update(JSON.stringify(stable(rows))).digest('hex'); }
const db = new DatabaseSync(dbPath);
try {
  const sourceBefore = db.prepare('SELECT * FROM ai_forward_test ORDER BY id').all();
  const sourceHashBefore = hashRows(sourceBefore);
  const before = tennisForwardLifecycle.scanForwardLifecycle(db, { includeDetails: true, limit: 100000 });
  const reconciliation = tennisForwardLifecycle.reconcileForwardLifecycle(db, {
    apply: true,
    operationId: `TENNIS_PATCH28_R1_LIFECYCLE_${Date.now()}`
  });
  const after = tennisForwardLifecycle.scanForwardLifecycle(db, { includeDetails: true, limit: 100000 });
  const sourceAfter = db.prepare('SELECT * FROM ai_forward_test ORDER BY id').all();
  const sourceHashAfter = hashRows(sourceAfter);
  const output = {
    success: reconciliation.success === true && after.driftBets === 0 && sourceHashBefore === sourceHashAfter,
    patch: 'TENNIS_PATCH_28_R1_LIFECYCLE_AVAILABILITY_ATP_LEDGER_RECOVERY',
    mutation: 'DERIVED_ELIGIBILITY_LEDGER_RECONCILIATION_ONLY',
    before: { trackedBets: before.trackedBets, driftBets: before.driftBets, counts: before.counts },
    repaired: reconciliation.repaired,
    failed: reconciliation.failed,
    after: { trackedBets: after.trackedBets, healthyBets: after.healthyBets, driftBets: after.driftBets, counts: after.counts },
    sourceRowsUnchanged: sourceHashBefore === sourceHashAfter,
    sourceHashBefore,
    sourceHashAfter
  };
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = output.success ? 0 : 1;
} finally { db.close(); }
