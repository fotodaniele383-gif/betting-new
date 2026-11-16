'use strict';
const assert = require('assert');
const path = require('path');
const Database = require('./sqlite-compat');
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath);
try {
  const columns = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
  const required = [
    'calcio_dual_score_version','calcio_dual_score_mode','calcio_forecast_confidence_shadow',
    'calcio_value_score_shadow','calcio_context_risk_penalty','calcio_decision_readiness_shadow',
    'calcio_decision_readiness_label','calcio_dual_score_old_ipm','calcio_dual_score_delta_vs_ipm',
    'calcio_dual_score_pt_sample','calcio_dual_score_pt_weight','calcio_dual_score_authority','calcio_dual_score_audit'
  ];
  const missing = required.filter(name => !columns.has(name));
  assert.deepStrictEqual(missing, []);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calcio_dual_score_shadow_audit_log'").get();
  const trigger = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_calcio_dual_score_shadow_update'").get();
  assert(table, 'audit table missing');
  assert(trigger, 'audit trigger missing');
  const counts = {
    total: db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n,
    tennis: db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n,
    resolvedCalcio: db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')").get().n,
    shadowRows: db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE calcio_dual_score_version IS NOT NULL").get().n,
    auditRows: db.prepare('SELECT COUNT(*) n FROM calcio_dual_score_shadow_audit_log').get().n
  };
  console.log(JSON.stringify({ success: true, verificationMode: 'READ_ONLY_ADDITIVE_SHADOW_SCHEMA', database: dbPath, missingColumns: missing, auditTable: true, auditTrigger: true, counts }, null, 2));
} finally { db.close(); }
