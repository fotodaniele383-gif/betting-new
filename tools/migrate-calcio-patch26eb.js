'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('./sqlite-compat');

const PATCH = 'BETTING_PATCH_26E_B_CALCIO_CROSS_MARKET_UNCERTAINTY_OPERATIONAL_GUARD';
const dbPath = process.env.BETTING_DB_PATH || path.join(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath);

function columns(table) { return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name); }
function digestRows(columnList) {
    const rows = db.prepare(`SELECT ${columnList.map(name => `"${name}"`).join(',')} FROM ai_forward_test ORDER BY id`).all();
    return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function count(where) { return db.prepare(`SELECT COUNT(*) AS n FROM ai_forward_test WHERE ${where}`).get().n; }

const additions = {
    calcio_cross_market_reliability_version: 'TEXT',
    calcio_cross_market_stress_status: 'TEXT',
    calcio_cross_market_stress_probability: 'REAL',
    calcio_cross_market_gap_pp: 'REAL',
    calcio_cross_market_lambda_home: 'REAL',
    calcio_cross_market_lambda_away: 'REAL',
    calcio_analysis_maturity_score: 'REAL',
    calcio_days_to_kickoff: 'REAL',
    calcio_epistemic_uncertainty_score: 'REAL',
    calcio_robust_probability: 'REAL',
    calcio_robust_ev_pct: 'REAL',
    calcio_reliability_stake_multiplier: 'REAL',
    calcio_unadjusted_pre_cap_stake: 'REAL',
    calcio_reliability_adjusted_stake: 'REAL',
    calcio_reliability_guard_status: 'TEXT',
    calcio_reliability_guard_audit: 'TEXT'
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
    if (beforeDigest !== afterDigest) throw new Error('PATCH26EB_BUSINESS_ROWS_CHANGED');
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('PATCH26EB_SCOPE_COUNTS_CHANGED');
    console.log(JSON.stringify({
        success: true,
        patch: PATCH,
        migration: 'ADDITIVE_CROSS_MARKET_RELIABILITY_COLUMNS_ONLY',
        addedColumns: added,
        businessRowsUnchanged: true,
        before,
        after,
        stableDigest: beforeDigest
    }, null, 2));
} finally {
    db.close();
}
