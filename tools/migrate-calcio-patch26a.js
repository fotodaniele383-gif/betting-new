'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('./sqlite-compat');
const observability = require('../backend/calcioObservability');

const dbPath = process.env.BETTING_DB_PATH || path.resolve(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath);

function digestRows(table) {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function countWhere(sql) { return db.prepare(sql).get().n; }

try {
  const before = {
    aiRows: countWhere('SELECT COUNT(*) n FROM ai_forward_test'),
    aiDigest: digestRows('ai_forward_test'),
    tennis: countWhere("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'"),
    resolvedCalcio: countWhere("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
  };
  observability.ensureSchema(db);
  const after = {
    aiRows: countWhere('SELECT COUNT(*) n FROM ai_forward_test'),
    aiDigest: digestRows('ai_forward_test'),
    tennis: countWhere("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'"),
    resolvedCalcio: countWhere("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
  };
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`PATCH26A_FORBIDDEN_BUSINESS_ROW_MUTATION: ${JSON.stringify({ before, after })}`);
  }
  console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_26A_CALCIO_OBSERVABILITY_INVARIANTS_BASELINE',
    version: observability.CALCIO_OBSERVABILITY_VERSION,
    migration: 'ADDITIVE_OBSERVABILITY_TABLES_ONLY',
    aiForwardTestUnchanged: true,
    tennisUnchanged: true,
    resolvedCalcioUnchanged: true,
    before,
    after
  }, null, 2));
} finally {
  db.close();
}
