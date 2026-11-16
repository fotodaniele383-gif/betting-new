'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PATCH_ID = 'BETTING_PATCH_19_CALCIO_DECISION_IDENTITY_RELIABILITY_CERTIFICATION';
const dbPath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../backend/database_betting.db');

const COLUMNS = {
  calcio_decision_certification_version: 'TEXT',
  calcio_decision_certification_status: 'TEXT',
  calcio_decision_certification_reason: 'TEXT',
  calcio_identity_certified: 'INTEGER DEFAULT 0',
  calcio_market_identity_certified: 'INTEGER DEFAULT 0',
  calcio_thresholds_certified: 'INTEGER DEFAULT 0',
  calcio_provider_home_team: 'TEXT',
  calcio_provider_away_team: 'TEXT',
  calcio_historical_home_key: 'TEXT',
  calcio_historical_away_key: 'TEXT',
  calcio_prediction_confidence_score: 'REAL',
  calcio_prediction_value_score: 'REAL'
};

function snapshot(db, where) {
  return db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(id),0) AS idSum, COALESCE(SUM(COALESCE(stake,0)),0) AS stakeSum, COALESCE(SUM(COALESCE(profit,0)),0) AS profitSum FROM ai_forward_test WHERE ${where}`).get();
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function columns(db) { return new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name)); }
function marketFamily(prediction) {
  const p = String(prediction || '').toUpperCase().replace(/\s+/g, '');
  if (['1','X','2'].includes(p)) return 'h2h';
  if (['1X','X2','12'].includes(p)) return 'double_chance';
  if (['O2.5','U2.5','O2,5','U2,5'].includes(p)) return 'totals';
  return null;
}
function auditRow(row) {
  let provenance = null;
  try { provenance = JSON.parse(row.calcio_odds_provenance_json || 'null'); } catch (_) {}
  const provMarket = String(provenance?.market || '');
  const marketKey = String(provenance?.selectedSource?.marketKey || row.calcio_odds_market_key || '').toLowerCase();
  const predictionMismatch = Boolean(provMarket && String(row.prediction || '').toUpperCase() !== provMarket.toUpperCase());
  const familyMismatch = Boolean(marketKey && marketFamily(row.prediction) && marketFamily(row.prediction) !== marketKey);
  const outcome = String(provenance?.selectedSource?.outcomeName || '');
  const sideMismatch = Boolean(outcome && ['1','2'].includes(String(provMarket).toUpperCase()) &&
    ((String(provMarket).toUpperCase() === '1' && outcome.toLowerCase() !== String(row.home_team || '').toLowerCase()) ||
     (String(provMarket).toUpperCase() === '2' && outcome.toLowerCase() !== String(row.away_team || '').toLowerCase())));
  return { predictionMismatch, familyMismatch, sideMismatch, provMarket, marketKey, outcome };
}

const db = new DatabaseSync(dbPath);
try {
  const tennisBefore = snapshot(db, "UPPER(COALESCE(sport_type,''))='TENNIS'");
  const resolvedBefore = snapshot(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')");
  const pendingWhere = "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1";
  const pendingBefore = snapshot(db, pendingWhere);

  db.exec('BEGIN IMMEDIATE');
  const existing = columns(db);
  for (const [name, type] of Object.entries(COLUMNS)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${type}`);
  }

  const rows = db.prepare(`SELECT id,home_team,away_team,prediction,calcio_odds_market_key,calcio_odds_provenance_json FROM ai_forward_test WHERE ${pendingWhere}`).all();
  const anomalies = rows.map(row => ({ id: row.id, ...auditRow(row) })).filter(row => row.predictionMismatch || row.familyMismatch || row.sideMismatch);

  const update = db.prepare(`UPDATE ai_forward_test SET
    stake=0,
    calcio_theoretical_stake=0,
    calcio_operational_stake=0,
    calcio_gate_allow_bet=0,
    calcio_gate_max_stake=0,
    calcio_prediction_index_eligible=0,
    quality_stake_amount=0,
    calcio_analysis_only=1,
    calcio_decision_certification_version='BETTING_PATCH_19_CALCIO_DECISION_CERTIFICATION_V1',
    calcio_decision_certification_status='PATCH19_REQUIRES_PROVIDER_REFRESH',
    calcio_decision_certification_reason='Riga precedente a Patch 19: stake sospeso finché identità raw provider, mercato, outcome e soglie live non vengono ricertificati atomicamente.',
    calcio_identity_certified=0,
    calcio_market_identity_certified=0,
    calcio_thresholds_certified=0,
    calcio_provider_home_team=NULL,
    calcio_provider_away_team=NULL,
    calcio_stake_lifecycle_status='PATCH19_DECISION_NO_STAKE',
    calcio_stake_lifecycle_reason='Stake €0: refresh provider Patch 19 richiesto.',
    calcio_operational_action='ANALYSIS_ONLY_PATCH19_PROVIDER_REFRESH',
    calcio_operational_summary='Analisi conservata; nessuna esecuzione fino a refresh provider certificato.',
    quality_stake_mode='PATCH19_NO_STAKE'
    WHERE ${pendingWhere}`);
  const result = update.run();
  db.exec('COMMIT');

  const tennisAfter = snapshot(db, "UPPER(COALESCE(sport_type,''))='TENNIS'");
  const resolvedAfter = snapshot(db, "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')");
  const pendingAfter = snapshot(db, pendingWhere);
  const positiveAfter = db.prepare(`SELECT COUNT(*) AS n FROM ai_forward_test WHERE ${pendingWhere} AND COALESCE(stake,0)>0`).get().n;
  if (!same(tennisBefore, tennisAfter)) throw new Error('Tennis rows changed during Patch 19 migration');
  if (!same(resolvedBefore, resolvedAfter)) throw new Error('Resolved Calcio rows changed during Patch 19 migration');
  if (positiveAfter !== 0) throw new Error(`Stake positivi PENDING dopo migrazione: ${positiveAfter}`);

  console.log(JSON.stringify({
    success: true,
    patch: PATCH_ID,
    dbPath,
    scanned: rows.length,
    updated: Number(result.changes || 0),
    anomaliesBeforeMigration: anomalies,
    positiveStakeAfter: positiveAfter,
    idempotentPolicy: 'Ogni esecuzione mantiene le righe PENDING legacy in analisi fino a refresh provider Patch 19.',
    safeguards: { tennisUnchanged: true, resolvedCalcioUnchanged: true, historicalRowsDeleted: false, pendingCalcioOnly: true },
    snapshots: { pendingBefore, pendingAfter, tennisBefore, tennisAfter, resolvedBefore, resolvedAfter }
  }, null, 2));
} catch (error) {
  try { db.exec('ROLLBACK'); } catch (_) {}
  throw error;
} finally {
  db.close();
}
