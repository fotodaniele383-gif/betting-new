'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const snapshots = require('../backend/tennisPredictionSnapshots');
const lifecycle = require('../backend/tennisForwardLifecycle');
const cohorts = require('../backend/tennisForwardCohorts');
const registry = require('../backend/tennisPatchRegistry');
const runtimeDiagnostics = require('../backend/runtimeDiagnostics');

const root = path.resolve(__dirname, '..');
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const auditDir = path.join(root, 'audit_patch9');
const reportPath = path.join(auditDir, 'patch9_forward_canary_report.json');
const operationId = runtimeDiagnostics.createOperationId('PATCH9_FORWARD_CANARY');
const sentinel = 'PATCH9_CANARY_ROLLBACK_SENTINEL';
let db;

function iso(ms) { return new Date(ms).toISOString(); }
function count(db, table, where = '', params = []) {
  return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}${where ? ` WHERE ${where}` : ''}`).get(...params).n || 0);
}

try {
  db = new Database(dbPath);
  cohorts.ensureForwardCohortSchema(db);
  snapshots.ensurePredictionSnapshotTable(db);
  const maxId = Number(db.prepare('SELECT COALESCE(MAX(id),0) n FROM ai_forward_test').get().n || 0);
  const canaryId = maxId + 900000;
  const now = Date.now();
  const capturedAt = iso(now - 2 * 60 * 60 * 1000);
  const matchStartAt = iso(now - 60 * 60 * 1000);
  const closingAt = iso(now - 90 * 60 * 1000);
  const observedAt = iso(now - 30 * 60 * 1000);
  const eventFingerprint = `PATCH9_CANARY_EVENT_${canaryId}`;
  const marketFingerprint = `PATCH9_CANARY_MARKET_${canaryId}`;
  const before = {
    source: count(db, 'ai_forward_test'),
    snapshots: count(db, snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE),
    ledger: count(db, 'tennis_calibration_eligibility'),
    members: count(db, cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE),
    cohorts: count(db, cohorts.TENNIS_FORWARD_COHORT_TABLE)
  };
  let inside = null;

  runtimeDiagnostics.writeDiagnostic({
    level: 'INFO', component: 'TENNIS_FORWARD_CANARY', operation: 'FORWARD_CANARY', operationId,
    phase: 'FORWARD_CANARY_START', event: 'FORWARD_CANARY_START',
    message: 'Avvio canary end-to-end Patch 9 con rollback obbligatorio.', context: { canaryId }
  });

  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO ai_forward_test (
      id, bet_type, match_date, home_team, away_team, prediction, odd, opening_odd, stake, status,
      estimated_prob, edge_pp, ev_pct, league, strategy_tag, sport_type, data_quality, market_type,
      tour_type, surface, model_version, metric_version, engine_version,
      tennis_event_identity_status, tennis_event_identity_version, tennis_event_fingerprint, tennis_market_fingerprint,
      canonical_match_datetime, clv_contract_status, settlement_contract_status
    ) VALUES (
      @id, 'SINGLE_TENNIS', @matchStartAt, 'Patch9 Canary A', 'Patch9 Canary B', '1', 1.80, 1.80, 2, 'PENDING',
      62, 6.44, 11.6, 'ATP 250 Canary', 'PATCH9_FORWARD_CANARY', 'TENNIS', 'CURRENT', 'h2h',
      'ATP', 'HARD', 'PATCH9_CANARY_MODEL', 'PATCH9_CANARY_METRIC', 'PATCH9_CANARY_ENGINE',
      'PROVIDER_KEYED', 'TENNIS_EVENT_IDENTITY_V1_PATCH_3', @eventFingerprint, @marketFingerprint,
      @matchStartAt, 'PENDING', 'PENDING'
    )`).run({ id: canaryId, matchStartAt, eventFingerprint, marketFingerprint });

    const source = db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(canaryId);
    const snapshot = snapshots.capturePredictionSnapshot(db, source, {
      capturedAt, operationId, registryVersion: registry.TENNIS_PATCH_REGISTRY_VERSION, allowOriginal: true
    });
    if (!snapshot.inserted || Number(snapshot.snapshot?.is_calibration_anchor || 0) !== 1) throw new Error('PATCH9_CANARY_ANCHOR_FAILED');
    const initialEligibility = snapshots.refreshCalibrationEligibilityForBet(db, canaryId, { operationId });
    if (!initialEligibility.updated) throw new Error(`PATCH9_CANARY_INITIAL_LEDGER:${initialEligibility.reason}`);
    const assigned = cohorts.assignForwardCohortMember(db, canaryId, { operationId, evaluatedAt: iso(now) });
    if (!assigned.assigned) throw new Error(`PATCH9_CANARY_COHORT_ASSIGN:${assigned.reason}`);

    lifecycle.executeAtomicLifecycleTransition(db, {
      betId: canaryId, transition: lifecycle.TRANSITIONS.CLV_LOCK, operationId
    }, () => {
      const result = db.prepare(`UPDATE ai_forward_test SET
        clv_contract_status='VERIFIED', clv_contract_reason='CONTRACT_OK', clv_contract_version='TENNIS_CLV_CONTRACT_V1_PATCH4',
        clv_opening_ts=@capturedAt, clv_closing_ts=@closingAt, clv_bookmaker='PATCH9_CANARY_BOOK',
        clv_source_event_id=@eventId, clv_event_fingerprint=@eventFingerprint, clv_market_fingerprint=@marketFingerprint,
        closing_odd=1.72, clv_pct=((1.80/1.72)-1)*100, clv_verified=1
        WHERE id=@id`).run({ id: canaryId, capturedAt, closingAt, eventId: `PATCH9_CANARY_CLV_${canaryId}`, eventFingerprint, marketFingerprint });
      return { success: result.changes === 1, updated: result.changes === 1 };
    });

    lifecycle.executeAtomicLifecycleTransition(db, {
      betId: canaryId, transition: lifecycle.TRANSITIONS.SETTLEMENT_VERIFIED, operationId
    }, () => {
      const result = db.prepare(`UPDATE ai_forward_test SET
        status='WON', profit=1.60,
        settlement_contract_status='VERIFIED', settlement_contract_reason='CONTRACT_OK', settlement_contract_version='TENNIS_SETTLEMENT_CONTRACT_V1_PATCH5',
        settlement_source='PATCH9_CANARY_STRUCTURED', settlement_source_event_id=@sourceId,
        settlement_winner_name='Patch9 Canary A', settlement_observed_at=@observedAt,
        settlement_evidence_hash=@evidenceHash, settlement_event_fingerprint=@eventFingerprint,
        settlement_market_fingerprint=@marketFingerprint, settlement_operation_id=@operationId
        WHERE id=@id`).run({
          id: canaryId, sourceId: `PATCH9_CANARY_SETTLEMENT_${canaryId}`, observedAt,
          evidenceHash: cohorts.sha256(`PATCH9_CANARY_EVIDENCE_${canaryId}`), eventFingerprint, marketFingerprint, operationId
        });
      return { success: result.changes === 1, updated: result.changes === 1 };
    });

    const cohortInspection = cohorts.inspectForwardCohortMember(db, canaryId, { evaluatedAt: iso(now) });
    const finalLedger = db.prepare('SELECT * FROM tennis_calibration_eligibility WHERE bet_id=?').get(canaryId);
    if (!cohortInspection.success) throw new Error(`PATCH9_CANARY_COHORT_INSPECTION:${cohortInspection.reasons.join(',')}`);
    if (cohortInspection.member.maturity_status !== cohorts.MATURITY_STATES.MATURED_WITH_CLV) throw new Error(`PATCH9_CANARY_MATURITY:${cohortInspection.member.maturity_status}`);
    if (finalLedger.eligibility_status !== 'CLV_ELIGIBLE') throw new Error(`PATCH9_CANARY_ELIGIBILITY:${finalLedger.eligibility_status}`);
    inside = {
      snapshotId: snapshot.snapshot.snapshot_id,
      cohortId: cohortInspection.member.cohort_id,
      cohortRole: cohortInspection.member.cohort_role,
      maturityStatus: cohortInspection.member.maturity_status,
      eligibilityStatus: finalLedger.eligibility_status
    };
    throw new Error(sentinel);
  });

  try {
    transaction();
    throw new Error('PATCH9_CANARY_DID_NOT_ROLLBACK');
  } catch (error) {
    if (error.message !== sentinel) throw error;
  }

  const after = {
    source: count(db, 'ai_forward_test'),
    snapshots: count(db, snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE),
    ledger: count(db, 'tennis_calibration_eligibility'),
    members: count(db, cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE),
    cohorts: count(db, cohorts.TENNIS_FORWARD_COHORT_TABLE),
    canarySource: count(db, 'ai_forward_test', 'id=?', [canaryId]),
    canarySnapshot: count(db, snapshots.TENNIS_PREDICTION_SNAPSHOT_TABLE, 'bet_id=?', [canaryId]),
    canaryLedger: count(db, 'tennis_calibration_eligibility', 'bet_id=?', [canaryId]),
    canaryMember: count(db, cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE, 'bet_id=?', [canaryId])
  };
  const countsRestored = ['source', 'snapshots', 'ledger', 'members', 'cohorts'].every(key => before[key] === after[key]);
  const noCanaryRows = ['canarySource', 'canarySnapshot', 'canaryLedger', 'canaryMember'].every(key => after[key] === 0);
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const success = countsRestored && noCanaryRows && integrity === 'ok' && inside?.maturityStatus === cohorts.MATURITY_STATES.MATURED_WITH_CLV;
  const report = { success, patch: '9', operationId, canaryId, inside, before, after, countsRestored, noCanaryRows, integrity, rollbackGuaranteed: true, timestamp: new Date().toISOString() };
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  runtimeDiagnostics.writeDiagnostic({
    level: success ? 'INFO' : 'ERROR', component: 'TENNIS_FORWARD_CANARY', operation: 'FORWARD_CANARY', operationId,
    phase: 'FORWARD_CANARY_ROLLBACK', event: 'FORWARD_CANARY_ROLLBACK',
    message: success ? 'Canary Patch 9 completato e annullato senza dati permanenti.' : 'Canary Patch 9 non ha ripristinato completamente il database.',
    context: report
  });
  console.log(JSON.stringify(report, null, 2));
  if (!success) process.exitCode = 2;
} catch (error) {
  runtimeDiagnostics.captureError({
    component: 'TENNIS_FORWARD_CANARY', operation: 'FORWARD_CANARY', operationId,
    phase: 'FORWARD_CANARY_FAILED', event: 'FORWARD_CANARY_FAILED', error, context: { dbPath }
  });
  console.error(error.stack || error.message);
  process.exitCode = 2;
} finally {
  try { db?.close(); } catch (_) {}
}
