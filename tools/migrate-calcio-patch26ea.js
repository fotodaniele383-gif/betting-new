'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('./sqlite-compat');

const PATCH = 'BETTING_PATCH_26E_A_CALCIO_DEEPSCAN_FINAL_STATE_UI_CONSISTENCY';
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath);

function columns(table) { return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name); }
function digestRows(columnList) {
    const rows = db.prepare(`SELECT ${columnList.map(name => `"${name}"`).join(',')} FROM ai_forward_test ORDER BY id`).all();
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function count(where) { return db.prepare(`SELECT COUNT(*) AS n FROM ai_forward_test WHERE ${where}`).get().n; }

const additions = {
    calcio_deepscan_final_state_version: 'TEXT',
    calcio_deepscan_final_state_action: 'TEXT',
    calcio_deepscan_final_state_score: 'REAL',
    calcio_deepscan_final_state_audit: 'TEXT',
    calcio_deepscan_final_report_json: 'TEXT'
};

try {
    const beforeColumns = columns('ai_forward_test');
    const stableColumns = beforeColumns.filter(name => !Object.prototype.hasOwnProperty.call(additions, name));
    const beforeDigest = digestRows(stableColumns);
    const before = {
        total: count('1=1'),
        tennis: count("UPPER(COALESCE(sport_type,''))='TENNIS'"),
        resolvedCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID')")
    };
    const added = [];
    db.exec('BEGIN IMMEDIATE');
    try {
        const current = new Set(columns('ai_forward_test'));
        for (const [name, definition] of Object.entries(additions)) {
            if (!current.has(name)) {
                db.exec(`ALTER TABLE ai_forward_test ADD COLUMN ${name} ${definition}`);
                added.push(name);
            }
        }
        db.exec('COMMIT');
    } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
    }
    const afterDigest = digestRows(stableColumns);
    const after = {
        total: count('1=1'),
        tennis: count("UPPER(COALESCE(sport_type,''))='TENNIS'"),
        resolvedCalcio: count("UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID')")
    };
    if (beforeDigest !== afterDigest) throw new Error('PATCH26EA_BUSINESS_ROWS_CHANGED');
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('PATCH26EA_SCOPE_COUNTS_CHANGED');
    console.log(JSON.stringify({
        success: true,
        patch: PATCH,
        migration: 'ADDITIVE_FINAL_STATE_AUDIT_COLUMNS_ONLY',
        addedColumns: added,
        businessRowsUnchanged: true,
        before,
        after,
        stableDigest: beforeDigest
    }, null, 2));
} finally {
    db.close();
}
