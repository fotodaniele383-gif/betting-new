'use strict';

const fs = require('fs');
const path = require('path');
const lifecycle = require('../backend/tennisForwardLifecycle');
const registry = require('../backend/tennisPatchRegistry');

const ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

assert(lifecycle.TENNIS_FORWARD_LIFECYCLE_VERSION === 'TENNIS_FORWARD_LIFECYCLE_V1_PATCH8', 'Versione lifecycle Patch 8 errata');
assert(Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 8, 'Registry corrente precedente a Patch 8');
assert(/^TENNIS_PATCH_REGISTRY_V\d+$/.test(registry.TENNIS_PATCH_REGISTRY_VERSION), 'Registry version non valida');
assert(registry.PATCHES.some(p => p.version === '7' && p.status === 'ACTIVE'), 'Patch 7 non preservata attiva');
assert(registry.PATCHES.some(p => p.version === '8' && p.status === 'ACTIVE'), 'Patch 8 non registrata attiva');

const clv = read('backend/clvTracker.js');
const paper = read('backend/paperTrading.tennis.js');
const server = read('backend/server.tennis.js');
const app = read('public/app.js');
const index = read('public/index.html');
const patch7Test = read('backend/tests/patch7TennisPredictionSnapshotForward.test.js');
const patch7Standalone = read('tools/test-tennis-patch7-standalone.js');
const patch5Test = read('backend/tests/patch5TennisSettlementEvidenceContract.test.js');

assert(clv.includes("require('./tennisForwardLifecycle')"), 'CLV non importa lifecycle');
assert(clv.includes('executeAtomicLifecycleTransition'), 'CLV non usa transazione lifecycle');
assert(clv.includes('PATCH8_ATOMIC_CLV_ROLLBACK'), 'CLV non espone rollback Patch 8');
assert(paper.includes("require('./tennisForwardLifecycle')"), 'Settlement non importa lifecycle');
assert(paper.includes('TRANSITIONS.SETTLEMENT_BLOCKED'), 'Settlement bloccato non atomico');
assert(paper.includes('TRANSITIONS.SETTLEMENT_VERIFIED'), 'Settlement verificato non atomico');
assert(paper.includes('PATCH8_ATOMIC_SETTLEMENT_ROLLBACK'), 'Settlement non espone rollback Patch 8');
assert(server.includes("router.get('/forward-lifecycle-health'"), 'Endpoint lifecycle summary assente');
assert(server.includes("router.get('/forward-lifecycle-health/:betId'"), 'Endpoint lifecycle detail assente');
assert(server.includes('tennisForwardLifecycleActive'), 'Health non espone Patch 8');
assert(app.includes('loadTennisForwardLifecycle'), 'UI lifecycle assente');
assert(app.includes('FORWARD_LIFECYCLE_FETCH'), 'Diagnostica UI lifecycle assente');
assert(index.includes('tennisForwardLifecyclePanel'), 'Pannello lifecycle assente');
assert(index.includes('data-patch8-forward-lifecycle="true"'), 'Marker Patch 8 assente');
assert(patch7Test.includes('toBeGreaterThanOrEqual(7)'), 'Test Patch 7 non compatibile con versioni successive');
assert(patch7Standalone.includes('currentPatch >= 7'), 'Standalone Patch 7 non compatibile con versioni successive');
assert(!patch7Standalone.includes("strictEqual(registry.TENNIS_CURRENT_PATCH_VERSION, '7')"), 'Standalone Patch 7 congela ancora la versione corrente');
assert(paper.includes("process.env.NODE_ENV === 'test'"), 'Adattatore Patch 5 non limitato a NODE_ENV=test');
assert(paper.includes('context.patch8TestOnlyNonAtomicAdapter === true'), 'Adattatore Patch 5 non richiede opt-in esplicito');
assert(patch5Test.includes('patch8TestOnlyNonAtomicAdapter: true'), 'Test Patch 5 non usa adattatore esplicito Patch 8');
assert(fs.readFileSync(path.join(ROOT, 'public', 'app.js')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'app.js'))), 'Copia app frontend differente');
assert(fs.readFileSync(path.join(ROOT, 'public', 'index.html')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'index.html'))), 'Copia index frontend differente');

const drift = lifecycle.compareEligibilityRecords(
  { eligibility_status: 'A', eligibility_reasons: '[]', settlement_eligible: 0, clv_eligible: 0, production_eligible: 0 },
  { eligibility_status: 'B', eligibility_reasons: '[]', settlement_eligible: 0, clv_eligible: 0, production_eligible: 0 }
);
assert(drift.match === false, 'Comparatore drift non rileva mismatch');
assert(lifecycle.deriveLifecycleState({ status: 'PENDING' }, { snapshot_status: 'VALID_PREMATCH' }, { match: true }, { valid: true }) === 'PREDICTION_CAPTURED', 'Stato prediction errato');
assert(lifecycle.deriveLifecycleState({ status: 'WON', settlement_contract_status: 'VERIFIED', clv_contract_status: 'VERIFIED' }, { snapshot_status: 'VALID_PREMATCH' }, { match: true }, { valid: true }) === 'COMPLETE_CERTIFIED', 'Stato complete errato');

console.log('PATCH8 R2 standalone audit PASS: registry, atomic CLV/settlement, drift watchdog, endpoints, UI and Patch7 compatibility.');
