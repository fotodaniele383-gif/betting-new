'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const dbPath = path.resolve(__dirname, '../backend/database_betting.db');
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const cols = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r => r.name));
  const required = ['calcio_decision_certification_version','calcio_decision_certification_status','calcio_decision_certification_reason','calcio_identity_certified','calcio_market_identity_certified','calcio_thresholds_certified','calcio_provider_home_team','calcio_provider_away_team','calcio_prediction_confidence_score','calcio_prediction_value_score'];
  const missing = required.filter(c => !cols.has(c));
  if (missing.length) throw new Error(`Colonne Patch 19 mancanti: ${missing.join(', ')}`);
  const pendingWhere = "UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1";
  const stats = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN COALESCE(stake,0)>0 THEN 1 ELSE 0 END) positive, SUM(CASE WHEN calcio_decision_certification_status='PATCH19_REQUIRES_PROVIDER_REFRESH' THEN 1 ELSE 0 END) refreshRequired, SUM(CASE WHEN COALESCE(calcio_prediction_index_eligible,0)>0 THEN 1 ELSE 0 END) eligible FROM ai_forward_test WHERE ${pendingWhere}`).get();
  if (Number(stats.positive) !== 0 || Number(stats.eligible) !== 0) throw new Error(`Righe PENDING ancora operative: stake=${stats.positive}, eligible=${stats.eligible}`);
  const tennis = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get();
  const resolved = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(id),0) idSum FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')").get();
  console.log(JSON.stringify({ success:true, patch:'BETTING_PATCH_19_CALCIO_DECISION_IDENTITY_RELIABILITY_CERTIFICATION', database:{ pending:Number(stats.n), positiveStake:Number(stats.positive), eligible:Number(stats.eligible), refreshRequired:Number(stats.refreshRequired), tennis, resolved }, safeguards:{ legacyPendingSuspended:true, tennisCountPreserved:Number(tennis.n)===806, resolvedCalcioCountPreserved:Number(resolved.n)===5 } }, null, 2));
} finally { db.close(); }
