'use strict';
const assert = require('assert');
const path = require('path');
const Database = require('./sqlite-compat');
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
const cols = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r => r.name));
const required = [
 'calcio_stake_authority_version','calcio_stake_authority_status','calcio_stake_authority_model_stake',
 'calcio_stake_authority_reliability_stake','calcio_stake_authority_pre_cap_stake','calcio_stake_authority_final_stake',
 'calcio_stake_probability_pct','calcio_stake_full_kelly_pct','calcio_stake_fractional_kelly',
 'calcio_stake_event_cap_pct','calcio_stake_minimum_eur','calcio_stake_bankroll_snapshot',
 'calcio_stake_bankroll_source','calcio_stake_authority_reason','calcio_stake_authority_audit',
 'calcio_data_quality_authority_version','calcio_data_quality_score','calcio_data_quality_status',
 'calcio_data_quality_label','calcio_data_quality_blocking','calcio_data_quality_reasons',
 'calcio_data_quality_audit','calcio_bankroll_snapshot_consistent','calcio_final_narrative_version','calcio_final_narrative'
];
required.forEach(c => assert(cols.has(c), `Colonna mancante ${c}`));
const auditTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calcio_stake_authority_audit_log'").get();
assert(auditTable);
const total = db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n;
const tennis = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n;
const resolvedCalcio = db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')").get().n;
assert(total > 0 && tennis > 0);
const contaminated = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
 AND COALESCE(calcio_stake_authority_final_stake,0)>0
 AND COALESCE(calcio_robust_ev_pct,0)<=0`).get().n;
assert.strictEqual(contaminated, 0, 'Stake positivo con EV robusto non positivo');
db.close();
console.log(JSON.stringify({ success: true, checks: required.length + 5, total, tennis, resolvedCalcio, contaminated }, null, 2));
