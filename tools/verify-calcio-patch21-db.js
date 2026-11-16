'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');

const source = path.resolve(__dirname, '../backend/database_betting.db');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betting-p21-db-'));
const copy = path.join(tempDir, 'database_betting.db');
fs.copyFileSync(source, copy);
const db = new DatabaseSync(copy);
try {
  const before = {
    tennis: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get(),
    resolved: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')").get()
  };
  const previousComponents = JSON.stringify({
    probability: { probability: 61.94, monteCarlo: 63.7, model: 62.5, marketProbability: 58.82, consensusScore: 82.4 },
    value: { edgePp: 2.34, evPct: 3.97 }
  });
  const provenance = JSON.stringify({
    market: 'U2.5', status: 'CERTIFIED_MULTI_SOURCE', certified: true,
    operationalEligible: true, realDirect: true, crossVerified: true, sourceCount: 3,
    selectedSource: { providerEventId: 'evt-p21-db', bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', lastUpdate: '2026-07-23T20:00:00Z', marketKey: 'totals', outcomeName: 'Under', point: 2.5, price: 1.70, direct: true, derived: false },
    sources: [{ bookmakerKey: 'pinnacle' }, { bookmakerKey: 'unibet' }, { bookmakerKey: 'betfair' }]
  });
  const fixtureRow = {
    sport_type: 'CALCIO', status: 'PENDING', bet_type: 'SINGLE', paper_result_active: 1, paper_result_conflict: 0,
    home_team: 'Genoa', away_team: 'Napoli', prediction: 'U2.5', market_type: 'TOTALS', odd: 1.70,
    estimated_prob: 61.94, edge_pp: 2.34, ev_pct: 3.97, stake: 0, bankroll_snapshot: 2003.69,
    calcio_prediction_reliability_score: 68, ds_action: 'WATCHLIST LOW EDGE', historical_combo_resolved: 0,
    calcio_prediction_index_components: previousComponents,
    calcio_provider_home_team: 'Genoa', calcio_provider_away_team: 'Napoli', provider_event_id: 'evt-p21-db', calcio_provider_event_id: 'evt-p21-db',
    calcio_event_key: 'calcio-event|test|evt-p21-db', match_exposure_key: 'calcio-event|test|evt-p21-db',
    calcio_odds_certification_status: 'CERTIFIED_MULTI_SOURCE', calcio_odds_certified: 1, calcio_odds_operational_eligible: 1,
    calcio_odds_direct: 1, calcio_odds_derived: 0, calcio_odds_bookmaker_key: 'pinnacle', calcio_odds_bookmaker_title: 'Pinnacle',
    calcio_odds_market_key: 'totals', calcio_odds_last_update: '2026-07-23T20:00:00Z', calcio_odds_source_count: 3,
    calcio_odds_provenance_json: provenance, calcio_decision_certification_status: 'DECISION_STRUCTURALLY_CERTIFIED'
  };
  const fixtureColumns = Object.keys(fixtureRow);
  const fixture = db.prepare(`INSERT INTO ai_forward_test (${fixtureColumns.join(',')}) VALUES (${fixtureColumns.map(() => '?').join(',')})`).run(...fixtureColumns.map(key => fixtureRow[key]));
  const fixtureId = Number(fixture.lastInsertRowid);
  const first = reconciler.reconcilePendingRows(db);
  const second = reconciler.reconcilePendingRows(db);
  const after = {
    tennis: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get(),
    resolved: db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')").get()
  };
  assert.deepEqual(before.tennis, after.tennis, 'Tennis modificato');
  assert.deepEqual(before.resolved, after.resolved, 'Calcio risolto modificato');
  assert.equal(second.updated, 0, `Seconda riconciliazione non idempotente: ${second.updated}`);
  const fixtureAfter = db.prepare('SELECT stake, calcio_prediction_index_score, calcio_prediction_index_label, calcio_stake_lifecycle_status FROM ai_forward_test WHERE id=?').get(fixtureId);
  assert(Number(fixtureAfter.stake) >= 7 && Number(fixtureAfter.stake) <= 9, JSON.stringify(fixtureAfter));
  assert(Number(fixtureAfter.calcio_prediction_index_score) >= 60, JSON.stringify(fixtureAfter));
  assert.equal(fixtureAfter.calcio_prediction_index_label, 'MICRO');
  const invalid = db.prepare(`
    SELECT COUNT(*) n FROM ai_forward_test
    WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
      AND UPPER(COALESCE(status,'PENDING'))='PENDING'
      AND COALESCE(paper_result_active,1)=1
      AND COALESCE(paper_result_conflict,0)=0
      AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR')
      AND COALESCE(stake,0)>0
      AND (COALESCE(calcio_identity_certified,0)<>1 OR COALESCE(calcio_market_identity_certified,0)<>1 OR COALESCE(calcio_odds_operational_eligible,0)<>1)
  `).get();
  assert.equal(Number(invalid.n), 0);
  console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_21_UNIFIED_IPM_STAKE_MARKET_SELECTION_RESTORE',
    first: { scanned: first.scanned, updated: first.updated, operationalPositive: first.operationalPositive, refreshRequiredSkipped: first.refreshRequiredSkipped },
    certifiedFixture: { id: fixtureId, stake: Number(fixtureAfter.stake), index: Number(fixtureAfter.calcio_prediction_index_score), label: fixtureAfter.calcio_prediction_index_label, status: fixtureAfter.calcio_stake_lifecycle_status },
    second: { updated: second.updated, idempotent: true },
    safeguards: { invalidPositive: Number(invalid.n), tennisUnchanged: true, resolvedCalcioUnchanged: true }
  }, null, 2));
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
