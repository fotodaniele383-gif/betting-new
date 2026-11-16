'use strict';
const assert = require('assert');
const path = require('path');
const Database = require('./sqlite-compat');
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
function count(sql, ...args) { return db.prepare(sql).get(...args).n; }
const cols = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r => r.name));
const required = [
  'calcio_final_market_contract_version','calcio_final_market_id','calcio_final_market_snapshot',
  'calcio_forecast_confidence_score','calcio_forecast_confidence_label',
  'calcio_decision_state_version','calcio_decision_state','calcio_decision_state_reason',
  'calcio_diagnostic_coherence_status','calcio_diagnostic_coherence_audit'
];
required.forEach(c => assert(cols.has(c), `Colonna mancante ${c}`));
assert(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calcio_final_market_contract_audit_log'").get());
const total = count('SELECT COUNT(*) n FROM ai_forward_test');
const tennis = count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'");
const resolvedCalcio = count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')");
assert(total > 0 && tennis > 0);
const positiveNonReady = count(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
 AND COALESCE(calcio_operational_stake,0)>0
 AND COALESCE(calcio_decision_state,'')<>'BET_READY'`);
assert.strictEqual(positiveNonReady, 0, 'Stake operativo positivo fuori da BET_READY');
const brokenContract = count(`SELECT COUNT(*) n FROM ai_forward_test
 WHERE COALESCE(calcio_final_market_contract_version,'')<>''
 AND (COALESCE(calcio_final_market_id,'')='' OR COALESCE(calcio_final_market_snapshot,'')='')`);
assert.strictEqual(brokenContract, 0, 'Contratto final market incompleto');
db.close();
console.log(JSON.stringify({ success: true, checks: required.length + 6, total, tennis, resolvedCalcio, positiveNonReady, brokenContract }, null, 2));
