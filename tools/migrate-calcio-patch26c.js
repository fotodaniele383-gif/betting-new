'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('./sqlite-compat');
const allocator = require('../backend/calcioBatchPortfolioAllocator');

const dbPath = process.env.BETTING_DB_PATH || path.resolve(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: false });

function tableColumns(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

function digestExistingColumns(columns) {
    const quoted = columns.map(name => `"${String(name).replaceAll('"', '""')}"`).join(', ');
    const rows = db.prepare(`SELECT ${quoted} FROM ai_forward_test ORDER BY id`).all();
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function count(sql) {
    return Number(db.prepare(sql).get().n || 0);
}

try {
    const beforeColumns = tableColumns('ai_forward_test');
    const before = {
        rows: count('SELECT COUNT(*) n FROM ai_forward_test'),
        digest: digestExistingColumns(beforeColumns),
        tennis: count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'"),
        resolvedCalcio: count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
    };
    allocator.ensureSchema(db);
    const afterColumns = tableColumns('ai_forward_test');
    const after = {
        rows: count('SELECT COUNT(*) n FROM ai_forward_test'),
        digest: digestExistingColumns(beforeColumns),
        tennis: count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'"),
        resolvedCalcio: count("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error(`PATCH26C_FORBIDDEN_BUSINESS_ROW_MUTATION:${JSON.stringify({ before, after })}`);
    }
    const addedColumns = afterColumns.filter(name => !beforeColumns.includes(name));
    console.log(JSON.stringify({
        success: true,
        patch: 'BETTING_PATCH_26C_CALCIO_BATCH_PORTFOLIO_AUTHORITATIVE_UI',
        version: allocator.CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION,
        migration: 'ADDITIVE_SCHEMA_ONLY',
        businessRowsUnchanged: true,
        tennisUnchanged: true,
        resolvedCalcioUnchanged: true,
        addedColumns,
        addedTable: 'calcio_ai_portfolio_batch_allocations',
        before,
        after
    }, null, 2));
} finally {
    db.close();
}
