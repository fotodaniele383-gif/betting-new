'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const reconciler = require('../backend/calcioStakeReconciler');
const provenance = require('../backend/calcioCertifiedOddsProvenance');

const src = path.resolve(__dirname, '../backend/database_betting.db');
const tmp = path.join(os.tmpdir(), `betting-p18-${process.pid}-${Date.now()}.db`);
fs.copyFileSync(src, tmp);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const snapshot = (db, where) => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum, COALESCE(SUM(COALESCE(stake,0)),0) stakeSum, COALESCE(SUM(COALESCE(profit,0)),0) profitSum FROM ai_forward_test WHERE ${where}`).get();

const db = new DatabaseSync(tmp);
try {
  const tennisBefore = snapshot(db, "UPPER(COALESCE(sport_type,''))='TENNIS'");
  const resolvedBefore = snapshot(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')");

  const first = reconciler.reconcilePendingRows(db);
  const columns = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
  for (const column of ['calcio_odds_certification_status','calcio_odds_operational_eligible','calcio_odds_bookmaker_title','calcio_odds_last_update','calcio_odds_source_count','calcio_odds_provenance_json']) {
    assert(columns.has(column), `Missing Patch 18 column ${column}`);
  }

  const legacyPositive = db.prepare(`
    SELECT COUNT(*) n FROM ai_forward_test
    WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
      AND UPPER(COALESCE(status,'PENDING'))='PENDING'
      AND COALESCE(paper_result_active,1)=1
      AND COALESCE(calcio_odds_operational_eligible,0)=0
      AND COALESCE(stake,0)>0
  `).get().n;
  assert.strictEqual(Number(legacyPositive), 0, 'Uncertified pending rows must have stake 0');

  const second = reconciler.reconcilePendingRows(db);
  assert.strictEqual(second.updated, 0, 'Patch 18 reconciliation must be idempotent');

  const cert = {
    version: provenance.CALCIO_CERTIFIED_ODDS_PROVENANCE_VERSION,
    market: '1',
    status: 'CERTIFIED_MULTI_SOURCE',
    reason: 'Synthetic DB verification fixture',
    realDirect: true,
    certified: true,
    crossVerified: true,
    operationalEligible: true,
    sourceCount: 2,
    selectedPrice: 2.14,
    selectedSource: { provider: 'THE_ODDS_API', bookmakerKey: 'unibet', bookmakerTitle: 'Unibet', lastUpdate: '2026-07-23T13:55:00.000Z', marketKey: 'h2h', outcomeName: 'Alpha FC', price: 2.14, direct: true, derived: false },
    sources: [
      { bookmakerKey: 'unibet', bookmakerTitle: 'Unibet', lastUpdate: '2026-07-23T13:55:00.000Z', price: 2.14, marketKey: 'h2h' },
      { bookmakerKey: 'pinnacle', bookmakerTitle: 'Pinnacle', lastUpdate: '2026-07-23T13:50:00.000Z', price: 2.10, marketKey: 'h2h' }
    ]
  };
  const certFields = provenance.persistenceFields(cert);
  const fixtureKey = `PATCH18_DB_FIXTURE_${Date.now()}`;
  const insert = db.prepare(`
    INSERT INTO ai_forward_test (
      bet_type, match_date, home_team, away_team, prediction, odd, stake, status,
      estimated_prob, edge, edge_pp, ev_pct, confidence, bankroll_snapshot,
      sport_type, calcio_prediction_reliability_score, ds_action,
      match_exposure_key, calcio_event_key, paper_result_active, paper_result_conflict,
      ${Object.keys(certFields).join(', ')}
    ) VALUES (
      'SINGLE', '2026-07-24T18:00:00.000Z', 'Patch18 Alpha', 'Patch18 Beta', '1', 2.14, 0, 'PENDING',
      58, 11.27, 11.27, 24.12, 84, 2000,
      'CALCIO', 84, 'VALUE CONFERMATO / MICRO',
      ?, ?, 1, 0,
      ${Object.keys(certFields).map(() => '?').join(', ')}
    )
  `).run(fixtureKey, fixtureKey, ...Object.values(certFields));

  const third = reconciler.reconcilePendingRows(db);
  const fixture = db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(insert.lastInsertRowid);
  assert(Number(fixture.stake) >= 2, JSON.stringify(fixture));
  assert.strictEqual(Number(fixture.calcio_prediction_index_eligible), 1);
  assert.strictEqual(fixture.calcio_odds_certification_status, 'CERTIFIED_MULTI_SOURCE');
  assert.strictEqual(Number(fixture.calcio_odds_operational_eligible), 1);

  const tennisAfter = snapshot(db, "UPPER(COALESCE(sport_type,''))='TENNIS'");
  const resolvedAfter = snapshot(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')");
  assert.deepStrictEqual({ ...tennisAfter }, { ...tennisBefore });
  assert.deepStrictEqual({ ...resolvedAfter }, { ...resolvedBefore });

  console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE',
    sourceSha256: sha(src),
    first: { scanned: first.scanned, updated: first.updated, operationalPositive: first.operationalPositive },
    second: { updated: second.updated, idempotent: true },
    certifiedFixture: { id: Number(insert.lastInsertRowid), stake: fixture.stake, index: fixture.calcio_prediction_index_score, status: fixture.calcio_odds_certification_status, bookmaker: fixture.calcio_odds_bookmaker_title, sourceCount: fixture.calcio_odds_source_count },
    third: { updated: third.updated, operationalPositive: third.operationalPositive },
    safeguards: { legacyUncertifiedPositiveStake: Number(legacyPositive), tennisUnchanged: true, resolvedCalcioUnchanged: true }
  }, null, 2));
} finally {
  db.close();
  try { fs.unlinkSync(tmp); } catch (_) {}
}
