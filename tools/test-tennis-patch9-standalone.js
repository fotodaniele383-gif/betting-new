'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cohorts = require('../backend/tennisForwardCohorts');
const snapshots = require('../backend/tennisPredictionSnapshots');
const registry = require('../backend/tennisPatchRegistry');

const ROOT = path.resolve(__dirname, '..');
function assert(condition, message) { if (!condition) throw new Error(message); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

class BetterSqliteCompat {
  constructor(file) {
    this.raw = new DatabaseSync(file);
    this._inTransaction = false;
  }
  get inTransaction() { return this._inTransaction; }
  exec(sql) { return this.raw.exec(sql); }
  prepare(sql) {
    const stmt = this.raw.prepare(sql);
    return {
      run: (...args) => {
        const result = stmt.run(...args);
        return { changes: Number(result.changes || 0), lastInsertRowid: Number(result.lastInsertRowid || 0) };
      },
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args)
    };
  }
  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN IMMEDIATE');
      this._inTransaction = true;
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (error) {
        this.exec('ROLLBACK');
        throw error;
      } finally { this._inTransaction = false; }
    };
  }
  close() { this.raw.close(); }
}

assert(Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 9, 'Registry corrente precedente a Patch 9');
assert(/^TENNIS_PATCH_REGISTRY_V\d+$/.test(registry.TENNIS_PATCH_REGISTRY_VERSION), 'Registry version non valida');
assert(registry.PATCHES.some(p => p.version === '8' && p.status === 'ACTIVE'), 'Patch 8 non preservata');
assert(registry.PATCHES.some(p => p.version === '9' && p.status === 'ACTIVE'), 'Patch 9 non attiva');
assert(cohorts.TENNIS_FORWARD_COHORT_VERSION === 'TENNIS_FORWARD_COHORT_V1_PATCH9', 'Versione coorti errata');
assert(cohorts.roleFromSnapshotHash('0'.repeat(64), 20) === 'HOLDOUT', 'Holdout split non deterministico');
assert(cohorts.roleFromSnapshotHash('f'.repeat(64), 20) === 'DEVELOPMENT', 'Development split non deterministico');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch9-standalone-'));
const db = new BetterSqliteCompat(path.join(dir, 'test.db'));
try {
  db.exec(`CREATE TABLE ai_forward_test (
    id INTEGER PRIMARY KEY, bet_type TEXT, match_date TEXT, canonical_match_datetime TEXT,
    home_team TEXT, away_team TEXT, prediction TEXT, odd REAL, opening_odd REAL, closing_odd REAL,
    stake REAL, status TEXT, profit REAL, estimated_prob REAL, edge_pp REAL, ev_pct REAL,
    league TEXT, strategy_tag TEXT, sport_type TEXT, data_quality TEXT, market_type TEXT,
    tour_type TEXT, surface TEXT, model_version TEXT, metric_version TEXT, engine_version TEXT,
    tennis_event_identity_status TEXT, tennis_event_identity_version TEXT,
    tennis_event_fingerprint TEXT, tennis_market_fingerprint TEXT,
    clv_contract_status TEXT, clv_contract_version TEXT, clv_opening_ts TEXT, clv_closing_ts TEXT,
    clv_bookmaker TEXT, clv_source_event_id TEXT, clv_event_fingerprint TEXT, clv_market_fingerprint TEXT, clv_pct REAL,
    settlement_contract_status TEXT, settlement_contract_version TEXT, settlement_source TEXT,
    settlement_source_event_id TEXT, settlement_evidence_hash TEXT, settlement_event_fingerprint TEXT,
    settlement_market_fingerprint TEXT, settlement_observed_at TEXT
  )`);
  snapshots.ensurePredictionSnapshotTable(db);
  cohorts.ensureForwardCohortSchema(db);
  db.prepare(`INSERT INTO ai_forward_test (
    id,bet_type,match_date,canonical_match_datetime,home_team,away_team,prediction,odd,opening_odd,stake,status,
    estimated_prob,edge_pp,ev_pct,league,strategy_tag,sport_type,data_quality,market_type,tour_type,surface,
    model_version,metric_version,engine_version,tennis_event_identity_status,tennis_event_identity_version,
    tennis_event_fingerprint,tennis_market_fingerprint,clv_contract_status,settlement_contract_status
  ) VALUES (1,'SINGLE_TENNIS','2026-07-14T10:00:00Z','2026-07-14T10:00:00Z','A','B','1',1.8,1.8,2,'PENDING',62,6.4,11.6,'ATP 250','PATCH9','TENNIS','CURRENT','h2h','ATP','HARD','M9','MT9','E9','PROVIDER_KEYED','TENNIS_EVENT_IDENTITY_V1_PATCH_3','E1','M1','PENDING','PENDING')`).run();
  const row = db.prepare('SELECT * FROM ai_forward_test WHERE id=1').get();
  const snap = snapshots.capturePredictionSnapshot(db, row, { capturedAt: '2026-07-14T08:00:00Z', registryVersion: registry.TENNIS_PATCH_REGISTRY_VERSION, allowOriginal: true, operationId: 'OP9' });
  assert(snap.snapshot.is_calibration_anchor === 1, 'Anchor Patch 9 non creato');
  const assigned = cohorts.assignForwardCohortMember(db, 1, { operationId: 'OP9', evaluatedAt: '2026-07-14T09:00:00Z' });
  assert(assigned.assigned === true, 'Membership non assegnata');
  assert(assigned.member.maturity_status === 'OBSERVATION_PENDING', 'Maturità iniziale errata');
  let immutableBlocked = false;
  try { db.prepare(`UPDATE ${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE} SET cohort_id='BROKEN' WHERE bet_id=1`).run(); } catch (error) { immutableBlocked = /PATCH9_COHORT_SEAL_IMMUTABLE/.test(error.message); }
  assert(immutableBlocked, 'Trigger immutabilità membership non attivo');
  const scan = cohorts.scanForwardCohorts(db, { limit: 10, evaluatedAt: '2026-07-14T09:00:00Z' });
  assert(scan.trackedMembers === 1 && scan.unhealthyMembers === 0, 'Audit coorte non allineato');
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

const server = read('backend/server.tennis.js');
const lifecycle = read('backend/tennisForwardLifecycle.js');
const app = read('public/app.js');
const index = read('public/index.html');
assert(server.includes("require('./tennisForwardCohorts')"), 'Server non importa coorti Patch 9');
assert(server.includes("router.get('/forward-cohort-health'"), 'Endpoint coorti assente');
assert(server.includes('COHORT_MEMBER_SEALED'), 'Persistenza prediction non sigilla la coorte');
assert(lifecycle.includes('refreshForwardCohortMaturity'), 'Lifecycle Patch 8 non aggiorna maturità Patch 9');
assert(app.includes('setTennisOperationsCollapsed'), 'Centro operativo non riducibile');
assert(app.includes('loadTennisForwardCohorts'), 'UI coorti non collegata');
assert(index.includes('tennisOperationsCenter'), 'Finestra operativa assente');
assert(index.includes('data-patch9-compact-operations-center="true"'), 'Marker UI Patch 9 assente');
assert((index.match(/data-tennis-patch=["']\d+["']/g) || []).length >= 9, 'La mappa grafica deve conservare almeno Patch 1-9');
const criticalUiIds = [
  'tennisOperationsCenter', 'tennisOperationsBody', 'tennisPatchMap', 'toggleTennisOperationsCenter', 'refreshTennisOperationsCenter',
  'tennisOpsReadinessChip', 'tennisOpsAlertChip', 'tennisCalibrationReadinessPanel', 'tennisPredictionAuditPanel',
  'tennisForwardLifecyclePanel', 'tennisForwardCohortPanel', 'refreshTennisCalibrationReadiness',
  'refreshTennisPredictionAudit', 'refreshTennisForwardLifecycle', 'refreshTennisForwardCohorts'
];
for (const id of criticalUiIds) {
  const matches = index.match(new RegExp(`\\bid=["']${id}["']`, 'g')) || [];
  assert(matches.length === 1, `ID UI ${id} deve comparire una sola volta, trovato ${matches.length}`);
  assert(app.includes(`$('${id}')`) || app.includes(`getElementById('${id}')`) || id === 'tennisOperationsBody' || id === 'tennisPatchMap', `ID UI ${id} non collegato in app.js`);
}
const endpointPairs = [
  ['/api/tennis/calibration-readiness', "router.get('/calibration-readiness'"],
  ['/api/tennis/prediction-audit', "router.get('/prediction-audit'"],
  ['/api/tennis/forward-lifecycle-health', "router.get('/forward-lifecycle-health'"],
  ['/api/tennis/forward-cohort-health', "router.get('/forward-cohort-health'"]
];
for (const [frontendPath, backendMarker] of endpointPairs) {
  assert(app.includes(frontendPath), `Endpoint frontend non collegato: ${frontendPath}`);
  assert(server.includes(backendMarker), `Endpoint backend non collegato: ${backendMarker}`);
}
assert(fs.readFileSync(path.join(ROOT, 'public', 'app.js')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'app.js'))), 'Copia app frontend differente');
assert(fs.readFileSync(path.join(ROOT, 'public', 'index.html')).equals(fs.readFileSync(path.join(ROOT, 'backend', 'public', 'index.html'))), 'Copia index frontend differente');
console.log('PATCH9 standalone audit PASS: cohort seal, temporal guard, immutable membership, compact UI and backend/frontend links.');
