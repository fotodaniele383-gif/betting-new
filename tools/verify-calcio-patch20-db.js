'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const dbPath = path.resolve(__dirname, '../backend/database_betting.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const cols = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
  const required = [
    'calcio_stake_caution_mode',
    'calcio_stake_caution_reasons',
    'calcio_stake_operational_multiplier',
    'calcio_stake_operational_cap',
    'calcio_identity_certified',
    'calcio_market_identity_certified',
    'calcio_thresholds_certified',
    'calcio_odds_operational_eligible'
  ];
  const missing = required.filter(name => !cols.has(name));
  if (missing.length) throw new Error(`Colonne Patch 20 mancanti: ${missing.join(', ')}`);
  const pendingWhere = "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1";
  const stats = db.prepare(`SELECT
      COUNT(*) n,
      SUM(CASE WHEN COALESCE(stake,0)>0 THEN 1 ELSE 0 END) positive,
      SUM(CASE WHEN COALESCE(stake,0)>0 AND UPPER(COALESCE(calcio_stake_caution_mode,'')) <> 'STANDARD_CERTIFIED' THEN 1 ELSE 0 END) cappedPositive,
      SUM(CASE WHEN UPPER(COALESCE(calcio_decision_certification_status,''))='PATCH19_REQUIRES_PROVIDER_REFRESH' THEN 1 ELSE 0 END) refreshRequired,
      SUM(CASE WHEN UPPER(COALESCE(calcio_decision_certification_status,''))='PATCH19_REQUIRES_PROVIDER_REFRESH' AND COALESCE(stake,0)>0 THEN 1 ELSE 0 END) refreshPositive
    FROM ai_forward_test WHERE ${pendingWhere}`).get();
  const invalid = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${pendingWhere} AND COALESCE(stake,0)>0 AND (
      COALESCE(calcio_identity_certified,0)<>1 OR
      COALESCE(calcio_market_identity_certified,0)<>1 OR
      COALESCE(calcio_thresholds_certified,0)<>1 OR
      COALESCE(calcio_odds_operational_eligible,0)<>1 OR
      COALESCE(calcio_prediction_index_score,0)<65
    )`).get();
  if (Number(stats.refreshPositive) !== 0) throw new Error('Riga legacy refresh-required riattivata impropriamente');
  if (Number(invalid.n) !== 0) throw new Error(`Stake positivi non certificati: ${invalid.n}`);
  const tennis = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get();
  const resolved = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')").get();
  console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_20_CERTIFIED_DECISION_STAKE_AUTHORITY_RESTORE',
    database: {
      pending: Number(stats.n),
      positiveStake: Number(stats.positive || 0),
      cappedPositive: Number(stats.cappedPositive || 0),
      refreshRequired: Number(stats.refreshRequired || 0),
      refreshPositive: Number(stats.refreshPositive || 0),
      invalidPositive: Number(invalid.n),
      tennis,
      resolved
    },
    safeguards: {
      refreshRowsRemainSuspended: Number(stats.refreshPositive) === 0,
      everyPositiveStakeHardCertified: Number(invalid.n) === 0
    }
  }, null, 2));
} finally { db.close(); }
