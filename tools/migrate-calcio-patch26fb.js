'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('./sqlite-compat');

const PATCH = 'BETTING_PATCH_26F_B_CALCIO_HISTORICAL_COVERAGE_ENTITY_RESOLUTION';
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath);

const additions = {
    calcio_historical_coverage_version: 'TEXT',
    calcio_historical_coverage_status: 'TEXT',
    calcio_historical_coverage_reason: 'TEXT',
    calcio_historical_home_source: 'TEXT',
    calcio_historical_away_source: 'TEXT',
    calcio_historical_coverage_sample: 'INTEGER',
    calcio_historical_coverage_confidence: 'REAL',
    calcio_historical_coverage_audit: 'TEXT'
};

function columns(table) { return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name); }
function count(where) { return db.prepare(`SELECT COUNT(*) AS n FROM ai_forward_test WHERE ${where}`).get().n; }
function digest(where, selected) {
    const rows = db.prepare(`SELECT ${selected.map(name => `"${name}"`).join(',')} FROM ai_forward_test WHERE ${where} ORDER BY id`).all();
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

try {
    const beforeColumns = columns('ai_forward_test');
    const stableColumns = beforeColumns.filter(name => !Object.prototype.hasOwnProperty.call(additions, name));
    const before = {
        total: count('1=1'),
        tennis: count("UPPER(COALESCE(sport_type,''))='TENNIS'"),
        resolvedCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
    };
    const allDigestBefore = digest('1=1', stableColumns);
    const tennisDigestBefore = digest("UPPER(COALESCE(sport_type,''))='TENNIS'", stableColumns);
    const resolvedDigestBefore = digest("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')", stableColumns);
    const addedColumns = [];

    db.exec('BEGIN IMMEDIATE');
    try {
        const current = new Set(columns('ai_forward_test'));
        for (const [name, definition] of Object.entries(additions)) {
            if (!current.has(name)) {
                db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${definition}`);
                addedColumns.push(name);
            }
        }
        db.exec('COMMIT');
    } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
    }

    const after = {
        total: count('1=1'),
        tennis: count("UPPER(COALESCE(sport_type,''))='TENNIS'"),
        resolvedCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')")
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('PATCH26FB_ROW_COUNTS_CHANGED');
    if (allDigestBefore !== digest('1=1', stableColumns)) throw new Error('PATCH26FB_EXISTING_ROWS_MUTATED');
    if (tennisDigestBefore !== digest("UPPER(COALESCE(sport_type,''))='TENNIS'", stableColumns)) throw new Error('PATCH26FB_TENNIS_MUTATED');
    if (resolvedDigestBefore !== digest("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')", stableColumns)) throw new Error('PATCH26FB_RESOLVED_CALCIO_MUTATED');

    console.log(JSON.stringify({
        success: true,
        patch: PATCH,
        migration: 'ADDITIVE_HISTORICAL_COVERAGE_AUDIT_SCHEMA_ONLY',
        addedColumns,
        existingRowsUpdated: 0,
        rowsDeleted: 0,
        before,
        after,
        safeguards: {
            tennisUnchanged: true,
            resolvedCalcioUnchanged: true,
            historicalRowsUnchanged: true,
            finalMarketContractUnchanged: true
        }
    }, null, 2));
} finally {
    db.close();
}
