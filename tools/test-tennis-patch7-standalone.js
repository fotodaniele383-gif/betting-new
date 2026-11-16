'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const snapshots = require('../backend/tennisPredictionSnapshots');
const eligibility = require('../backend/tennisCalibrationEligibility');
const settlement = require('../backend/tennisSettlementContract');
const registry = require('../backend/tennisPatchRegistry');

const root = path.resolve(__dirname, '..');
const row = {
  id: 7, sport_type: 'TENNIS', bet_type: 'TENNIS_ATP_MONEYLINE', status: 'PENDING',
  match_date: '2026-07-14T12:00:00Z', canonical_match_datetime: '2026-07-14T12:00:00Z',
  home_team: 'Jannik Sinner', away_team: 'Carlos Alcaraz', prediction: '1', internal_side: '1',
  odd: 1.8, opening_odd: 1.8, stake: 2, estimated_prob: 63, edge_pp: 7.44, ev_pct: 13.4,
  market_type: 'MONEYLINE', tour_type: 'ATP', surface: 'HARD', league: '[ATP] Grand Slam',
  model_version: 'MODEL_TEST', metric_version: 'METRIC_TEST', engine_version: 'ENGINE_TEST', data_quality: 'CURRENT',
  tennis_event_identity_status: 'PROVIDER_KEYED', tennis_event_identity_version: 'TENNIS_EVENT_IDENTITY_V1_PATCH_3',
  tennis_event_fingerprint: 'EVT7', tennis_market_fingerprint: 'MKT7'
};
const currentPatch = Number(registry.TENNIS_CURRENT_PATCH_VERSION);
assert.ok(currentPatch >= 7, `Patch corrente incompatibile: ${registry.TENNIS_CURRENT_PATCH_VERSION}`);
assert.ok(registry.PATCHES.some(item => item.version === '7' && item.status === 'ACTIVE'), 'Patch 7 deve restare ACTIVE');
const payload = snapshots.buildSnapshotPayload(row, { capturedAt: '2026-07-14T10:00:00Z' });
assert.strictEqual(snapshots.validateSnapshotPayload(payload).status, 'VALID_PREMATCH');
assert.strictEqual(snapshots.validateSnapshotPayload({ ...payload, captured_at: '2026-07-14T13:00:00Z' }).status, 'POST_START_INVALID');
const anchor = { snapshot_id: 'S7', snapshot_hash: 'a'.repeat(64), snapshot_status: 'VALID_PREMATCH', snapshot_version: snapshots.TENNIS_PREDICTION_SNAPSHOT_VERSION, captured_at: '2026-07-14T10:00:00Z', is_calibration_anchor: 1, payload_json: JSON.stringify(payload) };
const effective = eligibility.applyPredictionSnapshotToRow({ ...row, estimated_prob: 99, odd: 1.1 }, anchor);
assert.strictEqual(effective.estimated_prob, 63);
assert.strictEqual(effective.odd, 1.8);
const weak = settlement.evaluateTennisSettlementContract(row, { winner: 1, winnerName: 'Jannik Sinner', source: 'WEB_FALLBACK', sourceEventId: 'WEB7', observedAt: '2026-07-14T15:00:00Z', providerCompleted: true, rawEvidence: { winner: 'Jannik Sinner' } });
assert.strictEqual(weak.status, 'PROPOSED');
assert.ok(weak.reason.includes('REQUIRES_REVIEW'));
const server = fs.readFileSync(path.join(root, 'backend', 'server.tennis.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
assert.ok(server.includes('savePendingTennisBetCore(bet)'));
assert.ok(server.includes('TENNIS_PREDICTION_SNAPSHOT_V1_PATCH7'));
assert.ok(server.includes("router.get('/prediction-audit'"));
assert.ok(app.includes('loadTennisPredictionAudit'));
assert.ok(index.includes('tennisPredictionAuditPanel'));
const auditSource = fs.readFileSync(path.join(root, 'tools', 'audit-tennis-project-state.js'), 'utf8');
assert.ok(auditSource.includes("columns.has('bet_id')"));
assert.ok(auditSource.includes("columns.has('source_bet_id')"));
assert.ok(auditSource.includes('predictionAuditReferenceColumn'));
assert.ok(!auditSource.includes('ON a.id=p.source_bet_id WHERE p.source_bet_id IS NOT NULL'));
console.log('PATCH7 compatibility standalone audit PASS: payload, timing guard, immutable overlay, weak-source reason, server/UI hooks, schema-aware project audit.');
