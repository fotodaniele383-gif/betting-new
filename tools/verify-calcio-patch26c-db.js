'use strict';
const path = require('path');
const assert = require('assert/strict');
const Database = require('./sqlite-compat');
const dbPath = process.env.BETTING_DB_PATH || path.resolve(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
try {
    const columns = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row => row.name));
    const required = [
        'calcio_analysis_batch_id', 'calcio_event_finalization_id', 'calcio_portfolio_allocation_id',
        'calcio_portfolio_batch_status', 'calcio_portfolio_batch_certified',
        'calcio_portfolio_pre_cap_eligible', 'calcio_portfolio_pre_cap_stake',
        'calcio_portfolio_post_cap_stake', 'calcio_portfolio_cap_reason',
        'calcio_batch_output_coherence_status'
    ];
    required.forEach(name => assert.ok(columns.has(name), `Colonna mancante: ${name}`));
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calcio_ai_portfolio_batch_allocations'").get();
    assert.ok(table, 'Tabella batch allocation mancante');
    const counts = {
        total: Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n),
        tennis: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'").get().n),
        resolvedCalcio: Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')").get().n),
        allocations: Number(db.prepare('SELECT COUNT(*) n FROM calcio_ai_portfolio_batch_allocations').get().n)
    };
    assert.equal(counts.total, 1079);
    assert.equal(counts.tennis, 806);
    assert.equal(counts.resolvedCalcio, 5);
    console.log(JSON.stringify({ success: true, patch: 'BETTING_PATCH_26C_CALCIO_BATCH_PORTFOLIO_AUTHORITATIVE_UI', schema: 'PASS', counts, requiresFreshLiveBatch: counts.allocations === 0 }, null, 2));
} finally { db.close(); }
