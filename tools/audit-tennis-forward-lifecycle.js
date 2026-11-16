'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const lifecycle = require('../backend/tennisForwardLifecycle');
const diagnostics = require('../backend/runtimeDiagnostics');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const betArg = args.find(arg => arg.startsWith('--bet-id='));
const dbArg = args.find(arg => arg.startsWith('--db='));
const betId = betArg ? Number(betArg.split('=', 2)[1]) : null;
const dbPath = dbArg ? path.resolve(dbArg.split('=', 2)[1]) : (process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db'));
const operationId = diagnostics.createOperationId(apply ? 'TENNIS_LIFECYCLE_RECONCILE' : 'TENNIS_LIFECYCLE_AUDIT');
const db = new Database(dbPath, apply ? {} : { readonly: true });

try {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') throw new Error(`SQLITE_INTEGRITY_FAILED:${integrity}`);
  let report;
  if (betId > 0) {
    report = lifecycle.inspectForwardLifecycleBet(db, betId, { operationId });
  } else if (apply) {
    report = lifecycle.reconcileForwardLifecycle(db, { apply: true, operationId });
  } else {
    report = lifecycle.scanForwardLifecycle(db, { includeDetails: true, limit: 1000 });
  }
  const output = {
    success: report.success !== false,
    patch: '8',
    lifecycleVersion: lifecycle.TENNIS_FORWARD_LIFECYCLE_VERSION,
    mode: betId > 0 ? 'DETAIL_READ_ONLY' : (apply ? 'RECONCILE_DERIVED_LEDGER_ONLY' : 'AUDIT_READ_ONLY'),
    dbPath,
    integrity,
    operationId,
    report,
    invariants: {
      sourceBetsRewrittenByAudit: false,
      snapshotsRewrittenByAudit: false,
      clvRewrittenByAudit: false,
      settlementRewrittenByAudit: false,
      applyModeMayRewriteDerivedEligibilityLedgerOnly: apply
    },
    timestamp: new Date().toISOString()
  };
  const outputDir = path.join(ROOT, 'audit_patch8');
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = apply ? 'patch8_lifecycle_reconcile_report.json' : (betId > 0 ? `patch8_lifecycle_bet_${betId}.json` : 'patch8_lifecycle_audit_report.json');
  fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  db.close();
  if (!output.success) process.exit(2);
} catch (error) {
  try { db.close(); } catch (_) {}
  diagnostics.captureError({
    component: 'TENNIS_FORWARD_LIFECYCLE', operation: apply ? 'RECONCILE_CLI' : 'AUDIT_CLI',
    operationId, phase: 'PATCH8_CLI_FAILED', error, context: { dbPath, apply, betId }
  });
  console.error(error.stack || error.message);
  process.exit(2);
}
